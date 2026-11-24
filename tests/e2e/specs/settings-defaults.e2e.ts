import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { PLUGIN_ID, CSV, importViaDialog, installConsoleSpy, listNotes, pluginProblems, resetEverything } from "../support";

// The file name is a leftover of a debugging spec that could not be deleted from the sandbox; rename it to settings-defaults.e2e.ts.
describe("settings tab defaults", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("applies a default target folder from the settings tab to a CSV that has no settings yet", async function () {
		await browser.executeObsidian(({ app }, id) => {
			const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
			setting.open();
			setting.openTabById(id);
		}, PLUGIN_ID);
		await browser.waitUntil(
			async () => (await browser.executeObsidian(({ app }) => (app as unknown as { setting: { activeTab?: { containerEl: HTMLElement } } }).setting.activeTab?.containerEl.querySelectorAll("input[type=text]").length ?? 0)) > 0,
		);
		// Typing into the plugin's own setting, as a user does.
		await browser.executeObsidian(({ app }) => {
			const tab = (app as unknown as { setting: { activeTab: { containerEl: HTMLElement } } }).setting.activeTab.containerEl;
			const item = Array.from(tab.querySelectorAll(".setting-item")).find((i) => i.querySelector(".setting-item-name")?.textContent === "Target folder");
			const input = item?.querySelector("input") as HTMLInputElement;
			input.value = "Defaults/Out";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
		});
		await browser.executeObsidian(({ app }) => (app as unknown as { setting: { close(): void } }).setting.close());
		await importViaDialog(CSV);
		await browser.waitUntil(async () => (await listNotes("Defaults/Out")).length === 6, { timeoutMsg: "default target folder was not used" });
	});
});
