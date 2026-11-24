import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

/**
 * Helpers shared by the e2e specs. Shaped after the support module of the author's weg-manager plugin
 * (installConsoleSpy, pluginProblems, eventually, cacheIdle, noticeTexts, setColorScheme, reloadPlugin).
 * Code passed to `executeObsidian` is serialised and runs inside Obsidian, so it cannot use closures or
 * module-level helpers.
 */

export const PLUGIN_ID = "csv-importer";
export const CSV = "Data/timesheet.csv";
export const CSV_DE = "Data/timesheet-de.csv";
/** Notes of Data/timesheet.csv land here (default target folder: a folder named after the CSV, next to it). */
export const NOTES_DIR = "Data/timesheet";
export const NOTES_DIR_DE = "Data/timesheet-de";
/** Screenshots, JSON measurement reports and logs of a run (gitignored; CI uploads the folder). */
export const ARTIFACTS = "reports/e2e";
const VAULT = "tests/e2e/vaults/base";

/** Every file of the fixture vault outside .obsidian, as base64 (some CSV fixtures are not UTF-8). */
const fixtureFiles = (): Record<string, string> => {
	const out: Record<string, string> = {};
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const full = join(dir, name);
			if (name === ".obsidian") continue;
			if (statSync(full).isDirectory()) walk(full);
			else out[relative(VAULT, full).split("\\").join("/")] = readFileSync(full).toString("base64");
		}
	};
	walk(VAULT);
	return out;
};

export const PLUGIN_DIR = `.obsidian/plugins/${PLUGIN_ID}`;

export type Frontmatter = Record<string, unknown>;

type Captured = { readonly kind: string; readonly text: string; readonly stack?: string };

// --- console spy and "no plugin problems" ---

/** Records console errors/warnings and uncaught errors from now on, in the main window. */
export const installConsoleSpy = () =>
	browser.executeObsidian(() => {
		const target = window as unknown as { csvImporterCaptured?: Captured[] };
		if (target.csvImporterCaptured !== undefined) return;
		const captured: Captured[] = [];
		target.csvImporterCaptured = captured;
		const text = (args: unknown[]) =>
			args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg))).join(" ");
		for (const kind of ["error", "warn"] as const) {
			const original = console[kind].bind(console);
			console[kind] = (...args: unknown[]) => {
				captured.push({ kind, text: text(args) });
				original(...args);
			};
		}
		window.addEventListener("error", (event) => {
			// A ResizeObserver whose layout settles over several frames is a notification, not a plugin error.
			if (String(event.message).startsWith("ResizeObserver loop")) return;
			captured.push({ kind: "uncaught", text: String(event.message) });
		});
		window.addEventListener("unhandledrejection", (event) => {
			const stack = (event.reason as { stack?: unknown } | null)?.stack;
			captured.push({ kind: "unhandledrejection", text: String(event.reason), ...(typeof stack === "string" ? { stack } : {}) });
		});
	});

/** Everything the spy saw that concerns this plugin, plus every uncaught error. */
export const pluginProblems = async (): Promise<Captured[]> => {
	const captured = await browser.executeObsidian(
		() => (window as unknown as { csvImporterCaptured?: Captured[] }).csvImporterCaptured ?? [],
	);
	return captured.filter(
		(entry) => entry.kind === "uncaught" || entry.kind === "unhandledrejection" || /csv[- ]importer/i.test(entry.text),
	);
};

/**
 * Waits until `read()` returns `expected` (compared as JSON), and fails showing the last value seen.
 * For a read that follows a write: the metadata cache follows it a moment later.
 */
export const eventually = async <T>(read: () => Promise<T>, expected: T, what: string): Promise<void> => {
	let last: T | undefined;
	try {
		await browser.waitUntil(async () => {
			last = await read();
			return JSON.stringify(last) === JSON.stringify(expected);
		});
	} catch {
		throw new Error(`${what}: expected ${JSON.stringify(expected)}, last seen ${JSON.stringify(last)}`);
	}
};

/** The text of every notice Obsidian shows. */
export const noticeTexts = () =>
	browser.executeObsidian(() =>
		[document, activeDocument].flatMap((doc) => [...doc.querySelectorAll(".notice")].map((el) => el.textContent ?? "")),
	);

/** Waits until Obsidian shows a notice that contains `text`. */
export const expectNotice = (text: string) =>
	browser.waitUntil(async () => (await noticeTexts()).some((shown) => shown.includes(text)), {
		timeoutMsg: `no notice said ${text}`,
	});

/**
 * Waits until Obsidian's metadata cache has worked through everything queued so far: a note edited now is the
 * last in line, so once its own `changed` and the `resolved` after it have come, every earlier note is done too.
 * The edit is a no-op for the vault's content only when the vault has a note; with none, it returns at once.
 */
export const cacheIdle = () =>
	browser.executeObsidian(async ({ app }) => {
		const file = app.vault.getMarkdownFiles()[0];
		if (file === undefined) return;
		await new Promise<void>((done) => {
			let changed = false;
			const refs = [
				app.metadataCache.on("changed", (edited) => {
					if (edited === file) changed = true;
				}),
				app.metadataCache.on("resolved", () => {
					if (!changed) return;
					for (const ref of refs) app.metadataCache.offref(ref);
					done();
				}),
			];
			void app.vault.process(file, (text) => `${text}\n`);
		});
	});

// --- plugin and theme ---

/** Disables and re-enables the plugin, as a user does in Settings, Community plugins. */
export const reloadPlugin = async () => {
	await obsidianPage.disablePlugin(PLUGIN_ID);
	await obsidianPage.enablePlugin(PLUGIN_ID);
};

/** "obsidian" is Obsidian's dark base theme, "moonstone" its light one (internal API). */
export const setColorScheme = (scheme: "dark" | "light") =>
	browser.executeObsidian(
		({ app }, theme) => {
			(app as unknown as { changeTheme(name: string): void }).changeTheme(theme);
		},
		scheme === "dark" ? "obsidian" : "moonstone",
	);

/**
 * Back to the fixture: vault files reset in place, the plugin's saved state (settings, per-CSV configs, import
 * snapshots and undo data) wiped, the plugin restarted, and no leaves or dialogs left from the test before.
 */
export async function resetEverything(): Promise<void> {
	await closeAllModals();
	await browser.executeObsidian(({ app }) => {
		(app as unknown as { setting?: { close(): void } }).setting?.close();
		app.workspace.detachLeavesOfType("csv-importer-view");
		app.workspace.detachLeavesOfType("csv-importer-index");
	});
	await obsidianPage.disablePlugin(PLUGIN_ID);
	// obsidianPage.resetVault() would also wipe the installed plugin (main.js lives in the vault's .obsidian), so the
	// vault is reset by hand: every file outside .obsidian is removed, then the fixture CSVs are written back.
	const fixtures = fixtureFiles();
	await browser.executeObsidian(
		async ({ app, obsidian }, dir, files) => {
			const adapter = app.vault.adapter;
			for (const child of [...app.vault.getRoot().children]) {
				if (child.path === app.vault.configDir) continue;
				if (child instanceof obsidian.TFolder) await adapter.rmdir(child.path, true);
				else await adapter.remove(child.path);
			}
			if (!(await adapter.exists("Data"))) await adapter.mkdir("Data");
			for (const [path, b64] of Object.entries(files)) {
				const folder = path.split("/").slice(0, -1).join("/");
				if (folder && !(await adapter.exists(folder))) await adapter.mkdir(folder);
				const bin = atob(b64);
				const bytes = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
				await adapter.writeBinary(path, bytes.buffer);
			}
			if (await adapter.exists(`${dir}/imports`)) await adapter.rmdir(`${dir}/imports`, true);
			if (await adapter.exists(`${dir}/data.json`)) await adapter.remove(`${dir}/data.json`);
		},
		PLUGIN_DIR,
		fixtures,
	);
	await obsidianPage.enablePlugin(PLUGIN_ID);
	await setColorScheme("light");
}

export async function closeAllModals(): Promise<void> {
	// Escape closes the topmost dialog, as it does for a user; stacked dialogs need one press each.
	await browser.waitUntil(
		async () => {
			if ((await browser.$$(".modal-container").length) === 0) return true;
			await browser.keys("Escape");
			return false;
		},
		{ timeoutMsg: "a modal would not close", interval: 300 },
	);
}

// --- views and dialogs ---

/** Opens a vault file in the active tab through the workspace (what a click in the file explorer does). */
export const openFile = (path: string) => obsidianPage.openFile(path);

export const activeViewType = () => browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.View)?.getViewType());

export const waitForViewType = (type: string) =>
	browser.waitUntil(async () => (await activeViewType()) === type, { timeoutMsg: `active view never became ${type}` });

export const runCommand = (id: string) => browser.executeObsidianCommand(`${PLUGIN_ID}:${id}`);

/** Waits until a modal whose text contains `text` is open. */
export const waitForModal = (text: string | RegExp) =>
	browser.waitUntil(
		async () => {
			const texts = await browser.$$(".modal-container .modal").map((m) => m.getText());
			return texts.some((s) => (typeof text === "string" ? s.includes(text) : text.test(s)));
		},
		{ timeoutMsg: `no modal showing ${String(text)}`, timeout: 10000 },
	);

/** Clicks the first visible, enabled button whose text equals `text` (string) or matches it (RegExp). */
export async function clickButton(text: string | RegExp, scope = ".modal-container"): Promise<void> {
	let target: WebdriverIO.Element | undefined;
	await browser.waitUntil(
		async () => {
			for (const b of await browser.$$(`${scope} button`)) {
				if (!(await b.isDisplayed()) || !(await b.isEnabled())) continue;
				const t = (await b.getText()).trim();
				if (typeof text === "string" ? t === text : text.test(t)) {
					target = b;
					return true;
				}
			}
			return false;
		},
		{ timeoutMsg: `no enabled button ${String(text)} in ${scope}` },
	);
	// Mobile dialogs slide in; a click during the slide can land outside the dialog and dismiss it.
	await target?.waitForClickable();
	await target?.click();
}

export const waitForNoModal = () =>
	browser.waitUntil(async () => (await browser.$$(".modal-container").length) === 0, { timeoutMsg: "a modal stayed open" });

/**
 * Drives the real import flow: opens the CSV, runs "import current CSV", waits for the preview, clicks the import
 * button and waits for the report. With `close` false the finished report dialog stays open.
 */
export async function importViaDialog(csvPath: string, close = true): Promise<void> {
	await openFile(csvPath);
	await waitForViewType("csv-importer-view");
	await runCommand("import-current-csv");
	await waitForModal(/import preview/i);
	await browser.$("[data-testid=run-import]").waitForClickable();
	await browser.$("[data-testid=run-import]").click();
	await waitForModal("Import finished");
	if (close) {
		await browser.$("[data-testid=run-close]").click();
		await waitForNoModal();
	}
}

// --- vault reads ---

/** Paths of the markdown files directly in a folder, sorted. */
export const listNotes = (folder: string) =>
	browser.executeObsidian(
		({ app }, dir) =>
			app.vault
				.getMarkdownFiles()
				.filter((f) => f.parent?.path === dir)
				.map((f) => f.path)
				.sort(),
		folder,
	);

export const readVaultFile = (path: string) => obsidianPage.read(path);

const frontmatterOf = (path: string) =>
	browser.executeObsidian(({ app }, p) => {
		const f = app.vault.getFileByPath(p);
		const fm = f ? app.metadataCache.getFileCache(f)?.frontmatter : undefined;
		return fm ? (JSON.parse(JSON.stringify(fm)) as Record<string, unknown>) : null;
	}, path);

/** Polls the metadata cache until the note's frontmatter exists and `predicate` accepts it. */
export async function waitForFrontmatter(path: string, predicate: (fm: Frontmatter) => boolean = () => true): Promise<Frontmatter> {
	let last: Frontmatter | null = null;
	await browser.waitUntil(
		async () => {
			last = await frontmatterOf(path);
			return last !== null && predicate(last);
		},
		{ timeoutMsg: `frontmatter of ${path} never matched; last: ${JSON.stringify(last)}` },
	);
	return last as unknown as Frontmatter;
}

/** The note in `folder` whose frontmatter has `key` equal to `value` (rows are found by their Datum, so file names do not matter). */
export async function findNoteByFrontmatter(folder: string, key: string, value: unknown): Promise<string> {
	let found = "";
	await browser.waitUntil(
		async () => {
			for (const p of await listNotes(folder)) {
				const fm = await frontmatterOf(p);
				if (fm && fm[key] === value) {
					found = p;
					return true;
				}
			}
			return false;
		},
		{ timeoutMsg: `no note in ${folder} with ${key}=${String(value)}` },
	);
	return found;
}
