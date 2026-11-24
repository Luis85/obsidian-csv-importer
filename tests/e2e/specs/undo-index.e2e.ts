import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { openCsv } from "../flows";
import {
	CSV, NOTES_DIR, clickButton, importViaDialog, installConsoleSpy, listNotes, noticeTexts, pluginProblems, resetEverything, runCommand,
	waitForModal, waitForNoModal, waitForViewType,
} from "../support";

describe("undo and imports index", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("undoes the last import after confirmation", async function () {
		await importViaDialog(CSV);
		expect(await listNotes(NOTES_DIR)).toHaveLength(6);

		await runCommand("undo-import-current-csv");
		await waitForModal("Undo last import");
		await clickButton("Undo import");
		await waitForNoModal();

		await browser.waitUntil(async () => (await listNotes(NOTES_DIR)).length === 0, {
			timeoutMsg: "imported notes are still in the vault after undo",
		});
	});

	it("lists the imported CSV in the imports index with a Re-import button", async function () {
		await importViaDialog(CSV);
		await runCommand("open-import-index");
		await waitForViewType("csv-importer-index");

		const row = browser.$("[data-testid=csv-index-row]");
		await expect(row).toBeDisplayed();
		await expect(row).toHaveText(expect.stringContaining("timesheet.csv"));
		await expect(row.$("[data-testid=csv-index-primary]")).toHaveText("Re-import");
	});

	it("undoes from the Undo link in the table view's status line", async function () {
		await openCsv(CSV);
		await browser.$("[data-testid=csv-import]").click();
		await waitForModal(/import preview/i);
		await browser.$("[data-testid=run-import]").click();
		await waitForModal("Import finished");
		await browser.$("[data-testid=run-close]").click();
		await waitForNoModal();
		await browser.$("[data-testid=csv-view] .csv-importer-link-btn").click();
		await waitForModal("Undo last import");
		await clickButton("Undo import");
		await browser.waitUntil(async () => (await listNotes(NOTES_DIR)).length === 0, { timeoutMsg: "notes still present after undo" });
		await browser.waitUntil(async () => !(await browser.$("[data-testid=csv-view] .csv-importer-link-btn").isExisting()), { timeoutMsg: "Undo link stayed" });
	});

	it("offers Undo last import in the file menu once an import can be undone", async function () {
		const titles = () =>
			browser.executeObsidian(({ app, obsidian }) => {
				const menu = new obsidian.Menu();
				app.workspace.trigger("file-menu", menu, app.vault.getAbstractFileByPath("Data/timesheet.csv"), "file-explorer");
				return (menu as unknown as { items: { titleEl?: HTMLElement }[] }).items.map((i) => i.titleEl?.textContent ?? "");
			});
		expect(await titles()).not.toContain("Undo last import");
		await importViaDialog(CSV);
		expect(await titles()).toContain("Undo last import");
	});

	it("moves created notes to the trash and tells so in a notice", async function () {
		await importViaDialog(CSV);
		await runCommand("undo-import-current-csv");
		await waitForModal("Undo last import");
		await clickButton("Undo import");
		await browser.waitUntil(async () => (await noticeTexts()).some((t) => t.includes("Import undone")), { timeoutMsg: "no undo notice" });
	});
});
