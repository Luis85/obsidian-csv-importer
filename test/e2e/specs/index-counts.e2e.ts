import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { INDEX, indexRow, openIndex, shot } from "../flows";
import { CSV, NOTES_DIR, importViaDialog, installConsoleSpy, listNotes, pluginProblems, resetEverything, waitForFrontmatter } from "../support";

const SPEC = "index-counts";
const RESULT = "[data-testid=csv-index-result]";
const EDITED = "[data-testid=csv-index-edited]";

describe("Index: note counts", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("shows the counts of the last import and updates them after a re-import", async function () {
		await importViaDialog(CSV);
		await openIndex();
		await expect((await indexRow("timesheet.csv")).$(RESULT)).toHaveText("6 new");
		await expect((await indexRow("timesheet.csv")).$(".csv-importer-index-count")).toHaveText("6");
		await importViaDialog(CSV);
		await openIndex();
		await browser.waitUntil(async () => (await (await indexRow("timesheet.csv")).$(RESULT).getText()) === "6 unchanged", {
			timeoutMsg: "counts of the second import not shown",
		});
		await shot(SPEC, "counts", true);
	});

	it("counts notes edited since the import, with the edited properties in the tooltip", async function () {
		await importViaDialog(CSV);
		await openIndex();
		await expect((await indexRow("timesheet.csv")).$(EDITED)).not.toBeDisplayed();
		const [note] = await listNotes(NOTES_DIR);
		await browser.executeObsidian(
			async ({ app }, path) => {
				const f = app.vault.getFileByPath(path);
				if (!f) throw new Error("note missing");
				await app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
					fm["Beschreibung"] = "Edited by hand";
				});
			},
			note as string,
		);
		await waitForFrontmatter(note as string, (fm) => fm["Beschreibung"] === "Edited by hand");
		await browser.waitUntil(async () => (await (await indexRow("timesheet.csv")).$(EDITED).isDisplayed()), { timeoutMsg: "no edited count" });
		const edited = (await indexRow("timesheet.csv")).$(EDITED);
		await expect(edited).toHaveText(expect.stringContaining("1 edited since import"));
		await expect(edited).toHaveAttribute("title", expect.stringContaining("Beschreibung"));
		await shot(SPEC, "edited", true);
		await expect(browser.$(INDEX)).toBeDisplayed();
	});
});
