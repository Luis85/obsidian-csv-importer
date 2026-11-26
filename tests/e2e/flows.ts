import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { browser } from "@wdio/globals";
import {
	ARTIFACTS, PLUGIN_ID, clickPastNotices, dismissNotices, openFile, runCommand, setColorScheme, waitForModal, waitForViewType,
} from "./support";

/**
 * Helpers for the user-flow specs: screenshots for human review, menus, settings rows, the import settings dialog
 * and direct config/vault access for set-up that is not itself the flow under test.
 */

/**
 * Saves a screenshot of the window to reports/e2e/screenshots/<spec>/<step>.png (gitignored), for people to review.
 * With `schemes`, one in the light and one in the dark theme (`<step>-light.png`, `<step>-dark.png`); the theme is
 * left light afterwards. Never fails a test.
 */
export async function shot(spec: string, step: string, schemes = false): Promise<void> {
	const take = async (suffix: string) => {
		const file = join(ARTIFACTS, "screenshots", spec, `${step}${suffix}.png`);
		try {
			mkdirSync(dirname(file), { recursive: true });
			await browser.saveScreenshot(file);
		} catch {
			// A screenshot is documentation, not an assertion.
		}
	};
	if (!schemes) {
		await take("");
		return;
	}
	for (const scheme of ["light", "dark"] as const) {
		await setColorScheme(scheme);
		await browser.waitUntil(() => browser.execute((w) => document.body.classList.contains(`theme-${w}`), scheme));
		await browser.pause(150);
		await take(`-${scheme}`);
	}
	await setColorScheme("light");
}

/** Clicks an item of the open Obsidian menu by its title. */
export async function clickMenuItem(title: string): Promise<void> {
	let target: WebdriverIO.Element | undefined;
	await browser.waitUntil(
		async () => {
			for (const item of await browser.$$(".menu .menu-item")) {
				if ((await item.getText()).trim() === title) {
					target = item;
					return true;
				}
			}
			return false;
		},
		{ timeoutMsg: `no menu item ${title}` },
	);
	await target?.click();
}

export const menuItems = () => browser.$$(".menu .menu-item").map((i) => i.getText());

/** The `.setting-item` called `name` inside `scope`. */
export async function setting(scope: string, name: string): Promise<WebdriverIO.Element> {
	let found: WebdriverIO.Element | undefined;
	await browser.waitUntil(
		async () => {
			for (const item of await browser.$$(`${scope} .setting-item`)) {
				const n = await item.$(".setting-item-name");
				if ((await n.isExisting()) && (await n.getText()).trim() === name) {
					found = item;
					return true;
				}
			}
			return false;
		},
		{ timeoutMsg: `no setting ${name} in ${scope}` },
	);
	return found as WebdriverIO.Element;
}

/** Sets a dropdown setting to the option with this label. */
export async function chooseOption(scope: string, name: string, label: string): Promise<void> {
	const row = await setting(scope, name);
	await row.$("select").selectByVisibleText(label);
}

/** Switches to a tab of the import settings dialog. */
export async function openConfigTab(id: "columns" | "notes" | "rows" | "reimport" | "file"): Promise<void> {
	await browser.$(`[data-testid=config-tab-${id}]`).click();
}

/** Opens the import settings dialog for the active CSV through the command. */
export async function openConfigDialog(): Promise<void> {
	await runCommand("configure-current-csv");
	await waitForModal("Properties");
	await browser.$("[data-testid=import-config-modal]").waitForDisplayed();
}

/** Merges `patch` into the CSV's saved import settings (what the dialog would save), without the dialog. */
export const patchConfig = (csvPath: string, patch: Record<string, unknown>) =>
	browser.executeObsidian(
		async ({ app }, id, path, values) => {
			type Service = { getFileConfig(f: unknown): Record<string, unknown>; saveFileConfig(f: unknown, c: unknown): Promise<void> };
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { service: Service }> } }).plugins.plugins[id];
			const file = app.vault.getFileByPath(path);
			if (!plugin || !file) throw new Error("plugin or file missing");
			await plugin.service.saveFileConfig(file, { ...plugin.service.getFileConfig(file), ...values });
		},
		PLUGIN_ID,
		csvPath,
		patch,
	);

/** Writes a vault file (create or replace). */
export const writeVault = (path: string, text: string) =>
	browser.executeObsidian(
		async ({ app }, p, content) => {
			const existing = app.vault.getFileByPath(p);
			if (existing) {
				await app.vault.modify(existing, content);
				return;
			}
			const folder = p.split("/").slice(0, -1).join("/");
			if (folder && !app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
			await app.vault.create(p, content);
		},
		path,
		text,
	);

export const vaultExists = (path: string) => browser.executeObsidian(({ app }, p) => app.vault.getAbstractFileByPath(p) !== null, path);

/** Opens the CSV in its table view and returns once the table is drawn. */
export async function openCsv(path: string): Promise<void> {
	await openFile(path);
	await waitForViewType("csv-importer-view");
	await browser.$("[data-testid=csv-table]").waitForExist();
}

/** Opens the import preview dialog of a CSV through the command and waits for its counts line. */
export async function openPreview(csvPath: string): Promise<void> {
	await openCsv(csvPath);
	await runCommand("import-current-csv");
	await waitForModal(/import preview/i);
	await browser.$("[data-testid=import-run-modal] .csv-importer-run-counts").waitForExist();
}

/** Text of the preview/report counts line, e.g. "6 new". */
export const countsLine = () => browser.$("[data-testid=import-run-modal] .csv-importer-run-counts").getText();


export async function setWindowSize(width: number, height: number): Promise<void> {
	try {
		await browser.setWindowSize(width, height);
	} catch {
		// Electron has no WebDriver window command; resize the window from inside the page instead.
		await browser.executeObsidian(
			({ require }, w, h) => {
				const win = (require("electron") as { remote: { getCurrentWindow(): { setSize(w: number, h: number): void } } }).remote.getCurrentWindow();
				win.setSize(w, h);
			},
			width,
			height,
		);
	}
	await browser.pause(500);
}

// --- imports index ---

export const INDEX = "[data-testid=csv-index]";

/**
 * Opens the CSV imports index through its command, with no notice left over its toolbar (see dismissNotices: the
 * notices of earlier steps, such as "Created <base>." after an import, cover Add CSV and Re-import all on CI's window).
 */
export async function openIndex(): Promise<void> {
	await dismissNotices();
	await runCommand("open-import-index");
	await waitForViewType("csv-importer-index");
}

/** Opens the index toolbar's Add CSV menu and picks "Scan vault for CSV files..." or "Copy a file from your device...". */
export async function chooseAddCsv(item: "scan" | "device"): Promise<void> {
	await clickPastNotices(browser.$(`${INDEX} [data-testid=csv-index-add]`));
	await clickMenuItem(item === "scan" ? "Scan vault for CSV files..." : "Copy a file from your device...");
}

/** The index row whose text contains a CSV file name (looked up again on every call: the index re-renders). */
export async function indexRow(name: string): Promise<WebdriverIO.Element> {
	let found: WebdriverIO.Element | undefined;
	await browser.waitUntil(
		async () => {
			for (const row of await browser.$$(`${INDEX} [data-testid=csv-index-row]`)) {
				if ((await row.getText()).includes(name)) {
					found = row;
					return true;
				}
			}
			return false;
		},
		{ timeoutMsg: `no index row for ${name}` },
	);
	return found as WebdriverIO.Element;
}

/** Whether an index row for this CSV file name exists right now. */
export async function hasIndexRow(name: string): Promise<boolean> {
	for (const row of await browser.$$(`${INDEX} [data-testid=csv-index-row]`)) {
		if ((await row.getText()).includes(name)) return true;
	}
	return false;
}
