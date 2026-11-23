import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach } from "mocha";
import { CSV, importViaDialog, installConsoleSpy, openFile, pluginProblems, resetEverything, runCommand, waitForModal, waitForViewType } from "../support";

/**
 * The plugin makes no network request at runtime (it only reads vault files). After the table view, the settings
 * dialog and an import have run, no resource entry of the page may point to a web host. Same check as the
 * no-network spec of the author's weg-manager plugin.
 */
describe("no network at runtime", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);

	it("requests no web resource while the view, the settings dialog and an import run", async function () {
		await openFile(CSV);
		await waitForViewType("csv-importer-view");
		await runCommand("configure-current-csv");
		await waitForModal("Columns");
		await browser.$("[data-testid=import-config-modal] .csv-importer-cancel").click();
		await importViaDialog(CSV);
		await expect(browser.$("[data-testid=csv-table]")).toExist();
		// A negative check has no signal to wait for; allow a network round trip to show up as a resource entry.
		await browser.pause(1000);

		const external = await browser.executeObsidian(() =>
			performance
				.getEntriesByType("resource")
				.map((entry) => entry.name)
				.filter((name) => /^(https?|wss?):/i.test(name)),
		);
		expect(external).toEqual([]);
		expect(await pluginProblems()).toEqual([]);
	});
});
