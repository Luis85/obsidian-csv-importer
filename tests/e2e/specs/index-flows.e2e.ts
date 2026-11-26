import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { describe, it, before, beforeEach, after } from "mocha";
import { INDEX, clickMenuItem, indexRow, menuItems, openConfigDialog, openCsv, openIndex, shot, vaultExists } from "../flows";
import {
	CSV, CSV_DE, NOTES_DIR, PLUGIN_ID, activeViewType, clickButton, clickPastNotices, importViaDialog, installConsoleSpy, listNotes, pluginProblems, resetEverything, waitForModal, waitForNoModal,
} from "../support";

const SPEC = "index";

const openRowMenu = async (name: string) => {
	const row = await indexRow(name);
	await clickPastNotices(row.$(".csv-importer-index-more"));
};

describe("CSV imports index", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("lists a configured but never imported CSV with an Import button, which opens the preview", async function () {
		await openCsv(CSV);
		await openConfigDialog();
		await clickButton("Save");
		await waitForNoModal();
		await openIndex();
		const row = await indexRow("timesheet.csv");
		await expect(row).toHaveText(expect.stringContaining("Never imported"));
		// No notes yet: a muted dash, not "0".
		await expect((await indexRow("timesheet.csv")).$("[data-testid=csv-index-count]")).toHaveElementClass("mod-none");
		await expect(row.$("[data-testid=csv-index-primary]")).toHaveText("Import");
		await row.$("[data-testid=csv-index-primary]").click();
		await waitForModal(/import preview/i);
		await clickButton("Cancel");
		await waitForNoModal();
	});

	it("shows last import and note count, and Re-import runs the dialog", async function () {
		await importViaDialog(CSV);
		await openIndex();
		const row = await indexRow("timesheet.csv");
		await expect(row.$(".csv-importer-index-count")).toHaveText(expect.stringContaining("6"));
		await shot(SPEC, "index-with-import", true);
		// The index re-renders (counts load lazily), so look the button up again instead of reusing the old row.
		await (await indexRow("timesheet.csv")).$("[data-testid=csv-index-primary]").click();
		await waitForModal(/import preview/i);
		await expect(browser.$("[data-testid=import-run-modal] .csv-importer-run-counts")).toHaveText(expect.stringContaining("unchanged"));
		await clickButton("Cancel");
		await waitForNoModal();
	});

	it("filters the list and opens a CSV in the table view from its name", async function () {
		await importViaDialog(CSV);
		await importViaDialog(CSV_DE);
		await openIndex();
		await indexRow("timesheet-de.csv");
		await browser.$(`${INDEX} input.csv-importer-index-search`).setValue("-de");
		await browser.waitUntil(async () => (await browser.$$(`${INDEX} [data-testid=csv-index-row]`).length) === 1, { timeoutMsg: "filter did not narrow the list" });
		await (await indexRow("timesheet-de.csv")).$(".csv-importer-index-name").click();
		await browser.waitUntil(async () => (await activeViewType()) === "csv-importer-view", { timeoutMsg: "CSV did not open" });
	});

	/** Imports both CSVs, then starts Re-import all from the index and waits for the first preview. */
	async function importBothAndReimportAll(): Promise<void> {
		await importViaDialog(CSV);
		await importViaDialog(CSV_DE);
		await openIndex();
		// The button is disabled until the list has loaded; clicking earlier does nothing. (openIndex has dismissed the
		// "Created <base>." notices of the two imports, which cover this button on CI's window.)
		await indexRow("timesheet-de.csv");
		const all = browser.$(`${INDEX} .csv-importer-index-all`);
		await all.waitForEnabled();
		await clickPastNotices(all);
		await waitForModal(/import preview/i);
	}

	it("re-imports every listed CSV with Re-import all", async function () {
		await importBothAndReimportAll();
		await clickButton("Cancel");
		// Closing a dialog without importing asks whether to go on with the rest.
		await waitForModal("Continue with the next CSV file?");
		await clickButton("Continue");
		await waitForModal(/import preview/i);
		await clickButton("Cancel");
		await waitForNoModal(); // the last one: nothing left to ask about
	});

	it("stops Re-import all in one step when told not to go on", async function () {
		await importBothAndReimportAll();
		await clickButton("Cancel");
		await waitForModal("Continue with the next CSV file?");
		await clickButton("Cancel");
		await waitForNoModal();
	});

	it("offers Import settings, Open base, Undo last import, Delete imported notes and Remove from CSV imports in the row menu", async function () {
		await importViaDialog(CSV);
		await openIndex();
		await openRowMenu("timesheet.csv");
		expect(await menuItems()).toEqual(["Import settings", "Open base", "Undo last import", "Delete imported notes...", "Remove from CSV imports..."]);
		await shot(SPEC, "row-menu", true);
		await clickMenuItem("Import settings");
		await waitForModal("Properties");
		await clickButton("Cancel");
		await waitForNoModal();
	});

	it("opens the base from the row menu", async function () {
		await importViaDialog(CSV);
		await openIndex();
		await openRowMenu("timesheet.csv");
		await clickMenuItem("Open base");
		await browser.waitUntil(async () => (await activeViewType()) === "bases", { timeoutMsg: "base did not open" });
	});

	it("undoes the last import from the row menu", async function () {
		await importViaDialog(CSV);
		await openIndex();
		await openRowMenu("timesheet.csv");
		await clickMenuItem("Undo last import");
		await waitForModal("Undo last import");
		await clickButton("Undo import");
		await browser.waitUntil(async () => (await listNotes(NOTES_DIR)).length === 0, { timeoutMsg: "notes still present after undo" });
	});

	it("deletes the imported notes and, when ticked, the base, keeping the CSV's settings", async function () {
		await importViaDialog(CSV);
		await openIndex();
		await openRowMenu("timesheet.csv");
		await clickMenuItem("Delete imported notes...");
		await waitForModal("Delete imported notes?");
		await browser.$(".csv-importer-confirm-option input").click();
		await shot(SPEC, "delete-confirm", true);
		await clickButton("Delete notes");
		await browser.waitUntil(async () => (await listNotes(NOTES_DIR)).length === 0, { timeoutMsg: "notes were not deleted" });
		await browser.waitUntil(async () => !(await vaultExists("Data/timesheet.base")), { timeoutMsg: "base was not deleted" });
		expect(await vaultExists(CSV)).toBe(true);
		// The row stays, with its import history reset.
		await expect(await indexRow("timesheet.csv")).toBeDisplayed();
	});

	it("removes a CSV from CSV imports but keeps its notes", async function () {
		await importViaDialog(CSV);
		await openIndex();
		await openRowMenu("timesheet.csv");
		await clickMenuItem("Remove from CSV imports...");
		await waitForModal("Remove from CSV imports?");
		await clickButton("Remove");
		await browser.waitUntil(async () => (await browser.$$(`${INDEX} [data-testid=csv-index-row]`).length) === 0, { timeoutMsg: "row stayed" });
		expect(await listNotes(NOTES_DIR)).toHaveLength(6);
		await expect(browser.$(".csv-importer-index-empty-title")).toHaveText("No imports yet");
	});

	it("marks a CSV that no longer exists as CSV missing", async function () {
		await importViaDialog(CSV);
		// Removed while the plugin is not running (as when a sync tool deletes it): the saved settings outlive the file.
		await obsidianPage.disablePlugin(PLUGIN_ID);
		await browser.executeObsidian(async ({ app }) => app.vault.adapter.remove("Data/timesheet.csv"));
		await obsidianPage.enablePlugin(PLUGIN_ID);
		await openIndex();
		await browser.waitUntil(async () => (await (await indexRow("timesheet.csv")).getText()).includes("CSV missing"), { timeoutMsg: "no CSV missing marker" });
		await shot(SPEC, "csv-missing", true);
	});

	it("keeps a CSV deleted inside Obsidian as CSV missing, and restores it when the file comes back", async function () {
		await importViaDialog(CSV);
		const bytes = await browser.executeObsidian(async ({ app }) => {
			const f = app.vault.getFileByPath("Data/timesheet.csv")!;
			const data = await app.vault.readBinary(f);
			await app.vault.delete(f);
			return Array.from(new Uint8Array(data));
		});
		await openIndex();
		await browser.waitUntil(async () => (await (await indexRow("timesheet.csv")).getText()).includes("CSV missing"), { timeoutMsg: "no CSV missing marker" });
		await browser.executeObsidian(async ({ app }, b) => {
			await app.vault.createBinary("Data/timesheet.csv", new Uint8Array(b).buffer);
		}, bytes);
		await browser.waitUntil(async () => !(await (await indexRow("timesheet.csv")).getText()).includes("CSV missing"), { timeoutMsg: "still missing" });
		const undoable = await browser.executeObsidian(({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { canUndo(f: unknown): boolean }> } }).plugins.plugins["csv-importer"]!;
			return plugin.canUndo(app.vault.getFileByPath("Data/timesheet.csv"));
		});
		expect(undoable).toBe(true);
	});
});
