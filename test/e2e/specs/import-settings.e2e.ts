import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { chooseOption, clickMenuItem, openConfigDialog, openConfigTab, openCsv, setting, shot } from "../flows";
import {
	CSV, NOTES_DIR, PLUGIN_ID, clickButton, findNoteByFrontmatter, importViaDialog, installConsoleSpy, listNotes, pluginProblems, resetEverything,
	waitForFrontmatter, waitForModal, waitForNoModal, readVaultFile,
} from "../support";

const SPEC = "import-settings";
const MODAL = "[data-testid=import-config-modal]";

/** The saved import settings of a CSV (what the dialog persisted). */
const savedConfig = (csv: string) =>
	browser.executeObsidian(
		({ app }, id, path) => {
			type Service = { getFileConfig(f: unknown): Record<string, unknown> };
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { service: Service }> } }).plugins.plugins[id];
			const file = app.vault.getFileByPath(path);
			return plugin && file ? (JSON.parse(JSON.stringify(plugin.service.getFileConfig(file))) as Record<string, unknown>) : null;
		},
		PLUGIN_ID,
		csv,
	);

describe("import settings dialog", function () {
	before(installConsoleSpy);
	beforeEach(async function () {
		await resetEverything();
		await openCsv(CSV);
	});
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("opens from the Configure button with a summary line and four tabs", async function () {
		await browser.$("[data-testid=csv-configure]").click();
		await waitForModal("Columns");
		const summary = await browser.$(`${MODAL} [data-testid=config-summary]`).getText();
		expect(summary).toContain("6 rows");
		expect(summary).toContain("comma");
		await shot(SPEC, "columns-tab", true);
		for (const id of ["notes", "reimport", "file"] as const) {
			await openConfigTab(id);
			await expect(browser.$(`[data-testid=config-tab-${id}]`)).toHaveAttribute("aria-selected", "true");
			await shot(SPEC, `${id}-tab`);
		}
	});

	it("jumps to a tab from its summary part", async function () {
		await openConfigDialog();
		const parts = await browser.$$(`${MODAL} [data-testid=config-summary-link]`);
		let keyPart: WebdriverIO.Element | undefined;
		for (const p of parts) if (/key/.test(await p.getText())) keyPart = p;
		await keyPart?.click();
		await expect(browser.$("[data-testid=config-tab-reimport]")).toHaveAttribute("aria-selected", "true");
	});

	it("cancel closes the dialog without saving settings", async function () {
		await openConfigDialog();
		await openConfigTab("notes");
		await (await setting(MODAL, "Target folder")).$("input").setValue("Elsewhere");
		await clickButton("Cancel");
		await waitForNoModal();
		expect((await savedConfig(CSV))?.["targetFolder"]).toBe("");
	});

	it("saves notes settings and imports with Import now (target folder, file name template, tags)", async function () {
		await openConfigDialog();
		await openConfigTab("notes");
		await (await setting(MODAL, "Target folder")).$("input").setValue("Work/Hours");
		await (await setting(MODAL, "File name template")).$("input").setValue("{{Datum}} {{Rolle}}");
		await (await setting(MODAL, "Comma-separated tags")).$("input").setValue("hours, e2e");
		await shot(SPEC, "notes-filled");
		await clickButton("Import now");
		await waitForModal(/import preview/i);
		await shot(SPEC, "preview-from-settings", true);
		await browser.$("[data-testid=run-import]").click();
		await waitForModal("Import finished");
		await browser.$("[data-testid=run-close]").click();
		await waitForNoModal();
		const notes = await listNotes("Work/Hours");
		expect(notes).toHaveLength(6);
		expect(notes[0]).toMatch(/^Work\/Hours\/2026-11-18 /);
		const fm = await waitForFrontmatter(notes[0] as string, (f) => f["tags"] !== undefined);
		expect(fm["tags"]).toEqual(["hours", "e2e"]);
		expect((await savedConfig(CSV))?.["targetFolder"]).toBe("Work/Hours");
	});

	it("saves a composite key chosen on the Re-import tab", async function () {
		await openConfigDialog();
		await openConfigTab("reimport");
		// Ticking re-renders the list, so each box is looked up again by its column name.
		for (const column of ["Datum", "Rolle"]) {
			await browser.$(`//*[@data-testid="import-config-modal"]//label[contains(@class,"csv-importer-key-option")][.//span[contains(@class,"csv-importer-key-name") and normalize-space()="${column}"]]//input`).click();
		}
		await (await setting(MODAL, "Key property")).waitForExist();
		await shot(SPEC, "composite-key", true);
		await clickButton("Save");
		await waitForNoModal();
		const cfg = await savedConfig(CSV);
		expect(cfg?.["keyColumns"]).toEqual(["Datum", "Rolle"]);
		await importViaDialog(CSV);
		const path = await findNoteByFrontmatter(NOTES_DIR, "import_key", "2026-11-18 | Softwareentwickler");
		expect(path).toContain(NOTES_DIR);
	});

	it("asks for confirmation before choosing Replace whole note, and replaces notes on re-import", async function () {
		await importViaDialog(CSV);
		const note = await findNoteByFrontmatter(NOTES_DIR, "Datum", "2026-11-18");
		await browser.executeObsidian(async ({ app }, path) => {
			const f = app.vault.getFileByPath(path);
			if (!f) return;
			await app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => void (fm["mine"] = "kept?"));
			await app.vault.process(f, (t) => `${t.trimEnd()}\n\nMy body text.\n`);
		}, note);
		await openConfigDialog();
		await openConfigTab("reimport");
		await chooseOption(MODAL, "When a note already exists", "Replace whole note");
		await clickButton("Save");
		await waitForModal("Replace whole notes?");
		await shot(SPEC, "replace-confirm", true);
		await clickButton("Replace notes");
		await waitForNoModal();
		expect((await savedConfig(CSV))?.["conflict"]).toBe("overwrite");
		await browser.executeObsidian(async ({ app }, path) => {
			const f = app.vault.getFileByPath(path);
			if (f) await app.vault.process(f, (t) => t.replace(/Stunden: .*/, "Stunden: 99"));
		}, note);
		await importViaDialog(CSV);
		await browser.waitUntil(async () => !(await readVaultFile(note)).includes("My body text."), { timeoutMsg: "body was not replaced" });
		expect(await readVaultFile(note)).not.toContain("mine:");
	});

	it("declining the Replace whole note confirmation keeps the current strategy", async function () {
		await openConfigDialog();
		await openConfigTab("reimport");
		await chooseOption(MODAL, "When a note already exists", "Replace whole note");
		await clickButton("Save");
		await waitForModal("Replace whole notes?");
		await clickButton("Cancel", ".modal-container:last-child");
		await browser.waitUntil(async () => (await browser.$$(".modal-container").length) >= 1);
		expect((await savedConfig(CSV))?.["conflict"]).not.toBe("overwrite");
	});

	it("sets a value template under a column's Options and writes it on import", async function () {
		await openConfigDialog();
		const buttons = await browser.$$(`${MODAL} [title="Show options"]`);
		await buttons[3]?.click();
		const field = browser.$(`${MODAL} .csv-importer-col-row.is-open input[placeholder="{{value}}"]`);
		await field.setValue("{{value}} h");
		await shot(SPEC, "column-options", true);
		await clickButton("Save");
		await waitForNoModal();
		await importViaDialog(CSV);
		const note = await findNoteByFrontmatter(NOTES_DIR, "Datum", "2026-11-18");
		const fm = await waitForFrontmatter(note, (f) => f["Stunden"] !== undefined);
		expect(fm["Stunden"]).toBe("0.625 h");
	});

	it("adds an ID extra property from the Add property menu", async function () {
		await browser.$("[data-testid=csv-configure]").click();
		await browser.$(MODAL).waitForDisplayed();
		await browser.$(`${MODAL} .csv-importer-extra-add button`).click();
		await clickMenuItem("ID (unique per note)");
		await shot(SPEC, "extra-id", true);
		await clickButton("Save");
		await waitForNoModal();
		const extra = (await savedConfig(CSV))?.["extraProperties"] as { property: string; defaultValue: string }[];
		expect(extra.map((e) => e.property)).toContain("id");
		expect(extra.find((e) => e.property === "id")?.defaultValue).toBe("{{uuid}}");
		// Saved from the table view's Configure button, the status line follows.
		await expect(browser.$("[data-testid=csv-view] .csv-importer-status")).toHaveText(expect.stringContaining("extra propert"));
	});

	it("filters rows from the File & rows tab", async function () {
		await browser.$("[data-testid=csv-configure]").click();
		await browser.$(MODAL).waitForDisplayed();
		await openConfigTab("file");
		await (await setting(MODAL, "Filter rows")).$("input[type=checkbox], .checkbox-container").click();
		await (await setting(MODAL, "Import rows where")).$$("select")[0]?.selectByVisibleText("Rolle");
		await (await setting(MODAL, "Import rows where")).$("input").setValue("Projektleiter");
		await shot(SPEC, "row-filter", true);
		await clickButton("Save");
		await waitForNoModal();
		await expect(browser.$("[data-testid=csv-import]")).toHaveText(/^Import [1-5] rows?$/);
		expect(((await savedConfig(CSV))?.["rowFilter"] as { column: string } | null)?.column).toBe("Rolle");
	});

	it("shows the live note preview next to the settings on a wide window", async function () {
		await openConfigDialog();
		await expect(browser.$(`${MODAL} .csv-importer-preview-pane`)).toBeDisplayed();
		await shot(SPEC, "live-preview", true);
	});
});
