/** Shared test helpers: a plain file config and an in-memory import harness. */
import { parse } from "yaml";
import type { App } from "obsidian";
import { parseCsv } from "../../src/csv/parser";
import { prepareConfig } from "../../src/csv/typeInference";
import { createDefaultFileConfig, DEFAULT_SETTINGS } from "../../src/defaults";
import { writeNotes } from "../../src/import/importer";
import { planNotes } from "../../src/import/noteBuilder";
import type { FileImportConfig, ImportSnapshot } from "../../src/types";
import { MockApp, TFile } from "../mocks/obsidian";

/** A fully spelled-out file config (independent of DEFAULT_SETTINGS), with overrides. */
export function cfg(over: Partial<FileImportConfig> = {}): FileImportConfig {
	return {
		delimiter: "auto",
		hasHeader: true,
		decimalSeparator: ".",
		targetFolder: "",
		fileNameTemplate: "{{file}} {{row}}",
		bodyTemplate: "",
		conflict: "skip",
		tags: "",
		addSourceLink: false,
		listSeparator: ",",
		emptyValues: "empty",
		numberPrecision: null,
		keyColumn: "",
		keyColumns: [],
		keyProperty: "import_key",
		dateOrder: "auto",
		rowFilter: null,
		extraProperties: [],
		adoptExistingNotes: false,
		encoding: "auto",
		protectEdits: true,
		keepValuesOnEmpty: true,
		createBase: false,
		columns: [],
		lastImport: null,
		...over,
	};
}

export interface RunOptions {
	dryRun?: boolean;
	snapshot?: ImportSnapshot;
	warnings?: string[];
	undoCap?: number;
}

/** In-memory vault plus a `run(csv)` that parses, plans and writes notes, carrying the snapshot between runs. */
export function setup(overrides: Partial<FileImportConfig> = {}) {
	const app = new MockApp();
	const config: FileImportConfig = {
		...createDefaultFileConfig(DEFAULT_SETTINGS),
		fileNameTemplate: "Entry {{id}}",
		keyColumn: "id",
		...overrides,
	};
	let snapshot: ImportSnapshot = {};
	const setSnapshot = (s: ImportSnapshot) => (snapshot = s);
	const getSnapshot = () => snapshot;
	/** `run(csv, true)` is shorthand for a dry run. */
	const run = async (csv: string, opts: RunOptions | boolean = {}) => {
		const o: RunOptions = typeof opts === "boolean" ? { dryRun: opts } : opts;
		const parsed = parseCsv(csv, config);
		prepareConfig(config, parsed, true);
		const notes = planNotes(parsed, config, { path: "Data/hours.csv", basename: "hours" });
		const out = await writeNotes(app as unknown as App, notes, config, { snapshot, ...o });
		if (!o.dryRun) snapshot = out.snapshot;
		return out;
	};
	const put = async (path: string, text: string) => {
		const parts = path.split("/").slice(0, -1);
		let cur = "";
		for (const p of parts) {
			cur = cur ? `${cur}/${p}` : p;
			if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur);
		}
		await app.vault.create(path, text);
	};
	const read = (path: string) => app.vault.files.get(path) ?? "";
	const fm = (path: string) => parse(/^---\n([\s\S]*?)---/.exec(read(path))![1]) as Record<string, unknown>;
	const editInBases = (path: string, fn: (fm: Record<string, unknown>) => void) =>
		app.fileManager.processFrontMatter(app.vault.getAbstractFileByPath(path) as TFile, fn);
	return { app, cfg: config, run, put, read, fm, editInBases, getSnapshot, setSnapshot };
}
