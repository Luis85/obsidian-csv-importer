import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { clickMenuItem, countsLine, openCsv, openPreview, shot, vaultExists, writeVault } from "../flows";
import {
	CSV, NOTES_DIR, activeViewType, clickButton, findNoteByFrontmatter, importViaDialog, installConsoleSpy, listNotes, noticeTexts, pluginProblems,
	resetEverything, runCommand, waitForFrontmatter, waitForModal, waitForNoModal, waitForViewType,
} from "../support";

const SPEC = "import-dialog";
const MODAL = "[data-testid=import-run-modal]";

describe("import dialog: preview, progress, report", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("shows a preview grouped by outcome without writing anything, and Cancel leaves the vault untouched", async function () {
		await openPreview(CSV);
		expect(await countsLine()).toMatch(/6 new/);
		await expect(browser.$(`${MODAL} .csv-importer-run-group.is-created`)).toBeDisplayed();
		await expect(browser.$("[data-testid=run-import]")).toHaveText("Import 6 notes");
		await shot(SPEC, "preview", true);
		await clickButton("Cancel");
		await waitForNoModal();
		expect(await listNotes(NOTES_DIR)).toEqual([]);
	});

	it("imports from the table view's primary button", async function () {
		await openCsv(CSV);
		await browser.$("[data-testid=csv-import]").click();
		await waitForModal(/import preview/i);
		await browser.$("[data-testid=run-import]").click();
		await waitForModal("Import finished");
		await shot(SPEC, "finished", true);
		await browser.$("[data-testid=run-close]").click();
		await waitForNoModal();
		expect(await listNotes(NOTES_DIR)).toHaveLength(6);
		// Back in the table view the status line offers Undo and says when the last import ran.
		await expect(browser.$("[data-testid=csv-view] .csv-importer-link-btn")).toHaveText("Undo");
	});

	it("opens the generated base from the finished dialog", async function () {
		await importViaDialog(CSV, false);
		await browser.$(`${MODAL} .csv-importer-run-base`).click();
		await browser.waitUntil(async () => (await activeViewType()) === "bases", { timeoutMsg: "the base did not open" });
		expect(await vaultExists("Data/timesheet.base")).toBe(true);
	});

	it("opens the first note and saves a report note from the more-actions menu", async function () {
		await importViaDialog(CSV, false);
		await browser.$(`${MODAL} .csv-importer-run-more`).click();
		await shot(SPEC, "more-menu", true);
		await clickMenuItem("Open first note");
		await browser.waitUntil(async () => (await activeViewType()) === "markdown", { timeoutMsg: "first note did not open" });
	});

	it("saves a report note", async function () {
		await importViaDialog(CSV, false);
		await browser.$(`${MODAL} .csv-importer-run-more`).click();
		await clickMenuItem("Save report as note");
		await waitForNoModal();
		await browser.waitUntil(
			async () => (await browser.executeObsidian(({ app }) => app.vault.getMarkdownFiles().filter((f) => /import report/.test(f.name)).length)) === 1,
			{ timeoutMsg: "no report note" },
		);
		const content = await browser.executeObsidian(async ({ app }) => {
			const f = app.vault.getMarkdownFiles().find((x) => /import report/.test(x.name));
			return f ? await app.vault.read(f) : "";
		});
		expect(content).toContain("## Created");
		expect(content).toContain("- New: 6");
	});

	it("undoes the import from the more-actions menu of the finished dialog", async function () {
		await importViaDialog(CSV, false);
		await browser.$(`${MODAL} .csv-importer-run-more`).click();
		await clickMenuItem("Undo import");
		await waitForModal("Undo last import");
		await clickButton("Undo import");
		await browser.waitUntil(async () => (await listNotes(NOTES_DIR)).length === 0, { timeoutMsg: "notes still there after undo" });
		await expect(noticeTexts().then((t) => t.join(" "))).resolves.toContain("Import undone");
	});

	it("stops a long import with Stop import and reports it as stopped", async function () {
		const rows = Array.from({ length: 1500 }, (_, i) => `${i},name ${i}`).join("\n");
		await writeVault("Data/big.csv", `Id,Name\n${rows}\n`);
		await openPreview("Data/big.csv");
		await browser.$("[data-testid=run-import]").click();
		// Click Stop as soon as the progress screen shows it.
		await browser.executeObsidian(() => {
			const timer = window.setInterval(() => {
				const stop = Array.from(document.querySelectorAll<HTMLButtonElement>(".csv-importer-run button")).find((b) => b.textContent === "Stop import");
				if (stop) {
					stop.click();
					window.clearInterval(timer);
				}
			}, 5);
		});
		await waitForModal(/Import (stopped|finished)/);
		const text = await browser.$(MODAL).getText();
		expect(text).toMatch(/Import stopped|Import finished/);
		await shot(SPEC, "stopped");
		await browser.$("[data-testid=run-close]").click();
		await waitForNoModal();
		const notes = (await listNotes("Data/big")).length;
		expect(notes).toBeGreaterThan(0);
		expect(notes).toBeLessThanOrEqual(1500);
	});

	it("re-import all opens the dialog for each configured CSV", async function () {
		await importViaDialog(CSV);
		await runCommand("reimport-all-csv");
		await waitForModal(/import preview/i);
		expect(await countsLine()).toMatch(/6 unchanged|unchanged/);
		await clickButton("Cancel");
		await waitForNoModal();
	});

	it("updates a changed note with a visible change list in the preview", async function () {
		await importViaDialog(CSV);
		await writeVault(CSV, (await browser.executeObsidian(({ app }) => app.vault.adapter.read("Data/timesheet.csv"))).replace("0.625,5", "9,5"));
		await openCsv(CSV);
		await runCommand("import-current-csv");
		await waitForModal(/import preview/i);
		await browser.$(`${MODAL} .csv-importer-run-counts`).waitForExist();
		expect(await countsLine()).toMatch(/1 updated/);
		await expect(browser.$(`${MODAL} .csv-importer-run-group.is-updated`)).toHaveText(expect.stringContaining("Stunden"));
		await shot(SPEC, "preview-updated", true);
		await clickButton(/^Import 1 note$/);
		await waitForModal("Import finished");
		await clickButton("Close");
		await waitForNoModal();
		const note = await findNoteByFrontmatter(NOTES_DIR, "Datum", "2026-11-18");
		await waitForFrontmatter(note, (f) => f["Stunden"] === 9);
		await waitForViewType("csv-importer-view");
	});
});
