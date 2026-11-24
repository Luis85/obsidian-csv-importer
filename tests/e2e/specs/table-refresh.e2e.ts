import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { chooseOption, openConfigDialog, openConfigTab, openCsv, shot, writeVault } from "../flows";
import {
	CSV, clickButton, installConsoleSpy, pluginProblems, readVaultFile, resetEverything, runCommand, runImportAndClose, waitForModal, waitForNoModal,
} from "../support";

const SPEC = "table-refresh";
const view = "[data-testid=csv-view]";
const status = () => browser.$(`${view} .csv-importer-status`);

/** The table view stays open in all of these: it must follow changes made elsewhere without being reopened. */
describe("table view: stays in step with the file and the plugin's state", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("shows a CSV that changed on disk", async function () {
		await openCsv(CSV);
		await expect(browser.$$("[data-testid=csv-table] tbody tr")).toBeElementsArrayOfSize(6);
		const text = await readVaultFile(CSV);
		await writeVault(CSV, `${text.trimEnd()}\n2026-11-24 00:00:00,Tester,Neue Zeile,1,1\n`);
		await browser.waitUntil(async () => (await browser.$$("[data-testid=csv-table] tbody tr").length) === 7, { timeoutMsg: "the table did not show the new row" });
		await expect(status()).toHaveText(expect.stringContaining("7 rows"));
	});

	it("shows the settings saved with the Configure command", async function () {
		await openCsv(CSV);
		await expect(status()).toHaveText(expect.stringContaining("comma"));
		await openConfigDialog();
		await openConfigTab("file");
		await chooseOption("[data-testid=import-config-modal]", "Delimiter", "Semicolon");
		await clickButton("Save");
		await waitForNoModal();
		await expect(status()).toHaveText(expect.stringContaining("semicolon"));
	});

	it("shows the import made with the import command (last import and Undo)", async function () {
		await openCsv(CSV);
		await runCommand("import-current-csv");
		await waitForModal(/import preview/i);
		await runImportAndClose();
		await expect(status()).toHaveText(expect.stringContaining("Imported"));
		await expect(browser.$(`${view} .csv-importer-status .csv-importer-link-btn`)).toHaveText("Undo");
		await expect(browser.$("[data-testid=csv-undo]")).toHaveAttribute("aria-label", "Undo last import");
		// And the undo made with the command takes the link away again.
		await runCommand("undo-import-current-csv");
		await waitForModal("Undo last import");
		await clickButton("Undo import");
		await browser.waitUntil(async () => !(await browser.$(`${view} .csv-importer-status .csv-importer-link-btn`).isExisting()), { timeoutMsg: "Undo link stayed" });
	});

	it("says when the CSV changed since the last import and re-imports from the status line", async function () {
		await openCsv(CSV);
		await expect(browser.$("[data-testid=csv-changed]")).not.toExist();
		await runCommand("import-current-csv");
		await waitForModal(/import preview/i);
		await runImportAndClose();
		await expect(browser.$("[data-testid=csv-changed]")).not.toExist();

		const text = await readVaultFile(CSV);
		await writeVault(CSV, text.replace("0.625,5", "9,5"));
		await expect(browser.$("[data-testid=csv-changed]")).toHaveText("Changed since last import");
		await expect(status()).toHaveText(expect.stringMatching(/Changed since last import\s*·\s*Re-import/));
		await shot(SPEC, "changed", true);

		await browser.$("[data-testid=csv-reimport]").click();
		await waitForModal(/import preview/i);
		await browser.$(`[data-testid=import-run-modal] .csv-importer-run-counts`).waitForExist();
		await runImportAndClose();
		await browser.waitUntil(async () => !(await browser.$("[data-testid=csv-changed]").isExisting()), { timeoutMsg: "still marked as changed after the re-import" });
	});
});
