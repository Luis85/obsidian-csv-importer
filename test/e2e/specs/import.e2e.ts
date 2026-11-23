import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import {
	CSV, CSV_DE, NOTES_DIR, NOTES_DIR_DE, cacheIdle, findNoteByFrontmatter, importViaDialog, installConsoleSpy, listNotes,
	pluginProblems, readVaultFile, resetEverything, waitForFrontmatter,
} from "../support";

describe("import", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("imports every row through the preview dialog with typed properties", async function () {
		await importViaDialog(CSV);

		const notes = await listNotes(NOTES_DIR);
		expect(notes).toHaveLength(6);

		const first = await findNoteByFrontmatter(NOTES_DIR, "Datum", "2026-11-18");
		const fm = await waitForFrontmatter(first, (f) => f["Stunden"] !== undefined);
		expect(fm["Stunden"]).toBe(0.625);
		expect(fm["Tage"]).toBe(5);
		expect(typeof fm["Datum"]).toBe("string");
		expect(fm["Datum"]).toBe("2026-11-18");
		// The source link back to the CSV.
		expect(await readVaultFile(first)).toMatch(/timesheet\.csv/);
	});

	it("imports the German file (semicolon, decimal comma) with numeric Stunden", async function () {
		await importViaDialog(CSV_DE);
		expect(await listNotes(NOTES_DIR_DE)).toHaveLength(6);
		const note = await findNoteByFrontmatter(NOTES_DIR_DE, "Datum", "2026-11-18");
		const fm = await waitForFrontmatter(note, (f) => f["Stunden"] !== undefined);
		expect(fm["Stunden"]).toBe(0.625);
		expect(fm["Tage"]).toBe(5);
	});

	it("keeps user edits when the CSV is imported again", async function () {
		await importViaDialog(CSV);
		const note = await findNoteByFrontmatter(NOTES_DIR, "Datum", "2026-11-18");
		await waitForFrontmatter(note);

		// The user edits a CSV property, adds their own property and writes body text.
		await browser.executeObsidian(async ({ app }, path) => {
			const file = app.vault.getFileByPath(path);
			if (!file) throw new Error("note missing");
			await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				fm["Rolle"] = "Architekt";
				fm["status"] = "reviewed";
			});
			await app.vault.process(file, (text) => `${text.trimEnd()}\n\nMy own notes.\n`);
		}, note);
		await waitForFrontmatter(note, (f) => f["Rolle"] === "Architekt" && f["status"] === "reviewed");

		// The CSV changes: Stunden of the first row.
		await browser.executeObsidian(async ({ app }, path) => {
			const file = app.vault.getFileByPath(path);
			if (!file) throw new Error("csv missing");
			await app.vault.process(file, (text) => text.replace("0.625,5", "1.5,5"));
		}, CSV);

		await importViaDialog(CSV);
		await cacheIdle();

		const fm = await waitForFrontmatter(note, (f) => f["Stunden"] === 1.5);
		expect(fm["Rolle"]).toBe("Architekt");
		expect(fm["status"]).toBe("reviewed");
		expect(await readVaultFile(note)).toContain("My own notes.");
		expect(await listNotes(NOTES_DIR)).toHaveLength(6);
	});
});
