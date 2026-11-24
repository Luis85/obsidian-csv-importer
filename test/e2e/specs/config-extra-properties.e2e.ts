import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { clickMenuItem, openConfigDialog, openCsv, shot } from "../flows";
import {
	CSV, NOTES_DIR, clickButton, importViaDialog, installConsoleSpy, listNotes, pluginProblems, readVaultFile, resetEverything, waitForNoModal,
} from "../support";

const SPEC = "config-extra-properties";
const MODAL = "[data-testid=import-config-modal]";
const ROWS = `${MODAL} [data-testid=config-extra-row]`;

/** Extra properties are rows of the Columns table: add, type and default, preview, import, remove. */
describe("import settings: extra properties as table rows", function () {
	before(installConsoleSpy);
	beforeEach(async function () {
		await resetEverything();
		await openCsv(CSV);
		await openConfigDialog();
	});
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	const addEmpty = async () => {
		await browser.$(`${MODAL} .csv-importer-extra-add button`).click();
		await clickMenuItem("Empty property");
	};

	it("has no separate Extra properties section, only a short help line under the table", async function () {
		await expect(browser.$(MODAL)).not.toHaveText(expect.stringContaining("Extra properties"));
		await expect(browser.$(`${MODAL} .csv-importer-extra-help`)).toHaveText(expect.stringContaining("CSV is not changed"));
		await expect(browser.$(`${MODAL} .csv-importer-extra-add button`)).toHaveText("Add property");
		await expect(browser.$$(ROWS)).toBeElementsArrayOfSize(0);
	});

	it("adds a row, sets a {{uuid}} default, shows it in the sample and preview, and imports it", async function () {
		await addEmpty();
		await expect(browser.$$(ROWS)).toBeElementsArrayOfSize(1);
		const row = browser.$(ROWS);
		await expect(row).toHaveText(expect.stringContaining("New property"));
		await expect(row.$(".csv-importer-extra-warning")).toBeDisplayed();
		await expect(row.$(".csv-importer-col-options")).not.toBeDisplayed();

		await row.$("input.csv-importer-col-prop").setValue("uid");
		await row.$("select.csv-importer-col-type").selectByVisibleText("Text");
		await expect(row.$(".csv-importer-extra-warning")).not.toBeDisplayed();
		await row.$(".csv-importer-col-options-btn").click();
		await expect(row.$(".csv-importer-col-options")).toBeDisplayed();
		let uuidChip: WebdriverIO.Element | undefined;
		for (const c of await row.$$(".csv-importer-chip")) if ((await c.getText()) === "{{uuid}}") uuidChip = c;
		await uuidChip?.click();
		await expect(row.$("input.csv-importer-extra-default")).toHaveValue("{{uuid}}");
		await browser.waitUntil(async () => /^[0-9a-f-]{36}$/.test(await row.$(".csv-importer-col-sample").getText()), { timeoutMsg: "no uuid in the sample cell" });
		await browser.waitUntil(async () => /uid: [0-9a-f-]{36}/.test(await browser.$(`${MODAL} .csv-importer-preview`).getText()), { timeoutMsg: "preview lacks uid" });
		await shot(SPEC, "extra-row-open", true);

		await clickButton("Save", MODAL);
		await waitForNoModal();
		await importViaDialog(CSV);
		const notes = await listNotes(NOTES_DIR);
		expect(notes).toHaveLength(6);
		expect(await readVaultFile(notes[0] as string)).toMatch(/uid: [0-9a-f-]{36}/);
	});

	it("flags a name that is also a CSV column and removes the row with the trash button", async function () {
		await addEmpty();
		const row = browser.$(ROWS);
		await row.$("input.csv-importer-col-prop").setValue("Rolle");
		await expect(row.$(".csv-importer-extra-warning")).toHaveText(expect.stringContaining("CSV column"));
		await shot(SPEC, "extra-row-warning", true);
		await row.$(".csv-importer-extra-remove").click();
		await expect(browser.$$(ROWS)).toBeElementsArrayOfSize(0);
	});
});
