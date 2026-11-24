import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { openCsv, shot } from "../flows";
import {
	CSV, NOTES_DIR, clickButton, findNoteByFrontmatter, installConsoleSpy, listNotes, pluginProblems, resetEverything, waitForModal, waitForNoModal,
} from "../support";

const SPEC = "table-selection";
const MODAL = "[data-testid=import-run-modal]";
const rowCheck = (row: number) => browser.$(`[data-testid=csv-row-check][data-row="${row}"]`);
const importBtn = () => browser.$("[data-testid=csv-import]");
const selectedRows = () => browser.$$("[data-testid=csv-table] tbody tr.is-selected").length;

/** A click with the shift key held, as a user shift-clicks a checkbox. */
const shiftClick = (row: number) =>
	browser.execute((r) => {
		const box = document.querySelector(`[data-testid=csv-row-check][data-row="${r}"]`) as HTMLInputElement;
		box.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
	}, row);

describe("table view: select rows and import only those", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("selecting rows changes the primary button and the status line, and Clear selection undoes it", async function () {
		await openCsv(CSV);
		await expect(importBtn()).toHaveText("Import 6 rows");
		await rowCheck(2).click();
		await expect(importBtn()).toHaveText("Import 1 selected row");
		await rowCheck(4).click();
		await expect(importBtn()).toHaveText("Import 2 selected rows");
		expect(await selectedRows()).toBe(2);
		await expect(browser.$("[data-testid=csv-selected-count]")).toHaveText("2 rows selected");
		await shot(SPEC, "selected", true);
		await browser.$("[data-testid=csv-clear-selection]").click();
		await expect(importBtn()).toHaveText("Import 6 rows");
		expect(await selectedRows()).toBe(0);
		await expect(browser.$("[data-testid=csv-clear-selection]")).not.toExist();
	});

	it("shift-click selects a range", async function () {
		await openCsv(CSV);
		await rowCheck(2).click();
		await shiftClick(5);
		await expect(importBtn()).toHaveText("Import 4 selected rows");
		expect(await selectedRows()).toBe(4);
	});

	it("the header checkbox selects every matching row and clears them again", async function () {
		await openCsv(CSV);
		const all = browser.$("[data-testid=csv-select-all]");
		await all.click();
		await expect(importBtn()).toHaveText("Import 6 selected rows");
		expect(await all.getProperty("checked")).toBe(true);
		await all.click();
		await expect(importBtn()).toHaveText("Import 6 rows");

		// With a filter it selects the matching rows only.
		await browser.$("[data-testid=csv-view] input.csv-importer-search").setValue("Softwareentwickler");
		await browser.waitUntil(async () => (await browser.$$("[data-testid=csv-table] tbody tr").length) === 4, { timeoutMsg: "filter did not apply" });
		await browser.$("[data-testid=csv-select-all]").click();
		await expect(importBtn()).toHaveText("Import 4 selected rows");
		await shot(SPEC, "header-checkbox-filtered");
	});

	it("imports only the selected rows and clears the selection afterwards", async function () {
		await openCsv(CSV);
		await rowCheck(2).click();
		await rowCheck(5).click();
		await importBtn().click();
		await waitForModal(/import preview/i);
		await browser.$(`${MODAL} .csv-importer-run-counts`).waitForExist();
		await expect(browser.$(`${MODAL} .csv-importer-run-counts`)).toHaveText("2 new");
		await expect(browser.$("[data-testid=run-import]")).toHaveText("Import 2 notes");
		await shot(SPEC, "preview-selected", true);
		await clickButton("Import 2 notes");
		await waitForModal("Import finished");
		await browser.$("[data-testid=run-close]").click();
		await waitForNoModal();
		expect(await listNotes(NOTES_DIR)).toHaveLength(2);
		await findNoteByFrontmatter(NOTES_DIR, "Datum", "2026-11-19");
		await findNoteByFrontmatter(NOTES_DIR, "Datum", "2026-11-22");
		await expect(importBtn()).toHaveText("Import 6 rows");
		expect(await selectedRows()).toBe(0);
	});

	it("keeps the selection when the dialog is cancelled", async function () {
		await openCsv(CSV);
		await rowCheck(3).click();
		await importBtn().click();
		await waitForModal(/import preview/i);
		await clickButton("Cancel");
		await waitForNoModal();
		await expect(importBtn()).toHaveText("Import 1 selected row");
		expect(await listNotes(NOTES_DIR)).toEqual([]);
	});
});
