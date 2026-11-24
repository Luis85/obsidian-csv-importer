import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { CSV, importViaDialog, installConsoleSpy, pluginProblems, reloadPlugin, resetEverything, runCommand, waitForViewType } from "../support";

// The file name is a leftover of a debugging spec that could not be deleted from the sandbox; rename it to persistence.e2e.ts.
describe("persistence across plugin reloads", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("keeps import settings, history and undo data after the plugin is reloaded", async function () {
		await importViaDialog(CSV);
		await reloadPlugin();
		await runCommand("open-import-index");
		await waitForViewType("csv-importer-index");
		const row = browser.$("[data-testid=csv-index-row]");
		await expect(row).toHaveText(expect.stringContaining("timesheet.csv"));
		await expect(row.$("[data-testid=csv-index-primary]")).toHaveText("Re-import");
		await expect(row.$(".csv-importer-index-count")).toHaveText(expect.stringContaining("6"));
	});
});
