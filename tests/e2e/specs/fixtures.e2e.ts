// Real-world file shapes, read through Obsidian (decoding included): an Excel export with CRLF line breaks inside
// cells, files without rows, placeholder folders with version columns and duplicate keys, a decomposed file name
// and a large generated file. Each one covers a bug or a limit found in the review before 1.0 (docs/REVIEW-1.0.md).
import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { countsLine, openCsv, openPreview, patchConfig, writeVault } from "../flows";
import {
	PLUGIN_ID, clickButton, findNoteByFrontmatter, importViaDialog, installConsoleSpy, listNotes, openFile, pluginProblems, resetEverything,
	waitForFrontmatter, waitForNoModal, waitForViewType,
} from "../support";

const EXCEL = "Data/excel-export.csv";
const PRODUCTS = "Data/products.csv";
/** "Café.csv" with the accent as a separate combining character (NFD), as macOS and some sync tools write it. */
const CAFE = `Data/${"Café".normalize("NFD")}.csv`;

/** The empty-state text of the table view of a CSV. */
async function emptyText(path: string): Promise<string> {
	await openFile(path);
	await waitForViewType("csv-importer-view");
	// The active tab only: a CSV opened before may still have its (hidden) view in another tab.
	const el = browser.$(".workspace-leaf.mod-active [data-testid=csv-view] .csv-importer-empty");
	await el.waitForDisplayed();
	return el.getText();
}

describe("real-world CSV files", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("imports an Excel export (BOM, semicolons, CRLF) and updates a changed multi-line cell on re-import", async function () {
		await openCsv(EXCEL);
		await expect(browser.$("[data-testid=csv-table]")).toHaveText(expect.stringContaining("Schmidt; Söhne"));
		await importViaDialog(EXCEL);
		const first = await findNoteByFrontmatter("Data/excel-export", "Nr", 1);
		const fm = await waitForFrontmatter(first, (f) => f["Notiz"] !== undefined);
		expect(fm).toMatchObject({ Kunde: "Müller GmbH", Betrag: 1234.5, Notiz: "Erste Zeile\nzweite Zeile" });
		const second = await findNoteByFrontmatter("Data/excel-export", "Nr", 2);
		expect((await waitForFrontmatter(second, (f) => f["Notiz"] !== undefined))["Notiz"]).toBe('Sagte "danke"');

		// The same export again, with the second line of the multi-line cell changed (still CRLF inside the quotes).
		const text = await browser.executeObsidian(({ app }, p) => app.vault.adapter.read(p), EXCEL);
		await writeVault(EXCEL, text.replace("zweite Zeile", "geänderte Zeile"));
		await openPreview(EXCEL);
		expect(await countsLine()).toMatch(/^1 updated · 2 unchanged$/);
		await clickButton(/^Import 1 note$/);
		await browser.$("[data-testid=run-close]").waitForClickable();
		await browser.$("[data-testid=run-close]").click();
		await waitForNoModal();
		await waitForFrontmatter(first, (f) => f["Notiz"] === "Erste Zeile\ngeänderte Zeile");
	});

	it("says when a CSV has only a header row, and when it is empty", async function () {
		expect(await emptyText("Data/header-only.csv")).toContain("only a header row");
		expect(await emptyText("Data/empty.csv")).toBe("This file has no rows.");
	});

	it("keeps version numbers as text, warns about duplicate keys, and updates a row whose placeholder folder changed", async function () {
		await openCsv(PRODUCTS);
		await patchConfig(PRODUCTS, { targetFolder: "Shop/{{Status}}", keyColumn: "SKU", keyColumns: ["SKU"] });
		await openPreview(PRODUCTS);
		await expect(browser.$("[data-testid=import-run-modal]")).toHaveText(expect.stringContaining("Only the first is imported"));
		await clickButton(/^Import \d+ notes?$/);
		await browser.$("[data-testid=run-close]").waitForClickable();
		await browser.$("[data-testid=run-close]").click();
		await waitForNoModal();

		const widget = await findNoteByFrontmatter("Shop/Open", "SKU", "A-1");
		expect(await waitForFrontmatter(widget, (f) => f["Version"] !== undefined)).toMatchObject({ Version: "1.10", Price: 2.5 });
		const gadget = await findNoteByFrontmatter("Shop/Open", "SKU", "A-2");
		expect((await waitForFrontmatter(gadget, (f) => f["Version"] !== undefined))["Version"]).toBe("2.0");
		expect(await listNotes("Shop/Done")).toHaveLength(1); // A-3 once, not its duplicate row

		// A-1 is done now: its row resolves to Shop/Done, but the note it already has is updated in place.
		const text = await browser.executeObsidian(({ app }, p) => app.vault.adapter.read(p), PRODUCTS);
		await writeVault(PRODUCTS, text.replace("A-1,Widget,1.10,Open", "A-1,Widget,1.10,Done"));
		await openPreview(PRODUCTS);
		expect(await countsLine()).toMatch(/1 updated/);
		expect(await countsLine()).not.toMatch(/new/);
		await clickButton(/^Import 1 note$/);
		await browser.$("[data-testid=run-close]").waitForClickable();
		await browser.$("[data-testid=run-close]").click();
		await waitForNoModal();
		await waitForFrontmatter(widget, (f) => f["Status"] === "Done");
		expect(await listNotes("Shop/Done")).toHaveLength(1);
	});

	it("imports a CSV with a decomposed (NFD) file name and finds its notes again on re-import", async function () {
		// Written on disk under its decomposed name, as a sync tool or macOS does, not through the vault adapter: the
		// adapter normalizes paths to NFC, and a file written through it under an NFD path shows up twice in the vault
		// (once from the write, once from the file watcher). So this file is made here, not kept with the fixtures.
		await browser.executeObsidian(async ({ app, require }, path) => {
			const fs = require("fs") as typeof import("fs");
			const base = (app.vault.adapter as unknown as { basePath: string }).basePath;
			fs.writeFileSync(`${base}/${path}`, "id,dish\n1,Crêpe\n2,Soupe à l'oignon\n");
		}, CAFE);
		// Obsidian lists the file once, under the path it uses for it (composed); the plugin works with that path.
		let path = "";
		await browser.waitUntil(
			async () => {
				const found = await browser.executeObsidian(({ app }) => app.vault.getFiles().filter((f) => f.name.startsWith("Caf")).map((f) => f.path));
				path = found[0] ?? "";
				return found.length === 1;
			},
			{ timeoutMsg: "the vault did not pick up the CSV, or lists it twice" },
		);
		await openCsv(path);
		await expect(browser.$("[data-testid=csv-table]")).toHaveText(expect.stringContaining("Crêpe"));
		await importViaDialog(path);
		await openPreview(path);
		expect(await countsLine()).toBe("2 unchanged");
		await clickButton("Cancel");
		await waitForNoModal();
	});

	it("shows at most 5,000 rows of a large file and still previews every row", async function () {
		const rows = Array.from({ length: 20000 }, (_, i) => `${i + 1},Item number ${i + 1},${(i % 97) + 0.5},${i % 2 === 0 ? "yes" : "no"}`);
		await writeVault("Data/large.csv", `Id,Name,Amount,Active\n${rows.join("\n")}\n`);
		// Pages of 2,500 rows, so two pages reach the cap.
		await browser.executeObsidian(({ app }, id) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: { pageSize: number } }> } }).plugins.plugins[id]!;
			plugin.settings.pageSize = 2500;
		}, PLUGIN_ID);
		await openCsv("Data/large.csv");
		await browser.$("[data-testid=csv-view] .csv-importer-more button").click();
		const cap = browser.$("[data-testid=csv-view] .csv-importer-more-cap");
		await cap.waitForExist({ timeout: 20000 });
		expect(await cap.getText()).toContain("Showing the first 5,000 of 20,000 rows");
		expect(await browser.$$("[data-testid=csv-table] tbody tr").length).toBe(5000);

		await browser.$("[data-testid=csv-import]").click();
		await browser.$("[data-testid=import-run-modal] .csv-importer-run-counts").waitForExist({ timeout: 60000 });
		expect(await countsLine()).toBe("20000 new");
		await clickButton("Cancel");
		await waitForNoModal();
		expect(await listNotes("Data/large")).toEqual([]);
	});
});
