import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { menuItems, openCsv, shot } from "../flows";
import { CSV, PLUGIN_ID, installConsoleSpy, pluginProblems, resetEverything, waitForViewType } from "../support";

const SPEC = "smoke";

describe("plugin loads, commands, ribbon, file menu, settings tab", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("is enabled and has registered its commands", async function () {
		const state = await browser.executeObsidian(({ app }, id) => {
			const plugins = (app as unknown as { plugins: { enabledPlugins: Set<string> } }).plugins;
			const commands = (app as unknown as { commands: { commands: Record<string, unknown> } }).commands.commands;
			return { enabled: plugins.enabledPlugins.has(id), commands: Object.keys(commands).filter((c) => c.startsWith(`${id}:`)).sort() };
		}, PLUGIN_ID);
		expect(state.enabled).toBe(true);
		expect(state.commands).toEqual(
			["configure-current-csv", "import-current-csv", "open-import-index", "reimport-all-csv", "undo-import-current-csv"].map((c) => `${PLUGIN_ID}:${c}`),
		);
	});

	it("registers a declarative settings tab with definitions", async function () {
		const count = await browser.executeObsidian(({ app }, id) => {
			type Tab = { id: string; getSettingDefinitions?: () => unknown[] };
			const setting = (app as unknown as { setting: { pluginTabs: Tab[] } }).setting;
			return setting.pluginTabs.find((t) => t.id === id)?.getSettingDefinitions?.().length ?? -1;
		}, PLUGIN_ID);
		expect(count).toBeGreaterThan(0);
	});

	it("opens the CSV imports index from the ribbon icon", async function () {
		const icon = browser.$('.side-dock-ribbon-action[aria-label="Open CSV imports"]');
		await expect(icon).toExist();
		await browser.executeObsidian(() => {
			(document.querySelector('.side-dock-ribbon-action[aria-label="Open CSV imports"]') as HTMLElement).click();
		});
		await waitForViewType("csv-importer-index");
		await expect(browser.$("[data-testid=csv-index]")).toBeDisplayed();
		await expect(browser.$(".csv-importer-index-empty-title")).toHaveText("No imports yet");
		await shot(SPEC, "index-empty", true);
	});

	it("offers the plugin's entries in the file menu of a CSV file only", async function () {
		const titlesFor = (path: string) =>
			browser.executeObsidian(({ app, obsidian }, p) => {
				const file = app.vault.getAbstractFileByPath(p);
				const menu = new obsidian.Menu();
				app.workspace.trigger("file-menu", menu, file, "file-explorer");
				return (menu as unknown as { items: { titleEl?: HTMLElement }[] }).items.map((i) => i.titleEl?.textContent ?? "").filter(Boolean);
			}, path);
		const csv = await titlesFor(CSV);
		expect(csv).toEqual(expect.arrayContaining(["Import", "Import settings"]));
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.create("Plain.md", "hello");
		});
		expect((await titlesFor("Plain.md")).filter((t) => /CSV/i.test(t))).toEqual([]);
	});

	it("shows its sections in the settings tab", async function () {
		await browser.executeObsidian(({ app }, id) => {
			const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
			setting.open();
			setting.openTabById(id);
		}, PLUGIN_ID);
		const read = () =>
			browser.executeObsidian(({ app }) => (app as unknown as { setting: { activeTab?: { containerEl: HTMLElement } } }).setting.activeTab?.containerEl.textContent ?? "");
		await browser.waitUntil(async () => (await read()).includes("Danger zone"), { timeoutMsg: "settings tab not rendered" });
		const text = await read();
		for (const heading of ["New notes", "Re-import", "Reading files", "Table view", "Danger zone"]) {
			expect(text).toContain(heading);
		}
		// Ordered by the user's journey, with the route to CSV imports under the intro.
		const at = (s: string) => text.indexOf(s);
		expect(at("Defaults for CSV files")).toBeLessThan(at("Open CSV imports"));
		expect(at("Open CSV imports")).toBeLessThan(at("New notes"));
		expect(at("New notes")).toBeLessThan(at("Reading files"));
		expect(at("Reading files")).toBeLessThan(at("Table view"));
		expect(at("Table view")).toBeLessThan(at("Danger zone"));
		expect(text).toContain("Open CSV imports");
		expect(text).toContain("Reset all import settings");
		await shot(SPEC, "settings-tab", true);
		await browser.executeObsidian(({ app }) => (app as unknown as { setting: { close(): void } }).setting.close());
	});

	it("keeps the table view reachable from the explorer path", async function () {
		await openCsv(CSV);
		expect(await menuItems()).toEqual([]);
		await expect(browser.$("[data-testid=csv-view]")).toBeDisplayed();
	});
});
