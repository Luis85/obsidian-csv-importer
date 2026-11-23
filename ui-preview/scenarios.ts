// @ts-nocheck
/* eslint-disable */
/**
 * Scenario registry for the ui-preview harness. Each scenario mounts the plugin's real view/modal code
 * (with the obsidian shim) into the page. Select by URL hash, e.g. index.html?theme=dark&mobile=1#c-config.
 */
import { App, TFile, Notice, WorkspaceLeaf } from "obsidian";
import { CsvView } from "../src/view/CsvView";
import { ImportConfigModal } from "../src/view/ImportConfigModal";
import { ImportRunModal } from "../src/view/ImportRunModal";
import { CsvImporterSettingTab } from "../src/settings";
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

export const scenarios = {
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
	"c-config": {
		title: "Import settings dialog",
		async mount() {
			const host = new FakeHost(timesheetEn);
			const { app, file } = mountTableView(host, timesheetEn);
			new ImportConfigModal(app, host, file, timesheetEn).open();
			await sleep(400);
		},
	},
	"d-config-advanced": {
		title: "Import settings dialog, Advanced expanded",
		async mount() {
			const host = new FakeHost(timesheetEn);
			const { app, file } = mountTableView(host, timesheetEn);
			new ImportConfigModal(app, host, file, timesheetEn).open();
			await sleep(300);
			const d = document.querySelector("details.csv-importer-advanced");
			if (d) d.open = true;
			await sleep(200);
			// Scroll the dialog body so the expanded section is what the (non-tall) screenshot shows.
			const body = document.querySelector(".csv-importer-config");
			if (body) body.scrollTop = body.scrollHeight;
			await sleep(100);
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
			const tab = new CsvImporterSettingTab(app, host);
			content.appendChild(tab.containerEl);
			tab.display();
		},
	},
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
