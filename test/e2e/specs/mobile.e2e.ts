import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { CSV, installConsoleSpy, openFile, pluginProblems, resetEverything, runCommand, waitForModal, waitForViewType } from "../support";

/** Runs only in the mobile-emulation capability (E2E_MOBILE=1 or only); skipped on desktop. */
describe("mobile emulation smoke", function () {
	let isMobile = false;
	before(async function () {
		await installConsoleSpy();
		isMobile = await browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
		if (!isMobile) this.skip();
	});
	beforeEach(async function () {
		await resetEverything();
	});
	after(async function () {
		if (isMobile) expect(await pluginProblems()).toEqual([]);
	});

	it("opens the CSV view and the import dialog with visible buttons", async function () {
		await openFile(CSV);
		await waitForViewType("csv-importer-view");
		await expect(browser.$("[data-testid=csv-table]")).toBeDisplayed();
		await expect(browser.$("[data-testid=csv-import]")).toBeDisplayed();

		await runCommand("import-current-csv");
		await waitForModal(/import preview/i);
		await expect(browser.$("[data-testid=run-import]")).toBeDisplayed();
		await expect(browser.$("[data-testid=run-import]")).toBeClickable();
	});
});
