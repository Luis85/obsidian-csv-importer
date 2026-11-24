import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { INDEX, hasIndexRow, indexRow, openIndex, shot, writeVault } from "../flows";
import {
	CSV, PLUGIN_ID, importViaDialog, installConsoleSpy, pluginProblems, readVaultFile, resetEverything, runImportAndClose, waitForModal,
} from "../support";

const SPEC = "index-changed";
const BADGE = "[data-testid=csv-index-changed-badge]";

/** What the plugin reports for a CSV (the call the table view's status line uses). */
const status = (path: string) =>
	browser.executeObsidian(
		async ({ app }, id, p) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { csvStatus(f: unknown): Promise<{ changed: boolean; imported: boolean }> }> } }).plugins.plugins[id];
			const file = app.vault.getFileByPath(p);
			if (!plugin || !file) throw new Error("plugin or file missing");
			return plugin.csvStatus(file);
		},
		PLUGIN_ID,
		path,
	);

describe("Index: CSV changed since the last import", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("marks a modified CSV as Changed live, with a banner and a primary Re-import, and clears it after re-importing", async function () {
		await importViaDialog(CSV);
		await openIndex();
		const row = await indexRow("timesheet.csv");
		await expect(row.$(BADGE)).not.toExist();
		await expect(browser.$(`${INDEX} [data-testid=csv-index-changed]`)).not.toExist();
		expect((await status(CSV)).changed).toBe(false);
		await shot(SPEC, "unchanged", true);

		await writeVault(CSV, `${await readVaultFile(CSV)}2026-11-23 00:00:00,Tester,New row,1,1\n`);
		await browser.waitUntil(async () => (await (await indexRow("timesheet.csv")).$(BADGE).isExisting()), { timeoutMsg: "no Changed badge after the CSV was modified" });
		expect((await status(CSV)).changed).toBe(true);
		const changed = await indexRow("timesheet.csv");
		await expect(changed.$("[data-testid=csv-index-changed-time]")).toHaveText(expect.stringContaining("CSV changed"));
		await expect(changed.$("[data-testid=csv-index-primary]")).toHaveText("Re-import");
		await expect(changed.$("[data-testid=csv-index-primary]")).toHaveElementClass("mod-cta");
		await expect(browser.$(`${INDEX} [data-testid=csv-index-changed]`)).toHaveText(expect.stringContaining("1 CSV file changed since its last import"));
		await shot(SPEC, "changed", true);

		await browser.$(`${INDEX} [data-testid=csv-index-reimport-changed]`).click();
		await waitForModal(/import preview/i);
		await expect(browser.$("[data-testid=import-run-modal] .csv-importer-run-counts")).toHaveText(expect.stringContaining("1 new"));
		await browser.$("[data-testid=run-import]").waitForClickable();
		await runImportAndClose();
		await browser.waitUntil(async () => !(await (await indexRow("timesheet.csv")).$(BADGE).isExisting()), { timeoutMsg: "Changed badge stayed after the re-import" });
		await expect(browser.$(`${INDEX} [data-testid=csv-index-changed]`)).not.toExist();
		expect((await status(CSV)).changed).toBe(false);
	});

	it("does not mark a CSV that was only touched (same content)", async function () {
		await importViaDialog(CSV);
		await openIndex();
		await browser.pause(1100); // a different modification time
		await writeVault(CSV, await readVaultFile(CSV));
		await browser.pause(800);
		expect((await status(CSV)).changed).toBe(false);
		expect(await hasIndexRow("timesheet.csv")).toBe(true);
		await expect((await indexRow("timesheet.csv")).$(BADGE)).not.toExist();
	});

	it("treats an import without a recorded fingerprint as changed until the next import", async function () {
		await importViaDialog(CSV);
		// An import from before fingerprints: drop the recorded fingerprint from the index file, then reload the plugin.
		await browser.executeObsidian(async ({ app }, id) => {
			const path = `.obsidian/plugins/${id}/imports/index.json`;
			const data = JSON.parse(await app.vault.adapter.read(path)) as Record<string, { meta?: unknown }>;
			for (const e of Object.values(data)) delete e.meta;
			await app.vault.adapter.write(path, JSON.stringify(data));
			const plugins = (app as unknown as { plugins: { disablePlugin(i: string): Promise<void>; enablePlugin(i: string): Promise<void> } }).plugins;
			await plugins.disablePlugin(id);
			await plugins.enablePlugin(id);
		}, PLUGIN_ID);
		expect((await status(CSV)).changed).toBe(true);
		await importViaDialog(CSV);
		expect((await status(CSV)).changed).toBe(false);
	});
});
