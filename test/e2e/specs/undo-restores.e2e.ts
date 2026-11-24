import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { writeVault } from "../flows";
import {
	CSV, NOTES_DIR, clickButton, findNoteByFrontmatter, importViaDialog, installConsoleSpy, pluginProblems, resetEverything, runCommand,
	waitForFrontmatter, waitForModal, waitForNoModal,
} from "../support";

// The file name is a leftover of a debugging spec that could not be deleted from the sandbox; rename it to undo-restores.e2e.ts.
describe("undo restores modified notes", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("puts the earlier values back after undoing a re-import", async function () {
		await importViaDialog(CSV);
		const note = await findNoteByFrontmatter(NOTES_DIR, "Datum", "2026-11-18");
		await waitForFrontmatter(note, (f) => f["Stunden"] === 0.625);

		const text = await browser.executeObsidian(({ app }) => app.vault.adapter.read("Data/timesheet.csv"));
		await writeVault(CSV, text.replace("0.625,5", "2.5,5"));
		await importViaDialog(CSV);
		await waitForFrontmatter(note, (f) => f["Stunden"] === 2.5);

		await runCommand("undo-import-current-csv");
		await waitForModal("Undo last import");
		await clickButton("Undo import");
		await waitForNoModal();
		await waitForFrontmatter(note, (f) => f["Stunden"] === 0.625);
	});
});
