import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { countsLine, openPreview, shot, writeVault } from "../flows";
import {
	CSV, NOTES_DIR, clickButton, findNoteByFrontmatter, installConsoleSpy, listNotes, pluginProblems, resetEverything, waitForModal, waitForNoModal,
} from "../support";

const SPEC = "run-selection";
const MODAL = "[data-testid=import-run-modal]";
const rowBox = (row: number) => browser.$(`${MODAL} [data-testid=run-row-check][data-row="${row}"]`);
const groupBox = (group: string) => browser.$(`${MODAL} .csv-importer-run-group.is-${group} [data-testid=run-group-check]`);
const importBtn = () => browser.$("[data-testid=run-import]");

describe("import dialog: choose which notes to import", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("starts with every New note checked; unchecking rows updates the button and leaves them out of the run", async function () {
		await openPreview(CSV);
		await expect(importBtn()).toHaveText("Import 6 notes");
		expect(await rowBox(1).getProperty("checked")).toBe(true);
		await rowBox(1).click();
		await rowBox(3).click();
		await expect(importBtn()).toHaveText("Import 4 of 6 notes");
		await shot(SPEC, "some-unchecked", true);
		await importBtn().click();
		await waitForModal("Import finished");
		// The report says what was written; the unchecked rows are not part of it.
		await expect(browser.$(`${MODAL} .csv-importer-run-counts`)).toHaveText("4 new");
		await browser.$("[data-testid=run-close]").click();
		await waitForNoModal();
		expect(await listNotes(NOTES_DIR)).toHaveLength(4);
		await findNoteByFrontmatter(NOTES_DIR, "Datum", "2026-11-19");
	});

	it("the group checkbox toggles the whole group and the button disables when nothing is checked", async function () {
		await openPreview(CSV);
		await groupBox("created").click();
		await expect(importBtn()).toBeDisabled();
		expect(await rowBox(2).getProperty("checked")).toBe(false);
		await groupBox("created").click();
		await expect(importBtn()).toHaveText("Import 6 notes");
		await rowBox(2).click();
		expect(await groupBox("created").getProperty("indeterminate")).toBe(true);
		await clickButton("Cancel");
		await waitForNoModal();
		expect(await listNotes(NOTES_DIR)).toEqual([]);
	});

	it("covers rows beyond the 200 listed ones and offers no checkbox for Unchanged notes", async function () {
		const rows = Array.from({ length: 250 }, (_, i) => `${i},row ${i}`).join("\n");
		await writeVault("Data/many.csv", `Id,Text\n${rows}\n`);
		await openPreview("Data/many.csv");
		await expect(importBtn()).toHaveText("Import 250 notes");
		await groupBox("created").click();
		await expect(importBtn()).toBeDisabled();
		await groupBox("created").click();
		// Clicking the group checkbox did not open the group; the title does.
		await expect(browser.$(`${MODAL} .csv-importer-run-group.is-created`)).not.toHaveAttribute("open");
		await browser.$(`${MODAL} .csv-importer-run-group.is-created .csv-importer-run-group-name`).click();
		await rowBox(1).click();
		await expect(importBtn()).toHaveText("Import 249 of 250 notes");
		await clickButton("Cancel");
		await waitForNoModal();

		// After a first import the unchanged rows are listed without checkboxes.
		await openPreview(CSV);
		await importBtn().click();
		await waitForModal("Import finished");
		await browser.$("[data-testid=run-close]").click();
		await waitForNoModal();
		await openPreview(CSV);
		expect(await countsLine()).toBe("6 unchanged");
		await expect(browser.$(`${MODAL} [data-testid=run-row-check]`)).not.toExist();
		await clickButton("Cancel");
		await waitForNoModal();
	});
});
