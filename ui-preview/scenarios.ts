// @ts-nocheck
/* eslint-disable */
/**
 * Scenario registry for the ui-preview harness. Each scenario mounts the plugin's real view/modal code
 * (with the obsidian shim) into the page. Select by URL hash, e.g. index.html?theme=dark&mobile=1#c-config.
 */
import { App, TFile, Notice, WorkspaceLeaf, Setting } from "obsidian";
import { CsvView } from "../src/view/CsvView";
import { ImportConfigModal } from "../src/view/ImportConfigModal";
import { ImportRunModal } from "../src/view/ImportRunModal";
import { CsvImporterSettingTab } from "../src/settings";
import { ImportIndexView } from "../src/view/ImportIndexView";
import { DEFAULT_SETTINGS, createDefaultFileConfig } from "../src/defaults";
import { parseCsv } from "../src/csv/parser";
import { prepareConfig } from "../src/csv/typeInference";
import timesheetEn from "../examples/timesheet.csv";
import timesheetDe from "../examples/timesheet-de.csv";

const LAST_IMPORT = new Date(2026, 10, 20, 10, 15).getTime();

class FakeHost {
	settings = { ...DEFAULT_SETTINGS };
	configs = new Map();
	undoable = false;
	constructor(text) {
		this.text = text;
	}
	getFileConfig(file) {
		return this.configs.get(file.path) ?? createDefaultFileConfig(this.settings);
	}
	async saveFileConfig(file, config) {
		this.configs.set(file.path, JSON.parse(JSON.stringify(config)));
	}
	async readCsv() {
		return this.text;
	}
	async readCsvDecoded(_f, enc) {
		return { text: this.text, encoding: enc === "auto" ? "utf-8" : enc };
	}
	async importFile(file) {
		const modal = new ImportRunModal(new App(), runControls(file));
		modal.open();
		return modal.closed;
	}
	canUndo() {
		return this.undoable;
	}
	async undoLastImport() {
		new Notice("Last import undone.");
	}
}

const ROWS_PREVIEW = [
	{ row: 1, path: "Data/timesheet/timesheet 1.md", outcome: "created", reason: "would create" },
	{ row: 2, path: "Data/timesheet/timesheet 2.md", outcome: "created", reason: "would create" },
	{ row: 3, path: "Data/timesheet/timesheet 3.md", outcome: "updated", changed: ["Stunden", "Beschreibung"], preserved: ["Rolle"] },
	{ row: 4, path: "Data/timesheet/timesheet 4.md", outcome: "updated", changed: ["Tage"] },
	{ row: 5, path: "Data/timesheet/timesheet 5.md", outcome: "unchanged" },
	{ row: 6, path: "Data/timesheet/timesheet 6.md", outcome: "skipped", reason: "not created by this import" },
	{ row: 7, path: "Data/timesheet/timesheet 7.md", outcome: "skipped", reason: "duplicate key" },
	{ row: 8, path: "Data/timesheet/timesheet 8.md", outcome: "failed", reason: "file name taken by another record" },
];
const RUN_WARNING = "No key column: notes are matched by file name. Renaming a note creates a duplicate on the next import.";

function tally(rows, extra = {}) {
	const n = (o) => rows.filter((r) => r.outcome === o).length;
	return {
		created: n("created"),
		updated: n("updated"),
		unchanged: n("unchanged"),
		skipped: n("skipped"),
		failed: n("failed"),
		cancelled: false,
		dryRun: false,
		rows,
		errors: [],
		warnings: [],
		...extra,
	};
}

function runControls(file) {
	let done = false;
	return {
		csvPath: file.path,
		csvBasename: file.basename,
		reportFolder: "Data/timesheet",
		drift: { added: ["Kostenstelle"], removed: ["Tage"] },
		targetFolder: "Data/timesheet",
		preview: async () => tally(ROWS_PREVIEW, { dryRun: true, warnings: [RUN_WARNING] }),
		execute: async ({ onProgress }) => {
			onProgress(4, 8);
			onProgress(8, 8);
			done = true;
			return { undoable: true, result: tally(ROWS_PREVIEW, { warnings: [RUN_WARNING] }) };
		},
		canUndo: () => done,
		undo: async () => {},
		openNote: () => {},
		basePath: () => (done ? "Data/timesheet/timesheet.base" : null),
		openBase: () => {},
	};
}

// ---------------------------------------------------------------------------------------------

function waitFor(cond, timeout = 3000) {
	return new Promise((resolve, reject) => {
		const t0 = Date.now();
		const tick = () => {
			const v = cond();
			if (v) return resolve(v);
			if (Date.now() - t0 > timeout) return reject(new Error("waitFor timed out"));
			setTimeout(tick, 30);
		};
		tick();
	});
}

function mountTableView(host, text, fileName = "timesheet.csv") {
	const app = new App();
	document.body.empty();
	const frame = document.body.createDiv({ cls: "app-frame" });
	const strip = frame.createDiv({ cls: "tab-strip" });
	const tab = strip.createDiv({ cls: "tab" });
	tab.createSpan({ text: fileName });
	const leaf = new WorkspaceLeaf(app);
	frame.appendChild(leaf.containerEl);
	const view = new CsvView(leaf, host);
	const file = new TFile(`Data/${fileName}`);
	view.file = file;
	view.setViewData(text, true);
	view.refreshHeader();
	return { app, view, file };
}

/** Persisted config that no longer matches the CSV (one column removed, one added). */
function driftedConfig(host, text) {
	const cfg = createDefaultFileConfig(host.settings);
	const parsed = parseCsv(text, { delimiter: cfg.delimiter, hasHeader: cfg.hasHeader });
	prepareConfig(cfg, parsed, host.settings.midnightAsDate);
	cfg.columns = cfg.columns.filter((c) => c.source !== "Tage");
	cfg.columns.push({ source: "Kostenstelle", index: 9, property: "Kostenstelle", type: "text", include: true });
	cfg.lastImport = LAST_IMPORT;
	return cfg;
}


/** Saved config with 2 extra properties (one {{uuid}} ID), a composite key and an active row filter. */
function extrasConfig(host, text) {
	const cfg = createDefaultFileConfig(host.settings);
	const parsed = parseCsv(text, { delimiter: cfg.delimiter, hasHeader: cfg.hasHeader });
	prepareConfig(cfg, parsed, host.settings.midnightAsDate);
	cfg.extraProperties = [
		{ property: "id", type: "text", defaultValue: "{{uuid}}" },
		{ property: "status", type: "text", defaultValue: "open" },
	];
	cfg.keyColumns = ["Datum", "Rolle"];
	cfg.keyColumn = "";
	cfg.keyProperty = "import_key";
	cfg.rowFilter = { column: "Rolle", op: "equals", value: "Softwareentwickler" };
	cfg.conflict = "update";
	cfg.lastImport = LAST_IMPORT;
	return cfg;
}

// --- owner:config scenarios (helper) ---
async function mountConfig(tab, extras = false) {
	const host = new FakeHost(timesheetEn);
	const { app, file } = mountTableView(host, timesheetEn);
	if (extras) host.configs.set(file.path, extrasConfig(host, timesheetEn));
	new ImportConfigModal(app, host, file, timesheetEn).open();
	await sleep(300);
	const idx = { columns: 0, notes: 1, reimport: 2, file: 3 }[tab];
	document.querySelectorAll(".csv-importer-tab")[idx]?.click();
	await sleep(200);
}

const INDEX_ITEMS = [
	{ csvPath: "Data/timesheet.csv", fileName: "timesheet.csv", exists: true, targetFolder: "Data/timesheet", lastImport: Date.now() - 2 * 3600e3, hasUndo: true, basePath: "Data/timesheet/timesheet.base" },
	{ csvPath: "Finanzen/Konto/umsaetze-2026-10.csv", fileName: "umsaetze-2026-10.csv", exists: true, targetFolder: "Finanzen/Buchungen", lastImport: Date.now() - 3 * 86400e3, hasUndo: false, basePath: null },
	{ csvPath: "Archiv/kunden-export.csv", fileName: "kunden-export.csv", exists: false, targetFolder: "CRM/Kunden", lastImport: Date.now() - 40 * 86400e3, hasUndo: false, basePath: "CRM/Kunden/kunden-export.base" },
	{ csvPath: "books.csv", fileName: "books.csv", exists: true, targetFolder: "", lastImport: null, hasUndo: false, basePath: null },
];
const INDEX_COUNTS = { "Data/timesheet.csv": 8, "Finanzen/Konto/umsaetze-2026-10.csv": 214, "Archiv/kunden-export.csv": 57, "books.csv": 0 };

async function mountIndex(items) {
	const app = new App();
	app.vault.getFileByPath = () => null;
	document.body.empty();
	const frame = document.body.createDiv({ cls: "app-frame" });
	const strip = frame.createDiv({ cls: "tab-strip" });
	strip.createDiv({ cls: "tab" }).createSpan({ text: "CSV imports" });
	const leaf = new WorkspaceLeaf(app);
	frame.appendChild(leaf.containerEl);
	const host = {
		app,
		listImports: async () => items,
		countImportedNotes: async (p) => INDEX_COUNTS[p] ?? 0,
		reimport: async () => {},
		reimportAll: async () => {},
		configureImport: async () => {},
		undoImport: async () => {},
		deleteImportedNotes: async () => 0,
		removeFromIndex: async () => false,
	};
	const view = new ImportIndexView(leaf, host);
	view.refreshHeader();
	await view.onOpen();
	await sleep(150);
}

// --- owner:table-run scenarios ---
function manyRows(n) {
	const rows = [];
	for (let i = 1; i <= n; i++) {
		const outcome = i % 7 === 0 ? "unchanged" : i % 3 === 0 ? "updated" : "created";
		rows.push({ row: i, path: `Data/timesheet/Projekte/2026/timesheet mit einem sehr langen Dateinamen ${i}.md`, outcome, changed: outcome === "updated" ? ["Stunden"] : undefined });
	}
	rows.push({ row: n + 1, path: "Data/timesheet/timesheet broken.md", outcome: "failed", reason: "file name taken by another record" });
	return rows;
}

const tableRunScenarios = {
	"a2-table-filter-nomatch": {
		title: "Table view: active row filter callout, search without matches",
		async mount() {
			const host = new FakeHost(timesheetEn);
			host.undoable = true;
			host.configs.set("Data/timesheet.csv", extrasConfig(host, timesheetEn));
			const { view } = mountTableView(host, timesheetEn);
			const input = document.querySelector(".csv-importer-search");
			input.value = "zzz";
			input.dispatchEvent(new Event("input"));
			await sleep(400);
		},
	},
	"a3-table-empty": {
		title: "Table view: header only, no rows",
		async mount() {
			mountTableView(new FakeHost("Datum,Rolle,Stunden\n"), "Datum,Rolle,Stunden\n");
		},
	},
	"e2-run-many": {
		title: "Import run dialog, preview with many rows (groups open/closed)",
		async mount() {
			const host = new FakeHost(timesheetEn);
			const { file } = mountTableView(host, timesheetEn);
			const ctl = runControls(file);
			ctl.preview = async () => tally(manyRows(30), { dryRun: true, warnings: [RUN_WARNING] });
			new ImportRunModal(new App(), ctl).open();
			await waitFor(() => document.querySelector(".csv-importer-run-buttons .mod-cta"));
			await sleep(200);
		},
	},
	"e3-run-progress": {
		title: "Import run dialog, mid-progress",
		async mount() {
			const host = new FakeHost(timesheetEn);
			const { file } = mountTableView(host, timesheetEn);
			const ctl = runControls(file);
			ctl.execute = ({ onProgress }) => {
				onProgress(3, 8);
				return new Promise(() => {});
			};
			new ImportRunModal(new App(), ctl).open();
			const cta = await waitFor(() => document.querySelector(".csv-importer-run-buttons .mod-cta"));
			cta.click();
			await sleep(300);
		},
	},
	"f2-run-done-many": {
		title: "Import run dialog, done state with many rows",
		async mount() {
			const host = new FakeHost(timesheetEn);
			const { file } = mountTableView(host, timesheetEn);
			const ctl = runControls(file);
			ctl.preview = async () => tally(manyRows(30), { dryRun: true });
			ctl.execute = async () => ({ undoable: true, result: tally(manyRows(30)) });
			new ImportRunModal(new App(), ctl).open();
			const cta = await waitFor(() => document.querySelector(".csv-importer-run-buttons .mod-cta"));
			cta.click();
			await waitFor(() => document.querySelector(".modal-title")?.textContent?.startsWith("Import finished"));
			await sleep(200);
		},
	},
	"f3-run-done-menu": {
		title: "Import run dialog, done state with the more menu open",
		async mount() {
			const host = new FakeHost(timesheetEn);
			const { file } = mountTableView(host, timesheetEn);
			new ImportRunModal(new App(), runControls(file)).open();
			const cta = await waitFor(() => document.querySelector(".csv-importer-run-buttons .mod-cta"));
			cta.click();
			await waitFor(() => document.querySelector(".modal-title")?.textContent?.startsWith("Import finished"));
			document.querySelector(".csv-importer-run-more").click();
			await sleep(200);
		},
	},
};
// --- end owner:table-run scenarios ---

// --- owner:index-settings scenarios --- (helper) Renders getSettingDefinitions() like Obsidian 1.13+ does.
function renderDefinitions(tab, el) {
	el.empty();
	const renderItem = (container, def) => {
		if (def.type === "group" || def.type === "list") {
			if (def.heading) new Setting(container).setName(def.heading).setHeading();
			for (const it of def.items ?? []) renderItem(container, it);
			return;
		}
		if (def.visible === false) return;
		const st = new Setting(container).setName(def.name);
		if (def.desc) st.setDesc(def.desc);
		if (def.render) return void def.render(st, null);
		if (def.action) return void st.addButton((b) => b.setButtonText(def.name.replace(/\u2026$/, "")).onClick(def.action));
		const c = def.control;
		if (!c) return;
		const value = tab.getControlValue(c.key);
		const set = (v) => void tab.setControlValue(c.key, v);
		if (c.type === "toggle") st.addToggle((t) => t.setValue(!!value).onChange(set));
		else if (c.type === "dropdown") st.addDropdown((d) => d.addOptions(c.options).setValue(String(value)).onChange(set));
		else if (c.type === "textarea") st.addTextArea((t) => t.setValue(String(value ?? "")).onChange(set));
		else st.addText((t) => t.setValue(String(value ?? "")).onChange(set));
	};
	for (const def of tab.getSettingDefinitions()) renderItem(el, def);
}

export const scenarios = {
	...tableRunScenarios,
	"a-table-first-import": {
		title: "Table view, first import hint (timesheet-de.csv)",
		async mount() {
			mountTableView(new FakeHost(timesheetDe), timesheetDe, "timesheet-de.csv");
		},
	},
	"b-table-drift": {
		title: "Table view with column-drift banner and parser warning",
		async mount() {
			const text = timesheetEn.trimEnd() + '\n2026-11-24 00:00:00,Tester,"Unbalanced quote note,0.5,4\n';
			const host = new FakeHost(text);
			host.undoable = true;
			host.configs.set("Data/timesheet.csv", driftedConfig(host, text));
			mountTableView(host, text);
		},
	},
	// --- owner:config scenarios ---
	"c-config": { title: "Import settings dialog, Columns tab", async mount() { await mountConfig("columns"); } },
	"c-config-notes": { title: "Import settings dialog, Notes tab", async mount() { await mountConfig("notes"); } },
	"c-config-reimport": { title: "Import settings dialog, Re-import tab", async mount() { await mountConfig("reimport"); } },
	"c-config-file": { title: "Import settings dialog, File & rows tab", async mount() { await mountConfig("file"); } },
	"c-config-extras": { title: "Import settings dialog: extra properties (ID uuid), Columns tab", async mount() { await mountConfig("columns", true); } },
	"c-config-extras-reimport": { title: "Import settings dialog: composite key, Re-import tab", async mount() { await mountConfig("reimport", true); } },
	"c-config-extras-filter": { title: "Import settings dialog: active row filter, File & rows tab", async mount() { await mountConfig("file", true); } },
	"c-config-options": {
		title: "Import settings dialog, column options expanded (number column)",
		async mount() {
			await mountConfig("columns");
			const row = document.querySelectorAll(".csv-importer-col-row")[3];
			const b = row?.querySelector(".csv-importer-col-options-btn");
			const sum = row?.querySelector(".csv-importer-col-summary");
			(b && b.offsetParent ? b : sum)?.click();
			await sleep(150);
		},
	},
	"c-config-preview": {
		title: "Import settings dialog, preview toggled on (narrow layouts)",
		async mount() {
			await mountConfig("columns", true);
			const t = document.querySelector(".csv-importer-preview-toggle");
			if (t && t.offsetParent) t.click();
			await sleep(150);
		},
	},
	"d-config-advanced": { title: "Import settings dialog, File & rows tab (alias)", async mount() { await mountConfig("file"); } },
	// --- end owner:config scenarios ---
	"h-index": {
		title: "CSV imports index view (4 imports, one missing CSV, one with undo)",
		async mount() {
			await mountIndex(INDEX_ITEMS);
		},
	},
	"h-index-empty": {
		title: "CSV imports index view, empty state",
		async mount() {
			await mountIndex([]);
		},
	},
	"e-run-preview": {
		title: "Import run dialog, preview with mixed outcomes",
		async mount() {
			const host = new FakeHost(timesheetEn);
			const { app, file } = mountTableView(host, timesheetEn);
			new ImportRunModal(app, runControls(file)).open();
			await waitFor(() => document.querySelector(".csv-importer-run-buttons .mod-cta"));
			await sleep(200);
		},
	},
	"f-run-done": {
		title: "Import run dialog, done state",
		async mount() {
			const host = new FakeHost(timesheetEn);
			const { app, file } = mountTableView(host, timesheetEn);
			new ImportRunModal(app, runControls(file)).open();
			const cta = await waitFor(() => document.querySelector(".csv-importer-run-buttons .mod-cta"));
			cta.click();
			await waitFor(() => document.querySelector(".modal-title")?.textContent?.startsWith("Import finished"));
			await sleep(200);
		},
	},
	"g-settings": {
		title: "Plugin settings tab",
		async mount() {
			const app = new App();
			document.body.empty();
			const host = {
				app,
				settings: { ...DEFAULT_SETTINGS },
				saveSettings: async () => {},
				forgetAllFileConfigs: async () => {},
				openImportIndex: async () => {},
				manifest: { id: "csv-importer", name: "CSV Importer" },
			};
			const container = document.body.createDiv({ cls: "modal-container mod-dim" });
			container.createDiv({ cls: "modal-bg" });
			const modal = container.createDiv({ cls: "modal mod-settings settings-frame" });
			const side = modal.createDiv({ cls: "modal-sidebar vertical-tab-header" });
			side.createDiv({ cls: "tab-group", text: "Options" });
			for (const n of ["Editor", "Files and links", "Appearance"]) side.createDiv({ cls: "tab-header", text: n });
			side.createDiv({ cls: "tab-group", text: "Community plugins" });
			side.createDiv({ cls: "tab-header is-active", text: "CSV Importer" });
			const content = modal.createDiv({ cls: "modal-content vertical-tab-content-container" });
			const tab = new CsvImporterSettingTab(app, {} as never, host);
			content.appendChild(tab.containerEl);
			renderDefinitions(tab, tab.containerEl);
		},
	},

	// --- owner:index-settings scenarios ---
	"h-index-long": {
		title: "CSV imports index view, long names and many rows",
		async mount() {
			const long = Array.from({ length: 6 }, (_, i) => ({
				csvPath: `Projekte/Kundenprojekte/2026/Quartal-${i + 1}/sehr-langer-dateiname-fuer-den-export-${i + 1}.csv`,
				fileName: `sehr-langer-dateiname-fuer-den-export-${i + 1}.csv`,
				exists: i !== 2,
				targetFolder: "Projekte/Kunden",
				lastImport: i % 2 ? null : Date.now() - (i + 1) * 3600e3,
				hasUndo: i === 0,
				basePath: null,
			}));
			await mountIndex(long);
		},
	},
	// --- end owner:index-settings scenarios ---
};

// ---------------------------------------------------------------------------------------------

async function run() {
	const params = new URLSearchParams(location.search);
	const name = location.hash.replace(/^#/, "") || Object.keys(scenarios)[0];
	document.body.classList.add(params.get("theme") === "dark" ? "theme-dark" : "theme-light");
	if (params.get("mobile") === "1") document.body.classList.add("is-mobile", "is-phone");
	window.__errors = [];
	window.addEventListener("error", (e) => window.__errors.push(String(e.message)));
	window.addEventListener("unhandledrejection", (e) => window.__errors.push("unhandledrejection: " + (e.reason?.stack || e.reason)));
	const sc = scenarios[name];
	if (!sc) {
		document.body.textContent = "Unknown scenario: " + name + ". Available: " + Object.keys(scenarios).join(", ");
		window.__ready = true;
		return;
	}
	try {
		await sc.mount();
	} catch (e) {
		window.__errors.push("mount: " + (e?.stack || e));
		console.error(e);
	}
	await sleep(100);
	window.__ready = true;
}
window.__scenarioNames = Object.keys(scenarios);
void run();
