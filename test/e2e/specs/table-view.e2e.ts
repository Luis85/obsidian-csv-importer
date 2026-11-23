import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { clickMenuItem, menuItems, openCsv, shot, writeVault } from "../flows";
import {
	CSV, NOTES_DIR, activeViewType, findNoteByFrontmatter, importViaDialog, installConsoleSpy, listNotes, pluginProblems, resetEverything,
	waitForFrontmatter,
} from "../support";

const SPEC = "table-view";
const badge = (col: number) => browser.$(`[data-testid=csv-type-badge][data-col="${col}"]`);

describe("CSV table view", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("opens a .csv file in the plugin's view with typed column badges and a status line", async function () {
		await openCsv(CSV);
		expect(await activeViewType()).toBe("csv-importer-view");
		const headers = await browser.$$("[data-testid=csv-table] th .csv-importer-th-name").map((e) => e.getText());
		expect(headers).toEqual(["Datum", "Rolle", "Beschreibung", "Stunden", "Tage"]);
		await expect(browser.$$("[data-testid=csv-table] tbody tr")).toBeElementsArrayOfSize(6);
		const badges = await browser.$$("[data-testid=csv-type-badge]").map((e) => e.getText());
		expect(badges).toHaveLength(5);
		expect(badges[0]).toMatch(/date/i);
		expect(badges[1]).toMatch(/text/i);
		expect(badges[3]).toMatch(/number/i);
		expect(badges[4]).toMatch(/number/i);
		await expect(browser.$("[data-testid=csv-import]")).toHaveText("Import 6 rows");
		await expect(browser.$("[data-testid=csv-view] .csv-importer-status")).toHaveText(expect.stringContaining("6 rows"));
		await shot(SPEC, "table", true);
	});

	it("filters the rows with the filter box", async function () {
		await openCsv(CSV);
		await browser.$("[data-testid=csv-view] input.csv-importer-search").setValue("Projektleiter");
		await browser.waitUntil(async () => (await browser.$$("[data-testid=csv-table] tbody tr").length) < 6, { timeoutMsg: "filter did not apply" });
		const rows = await browser.$$("[data-testid=csv-table] tbody tr").length;
		expect(rows).toBeGreaterThan(0);
		await shot(SPEC, "filtered");
	});

	it("changes a column's type from the badge menu", async function () {
		await openCsv(CSV);
		await badge(3).click();
		expect(await menuItems()).toEqual(expect.arrayContaining(["Text", "Number", "Checkbox", "Date", "Date & time", "List", "Link values ([[…]])", "Exclude from import"]));
		await shot(SPEC, "badge-menu", true);
		await clickMenuItem("Text");
		await browser.waitUntil(async () => /text/i.test(await badge(3).getText()), { timeoutMsg: "badge did not change" });

		// The changed type is what the import writes: Stunden becomes text.
		await importViaDialog(CSV);
		const note = await findNoteByFrontmatter(NOTES_DIR, "Datum", "2026-11-18");
		const fm = await waitForFrontmatter(note, (f) => f["Stunden"] !== undefined);
		expect(typeof fm["Stunden"]).toBe("string");
		expect(typeof fm["Tage"]).toBe("number");
	});

	it("links values as wikilinks from the badge menu, and unlinks them again", async function () {
		await openCsv(CSV);
		await badge(1).click();
		await clickMenuItem("Link values ([[…]])");
		await browser.waitUntil(async () => {
			await badge(1).click();
			const items = await menuItems();
			await browser.keys("Escape");
			return items.includes("Unlink values");
		}, { timeoutMsg: "item never became Unlink values" });
		await importViaDialog(CSV);
		const note = await findNoteByFrontmatter(NOTES_DIR, "Datum", "2026-11-18");
		const fm = await waitForFrontmatter(note, (f) => f["Rolle"] !== undefined);
		expect(fm["Rolle"]).toBe("[[Softwareentwickler]]");
	});

	it("excludes a column from the import", async function () {
		await openCsv(CSV);
		await badge(4).click();
		await clickMenuItem("Exclude from import");
		await browser.waitUntil(async () => (await browser.$$("[data-testid=csv-table] td.is-excluded").length) > 0, { timeoutMsg: "column not marked excluded" });
		await shot(SPEC, "excluded");
		await importViaDialog(CSV);
		const note = await findNoteByFrontmatter(NOTES_DIR, "Datum", "2026-11-18");
		const fm = await waitForFrontmatter(note, (f) => f["Stunden"] !== undefined);
		expect(fm["Tage"]).toBeUndefined();
		await browser.execute(() => (document.querySelector('[data-testid=csv-type-badge][data-col="4"]') as HTMLElement).click());
		expect(await menuItems()).toContain("Include in import");
	});

	it("shows more rows in pages", async function () {
		const rows = Array.from({ length: 700 }, (_, i) => `${i},row ${i}`).join("\n");
		await writeVault("Data/long.csv", `Id,Text\n${rows}\n`);
		await openCsv("Data/long.csv");
		const shown = await browser.$$("[data-testid=csv-table] tbody tr").length;
		expect(shown).toBeLessThan(700);
		await browser.$("[data-testid=csv-view] .csv-importer-more button").click();
		await browser.waitUntil(async () => (await browser.$$("[data-testid=csv-table] tbody tr").length) > shown, { timeoutMsg: "no more rows appended" });
		expect(await listNotes(NOTES_DIR)).toEqual([]);
	});
});
