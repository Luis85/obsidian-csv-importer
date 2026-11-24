import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { shot } from "../flows";
import {
	CSV, PLUGIN_ID, importViaDialog, installConsoleSpy, noticeTexts, pluginProblems, resetEverything, waitForViewType,
} from "../support";

const SPEC = "settings-tab";

const openSettings = () =>
	browser.executeObsidian(({ app }, id) => {
		const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		setting.open();
		setting.openTabById(id);
	}, PLUGIN_ID);

const closeSettings = () => browser.executeObsidian(({ app }) => (app as unknown as { setting: { close(): void } }).setting.close());

/** Clicks a button of the plugin's settings tab by its text. */
const clickSettingsButton = (text: string) =>
	browser.executeObsidian(({ app }, label) => {
		const tab = (app as unknown as { setting: { activeTab?: { containerEl: HTMLElement } } }).setting.activeTab?.containerEl;
		const item = Array.from(tab?.querySelectorAll(".setting-item") ?? []).find((i) => (i.querySelector(".setting-item-name")?.textContent ?? "").startsWith(label));
		if (!item) throw new Error(`no settings row ${label}`);
		const control = item.querySelector<HTMLElement>(".setting-item-control");
		(control?.firstElementChild as HTMLElement | null ?? (item as HTMLElement)).click();
	}, text);

describe("settings tab", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("opens CSV imports from the row under the intro", async function () {
		await openSettings();
		await browser.waitUntil(async () => (await browser.executeObsidian(({ app }) => (app as unknown as { setting: { activeTab?: unknown } }).setting.activeTab !== undefined)));
		await clickSettingsButton("CSV imports");
		await closeSettings();
		await waitForViewType("csv-importer-index");
	});

	it("resets all import settings after a confirmation, emptying the index", async function () {
		await importViaDialog(CSV);
		await openSettings();
		await browser.waitUntil(async () => (await browser.executeObsidian(({ app }) => (app as unknown as { setting: { activeTab?: { containerEl: HTMLElement } } }).setting.activeTab?.containerEl.textContent ?? "")).includes("Danger zone"));
		await shot(SPEC, "danger-zone");
		// Obsidian 1.15 shows the settings in a window of their own; the confirmation opens there, not in the main window.
		await clickSettingsButton("Reset all import settings");
		await browser.waitUntil(() => browser.executeObsidian(() => activeDocument.body.textContent?.includes("Reset all import settings?") ?? false), {
			timeoutMsg: "no reset confirmation",
		});
		await browser.executeObsidian(() => {
			const button = Array.from(activeDocument.querySelectorAll<HTMLButtonElement>(".modal-container button")).find((b) => b.textContent === "Reset all");
			if (!button) throw new Error("no Reset all button");
			button.click();
		});
		await browser.waitUntil(async () => (await noticeTexts()).some((t) => t.includes("Import settings reset")), { timeoutMsg: "no reset notice" });
		const count = await browser.executeObsidian(({ app }, id) => {
			type Plugin = { store: { toRecord(): Record<string, unknown> } };
			const plugin = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id];
			return Object.keys(plugin?.store.toRecord() ?? {}).length;
		}, PLUGIN_ID);
		expect(count).toBe(0);
		await closeSettings();
	});
});
