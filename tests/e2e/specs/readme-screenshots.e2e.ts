import { mkdirSync } from "node:fs";
import { browser } from "@wdio/globals";
import { describe, it, before, beforeEach } from "mocha";
import { clickMenuItem, openConfigTab, openCsv, patchConfig, setWindowSize, writeVault } from "../flows";
import {
	CSV, CSV_DE, clickButton, importViaDialog, installConsoleSpy, openFile, readVaultFile, resetEverything, runCommand, setColorScheme, waitForModal,
	waitForNoModal, waitForViewType,
} from "../support";

/**
 * Captures the images the README shows, in real Obsidian with its default light theme, into docs/images/ under the
 * names the README uses. Runs only with README_SCREENSHOTS=1 (`npm run screenshots:readme`), which also starts
 * Obsidian with a device scale factor of 2 (see wdio.conf.mts) so the images are sharp.
 */
const OUT = "docs/images";

const capture = async (selector: string, name: string) => {
	mkdirSync(OUT, { recursive: true });
	const element = browser.$(selector);
	await element.waitForDisplayed();
	await browser.pause(300);
	await element.saveScreenshot(`${OUT}/${name}.png`);
};

describe("README screenshots", function () {
	before(async function () {
		if (process.env["README_SCREENSHOTS"] !== "1") this.skip();
		await installConsoleSpy();
		await setWindowSize(1280, 860);
	});
	beforeEach(async function () {
		await resetEverything();
		await setColorScheme("light");
		await browser.executeObsidian(({ app }) => {
			app.workspace.leftSplit.collapse();
			app.workspace.rightSplit.collapse();
		});
	});

	it("table-view.png: the German timesheet with detected column types", async function () {
		await openCsv(CSV_DE);
		await capture("[data-testid=csv-view]", "table-view");
	});

	it("import-settings.png: columns, types and live note preview", async function () {
		await openCsv(CSV_DE);
		await browser.$("[data-testid=csv-configure]").click();
		await browser.$("[data-testid=import-config-modal]").waitForDisplayed();
		await capture("[data-testid=import-config-modal]", "import-settings");
	});

	it("import-settings-reimport.png: keep edited values, composite key, extra ID property", async function () {
		await openCsv(CSV_DE);
		await browser.$("[data-testid=csv-configure]").click();
		await browser.$("[data-testid=import-config-modal]").waitForDisplayed();
		await browser.$(".csv-importer-extra-add button").click();
		await clickMenuItem("ID (unique per note)");
		await openConfigTab("reimport");
		for (const column of ["Datum", "Rolle"]) {
			await browser.$(`//*[@data-testid="import-config-modal"]//label[contains(@class,"csv-importer-key-option")][.//span[contains(@class,"csv-importer-key-name") and normalize-space()="${column}"]]//input`).click();
		}
		await capture("[data-testid=import-config-modal]", "import-settings-reimport");
	});

	it("import-preview.png: results grouped by outcome", async function () {
		// First import, then a changed CSV: two rows changed, two rows added, the rest unchanged.
		await patchConfig(CSV_DE, { keyColumns: ["Datum", "Rolle"], keyProperty: "import_key" });
		await importViaDialog(CSV_DE);
		const text = await readVaultFile(CSV_DE);
		const lines = text.trim().split("\n");
		lines[1] = (lines[1] ?? "").replace("0,625", "0,75");
		lines[2] = (lines[2] ?? "").replace("0,5", "1");
		lines.push("2026-11-24;Projektleiter;Retrospektive;0,5;4", "2026-11-25;Softwareentwickler;Release-Vorbereitung;0,75;6");
		await writeVault(CSV_DE, `${lines.join("\n")}\n`);
		await openFile(CSV_DE);
		await waitForViewType("csv-importer-view");
		await runCommand("import-current-csv");
		await waitForModal(/import preview/i);
		await browser.$("[data-testid=import-run-modal] .csv-importer-run-counts").waitForExist();
		await capture("[data-testid=import-run-modal]", "import-preview");
		await clickButton("Cancel");
		await waitForNoModal();
	});

	it("imports-index.png: the CSV imports index", async function () {
		await importViaDialog(CSV);
		await importViaDialog(CSV_DE);
		await importViaDialog("Data/people.csv");
		await runCommand("open-import-index");
		await waitForViewType("csv-importer-index");
		await browser.$("[data-testid=csv-index-row]").waitForDisplayed();
		// The imports above leave "Created ….base" notices on screen; remove them so they don't cover the toolbar.
		await browser.execute(() => document.querySelectorAll(".notice-container .notice").forEach((n) => n.remove()));
		await browser.pause(800);
		await capture("[data-testid=csv-index]", "imports-index");
	});
});
