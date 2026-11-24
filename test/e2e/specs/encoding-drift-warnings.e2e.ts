import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { chooseOption, countsLine, openConfigTab, openCsv, openPreview, shot, writeVault } from "../flows";
import {
	CSV, clickButton, findNoteByFrontmatter, importViaDialog, installConsoleSpy, listNotes, pluginProblems, readVaultFile, resetEverything,
	waitForFrontmatter, waitForNoModal,
} from "../support";

const SPEC = "encoding-drift-warnings";

describe("encodings, changed columns and parser warnings", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("detects Windows-1252 and shows umlauts in the table and the notes", async function () {
		await openCsv("Data/windows-1252.csv");
		await expect(browser.$("[data-testid=csv-table]")).toHaveText(expect.stringContaining("Jürgen Müller"));
		await shot(SPEC, "windows-1252", true);
		await importViaDialog("Data/windows-1252.csv");
		const path = await findNoteByFrontmatter("Data/windows-1252", "Name", "Jürgen Müller");
		const fm = await waitForFrontmatter(path, (f) => f["Ort"] !== undefined);
		expect(fm["Ort"]).toBe("Köln");
	});

	it("reads UTF-16 files with a byte order mark", async function () {
		await openCsv("Data/utf-16.csv");
		await expect(browser.$("[data-testid=csv-table]")).toHaveText(expect.stringContaining("Jürgen"));
		await importViaDialog("Data/utf-16.csv");
		const path = await findNoteByFrontmatter("Data/utf-16", "Name", "Jürgen");
		expect((await waitForFrontmatter(path, (f) => f["Ort"] !== undefined))["Ort"]).toBe("Köln");
	});

	it("lets the encoding be set by hand on the File format tab", async function () {
		await openCsv("Data/windows-1252.csv");
		await browser.$("[data-testid=csv-configure]").click();
		await browser.$("[data-testid=import-config-modal]").waitForDisplayed();
		await openConfigTab("file");
		await chooseOption("[data-testid=import-config-modal]", "Encoding", "UTF-16 LE");
		await clickButton("Save");
		await waitForNoModal();
		// Forced UTF-16 reads the Windows-1252 bytes wrongly, so the table no longer shows the umlaut name.
		await browser.waitUntil(async () => !(await browser.$("[data-testid=csv-table]").isExisting()) || !(await browser.$("[data-testid=csv-table]").getText()).includes("Jürgen"), { timeoutMsg: "encoding setting had no effect" });
	});

	it("warns about columns that were added or removed since the last import and offers Review columns", async function () {
		await importViaDialog(CSV);
		const text = await readVaultFile(CSV);
		// The open view picks up the changed file by itself: no closing and reopening.
		await writeVault(CSV, text.split("\n").map((line, i) => (line === "" ? line : i === 0 ? `${line},Kostenstelle` : `${line},K1`)).join("\n"));
		const callout = browser.$("[data-testid=csv-view] .csv-importer-callout");
		await browser.waitUntil(async () => (await callout.isExisting()) && (await callout.getText()).includes("new or missing columns"), {
			timeoutMsg: "no drift callout in the table view",
		});
		await expect(callout).toHaveText(expect.stringContaining("Kostenstelle"));
		await shot(SPEC, "drift-banner", true);
		await clickButton("Review columns", "[data-testid=csv-view]");
		await browser.$("[data-testid=import-config-modal]").waitForDisplayed();
		await clickButton("Cancel");
		await waitForNoModal();
	});

	it("shows the drift in the import preview too", async function () {
		await importViaDialog(CSV);
		const text = await readVaultFile(CSV);
		await writeVault(CSV, text.replace("Datum,Rolle,Beschreibung,Stunden,Tage", "Datum,Rolle,Beschreibung,Stunden"));
		await openPreview(CSV);
		await expect(browser.$("[data-testid=import-run-modal]")).toHaveText(expect.stringContaining("new or missing columns"));
		await shot(SPEC, "drift-in-preview", true);
		await clickButton("Cancel");
		await waitForNoModal();
	});

	it("shows parser warnings for rows with the wrong number of fields", async function () {
		await openPreview("Data/ragged.csv");
		const modal = browser.$("[data-testid=import-run-modal]");
		await expect(modal.$(".csv-importer-callout")).toExist();
		await shot(SPEC, "parser-warnings", true);
		expect(await countsLine()).toMatch(/new|failed|skipped/);
		await clickButton("Cancel");
		await waitForNoModal();
		expect(await listNotes("Data/ragged")).toEqual([]);
	});

	it("warns on re-import when no key column is set", async function () {
		await importViaDialog(CSV);
		await openPreview(CSV);
		await expect(browser.$("[data-testid=import-run-modal]")).toHaveText(expect.stringContaining("No key column"));
		await shot(SPEC, "no-key-warning", true);
		await clickButton("Cancel");
		await waitForNoModal();
	});
});
