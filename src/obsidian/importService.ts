import { MarkdownView, Notice, TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import type { ConfigStore } from "../configStore";
import { decodeCsv } from "../csv/encoding";
import { parseCsv } from "../csv/parser";
import { detectHeaderDrift, prepareConfig } from "../csv/typeInference";
import { emptyResult } from "../core/result";
import { errorMessage, plural } from "../core/util";
import { ROW_FILTER_WARNING, HISTORY_NOT_SAVED_WARNING, applyUndo, applyUndoToSnapshot, writeNotes } from "../import/importer";
import { valueHash } from "../import/merge";
import { checkChanged, hashBytes, lastRunOf, makeFingerprint } from "../import/fingerprint";
import { sanitizeFileName } from "../import/folders";
import { countMatching, filterNotesByRows, planNotes, resolveTargetFolder, staticPrefix } from "../import/noteBuilder";
import { createDefaultFileConfig, migrateFileConfig } from "../defaults";
import type { CsvStatus, EditedNotes, ImportFileOptions, ImportSummary } from "../host";
import type { ImportStorage } from "../storage";
import type { CsvEncoding, CsvFingerprint, FileImportConfig, ImportResult, ImportSnapshot, PluginSettings, UndoManifest } from "../types";
import { confirmDialog, confirmDialogWithOption } from "../view/ConfirmModal";
import { CsvView } from "../view/CsvView";
import { ImportRunModal } from "../view/ImportRunModal";
import type { ImportRunControls } from "../view/ImportRunModal";
import { basePath, createBaseFile, openBase } from "./baseFiles";
import { triggerCsvChanged } from "./events";
import { isCsv } from "./vaultEvents";

function hasChanges(u: UndoManifest): boolean {
	return u.created.length > 0 || u.modified.length > 0;
}

/**
 * Runs the import and undo flows against the vault: reads and decodes CSVs, plans notes, drives the import dialog,
 * and keeps per-file config and import history up to date. The plugin class delegates here.
 */
export class ImportService {
	constructor(
		private readonly app: App,
		private readonly storage: ImportStorage,
		private readonly store: ConfigStore,
		private readonly getSettings: () => PluginSettings,
	) {}

	// --- config and reading ---

	/** The stored config for a CSV merged over fresh defaults, or defaults alone (not persisted yet). */
	getFileConfig(file: TFile): FileImportConfig {
		const defaults = createDefaultFileConfig(this.getSettings());
		const stored = this.store.get(file.path);
		return stored ? migrateFileConfig({ ...defaults, ...stored }, this.getSettings()) : defaults;
	}

	async saveFileConfig(file: TFile, config: FileImportConfig): Promise<void> {
		await this.store.set(file.path, config);
		triggerCsvChanged(this.app, file.path);
	}

	async readCsvDecoded(
		file: TFile,
		encoding: CsvEncoding,
	): Promise<{ text: string; encoding: Exclude<CsvEncoding, "auto"> }> {
		return decodeCsv(await this.app.vault.readBinary(file), encoding);
	}

	async readCsv(file: TFile): Promise<string> {
		return (await this.readCsvDecoded(file, this.getFileConfig(file).encoding)).text;
	}

	canUndo(file: TFile): boolean {
		return this.storage.hasUndo(file.path);
	}

	/** The CSV file in the active view, if any. */
	getActiveCsvFile(): TFile | null {
		const view = this.app.workspace.getActiveViewOfType(CsvView);
		if (view?.file) return view.file;
		const md = this.app.workspace.getActiveViewOfType(MarkdownView);
		const f = md?.file ?? this.app.workspace.getActiveFile();
		return isCsv(f) ? f : null;
	}

	// --- import ---

	/**
	 * Opens the import dialog (preview, confirm, progress, report) and resolves with its result. Failures are
	 * reported in a notice and returned as a failed dry-run result.
	 */
	async runImportDialog(file: TFile, text: string, runOpts: ImportFileOptions = {}): Promise<ImportResult> {
		try {
			await this.storage.init();
			const fingerprint = makeFingerprint(await this.app.vault.readBinary(file), file.stat);
			const cfg = this.getFileConfig(file);
			const parsed = parseCsv(text, cfg);
			const drift = cfg.lastImport === null ? null : detectHeaderDrift(cfg.columns, parsed);
			prepareConfig(cfg, parsed, this.getSettings().midnightAsDate);
			const allNotes = planNotes(parsed, cfg, { path: file.path, basename: file.basename });
			const notes = runOpts.rows ? filterNotesByRows(allNotes, runOpts.rows) : allNotes;
			const stored = await this.storage.loadSnapshot(file.path);
			const warnings = [...parsed.warnings];
			if (cfg.rowFilter) warnings.push(ROW_FILTER_WARNING(countMatching(parsed, cfg), parsed.rows.length));
			const staticFolder = staticPrefix(resolveTargetFolder(cfg, file.path));

			const modal = new ImportRunModal(this.app, {
				csvPath: file.path,
				csvBasename: file.basename,
				reportFolder: file.parent && !file.parent.isRoot() ? file.parent.path : "",
				drift,
				preview: async () =>
					(await writeNotes(this.app, notes, cfg, { dryRun: true, snapshot: stored, warnings })).result,
				execute: async (opts) => {
					// Rows kept checked in the preview win over rows passed to importFile (they are a subset of them).
					const { rows: pickedRows, ...writeOpts } = opts;
					const toWrite = pickedRows ? filterNotesByRows(allNotes, pickedRows) : notes;
					const partial = pickedRows !== undefined || runOpts.rows !== undefined;
					const snap = await this.storage.loadSnapshot(file.path);
					const out = await writeNotes(this.app, toWrite, cfg, {
						snapshot: snap,
						warnings,
						onCheckpoint: async (s, u) => {
							try {
								await this.storage.saveSnapshot(file.path, s);
								if (hasChanges(u)) await this.storage.saveUndo(file.path, { ...u, csvPath: file.path });
							} catch (e) {
								console.error("CSV Importer: could not save import state", e);
							}
						},
						...writeOpts,
					});
					const undo: UndoManifest = { ...out.undo, csvPath: file.path };
					if (cfg.createBase && staticFolder && (out.result.created > 0 || out.result.updated > 0)) {
						const created = await createBaseFile(this.app, staticFolder, cfg, file.basename);
						if (created) {
							// Trashed by undo together with the notes it lists.
							undo.created.push(created.path);
							(undo.writtenHashes ??= {})[created.path] = valueHash(created.content);
						}
					}
					return this.saveFinalState(file, cfg, out.snapshot, undo, out.result, partial ? undefined : fingerprint);
				},
				canUndo: () => this.canUndo(file),
				undo: () => this.undoLastImport(file),
				targetFolder: staticFolder,
				openNote: (path: string) => this.openNote(path),
				basePath: () => basePath(this.app, staticFolder),
				openBase: () => openBase(this.app, staticFolder),
			} satisfies ImportRunControls);
			modal.open();
			return await modal.closed;
		} catch (e) {
			console.error("CSV Importer: import failed", e);
			new Notice(`Import failed: ${errorMessage(e)}`, 10000);
			return { ...emptyResult(true), failed: 1, errors: [{ row: 0, message: errorMessage(e) }] };
		}
	}

	/** The one place that saves state after a write: snapshot, undo manifest, then the file config. */
	private async saveFinalState(
		file: TFile,
		cfg: FileImportConfig,
		snapshot: ImportSnapshot,
		undo: UndoManifest,
		result: ImportResult,
		fingerprint?: CsvFingerprint,
	): Promise<{ result: ImportResult; undoable: boolean }> {
		const undoable = hasChanges(undo);
		try {
			await this.storage.saveSnapshot(file.path, snapshot);
			if (undoable) await this.storage.saveUndo(file.path, undo);
			cfg.lastImport = Date.now();
			await this.store.set(file.path, cfg);
			// A stopped or partial run does not count as "the CSV as it is now was imported".
			await this.storage.setMeta(file.path, { lastRun: lastRunOf(result), ...(fingerprint && !result.cancelled ? { fingerprint } : {}) });
		} catch (e) {
			console.error("CSV Importer: could not save import history", e);
			result.warnings.push(HISTORY_NOT_SAVED_WARNING);
		}
		triggerCsvChanged(this.app, file.path);
		return { result, undoable };
	}

	// --- undo ---

	/** Asks for confirmation, reverts the last import of the CSV and shows a notice. */
	async undoLastImport(file: TFile): Promise<void> {
		return this.undoImport(file.path);
	}

	/** Same as `undoLastImport`, by CSV path (works when the CSV file is gone). */
	async undoImport(csvPath: string): Promise<void> {
		const manifest = await this.storage.loadUndo(csvPath);
		if (!manifest) {
			new Notice("There is no import to undo for this file.");
			return;
		}
		const ok = await confirmDialog(
			this.app,
			"Undo last import",
			`This moves ${plural(manifest.created.length, "created note", "created notes")} to the trash and restores ${plural(manifest.modified.length, "modified note", "modified notes")} to their previous content. Notes you changed after the import are left as they are.`,
			"Undo import",
			true,
		);
		if (!ok) return;
		const snapshot = await this.storage.loadSnapshot(csvPath);
		const outcome = await applyUndo(this.app, manifest);
		await this.storage.saveSnapshot(csvPath, applyUndoToSnapshot(snapshot, manifest, new Set(outcome.changed)));
		await this.storage.saveUndo(csvPath, null);
		triggerCsvChanged(this.app, csvPath);
		new Notice(undoNoticeText(manifest, outcome), 10000);
	}

	// --- bulk and helpers ---

	/** Runs the import dialog for every configured CSV file that still exists, one after the other. */
	async reimportAll(): Promise<void> {
		const files = this.store
			.paths()
			.map((p) => this.app.vault.getAbstractFileByPath(p))
			.filter(isCsv);
		if (files.length === 0) {
			new Notice("No configured CSV files found.");
			return;
		}
		for (const f of files) await this.importFromDisk(f);
	}

	/** Reads the CSV and opens the import dialog for it. */
	async importFromDisk(file: TFile): Promise<void> {
		try {
			const text = await this.readCsv(file);
			await this.runImportDialog(file, text);
		} catch (e) {
			console.error("CSV Importer: could not read file", e);
			new Notice(`Could not read ${file.name}.`);
		}
	}

	// --- imports index ---

	private configFor(csvPath: string): FileImportConfig {
		const defaults = createDefaultFileConfig(this.getSettings());
		const stored = this.store.get(csvPath);
		return stored ? migrateFileConfig({ ...defaults, ...stored }, this.getSettings()) : defaults;
	}

	/** All CSVs with saved settings: last import first (never imported last), then by file name. */
	async listImports(): Promise<ImportSummary[]> {
		await this.storage.init();
		const list = await Promise.all(this.store.paths().map(async (csvPath): Promise<ImportSummary> => {
			const cfg = this.configFor(csvPath);
			let targetFolder = "";
			try {
				targetFolder = staticPrefix(resolveTargetFolder(cfg, csvPath));
			} catch {
				targetFolder = "";
			}
			const abstract = this.app.vault.getAbstractFileByPath(csvPath);
			const csv = isCsv(abstract) ? abstract : null;
			const status = csv ? await this.csvStatus(csv).catch(() => null) : null;
			return {
				csvPath,
				fileName: csvPath.split("/").pop() ?? csvPath,
				exists: csv !== null,
				targetFolder,
				lastImport: cfg.lastImport,
				hasUndo: this.storage.hasUndo(csvPath),
				basePath: basePath(this.app, targetFolder),
				changed: status?.changed ?? false,
				modifiedAt: csv ? csv.stat.mtime : null,
				lastRun: this.storage.getMeta(csvPath)?.lastRun ?? null,
			};
		}));
		return list.sort(
			(a, b) =>
				(b.lastImport ?? -1) - (a.lastImport ?? -1) ||
				a.fileName.localeCompare(b.fileName, undefined, { sensitivity: "base", numeric: true }) ||
				a.csvPath.localeCompare(b.csvPath),
		);
	}

	/** Whether a CSV differs from what was last imported. */
	async csvStatus(file: TFile): Promise<CsvStatus> {
		await this.storage.init();
		const lastImport = this.store.get(file.path)?.lastImport ?? null;
		const base = { lastImport, modifiedAt: file.stat.mtime };
		if (lastImport === null) return { ...base, imported: false, changed: false };
		const meta = this.storage.getMeta(file.path);
		const check = await checkChanged(meta?.fingerprint, file.stat, async () => hashBytes(new Uint8Array(await this.app.vault.readBinary(file))));
		if (check.touched) void this.storage.setMeta(file.path, { fingerprint: check.touched }).catch(() => undefined);
		return { ...base, imported: true, changed: check.changed };
	}

	/** Notes whose managed properties were changed in Obsidian since the import (compared with the snapshot hashes). */
	async countEditedNotes(csvPath: string): Promise<EditedNotes> {
		const snapshot = await this.storage.loadSnapshot(csvPath);
		const props = new Set<string>();
		let count = 0;
		let checked = 0;
		for (const [notePath, hashes] of Object.entries(snapshot)) {
			const f = this.app.vault.getAbstractFileByPath(notePath);
			if (!(f instanceof TFile)) continue;
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			if (!fm) continue;
			checked++;
			let edited = false;
			for (const [prop, hash] of Object.entries(hashes)) {
				if (valueHash(fm[prop] ?? null) !== hash) {
					edited = true;
					props.add(prop);
				}
			}
			if (edited) count++;
		}
		return { count, checked, properties: [...props].sort((a, b) => a.localeCompare(b)).slice(0, 12) };
	}

	/** CSV files in the vault without import settings, sorted by path. */
	listUnindexedCsvs(): TFile[] {
		return this.app.vault
			.getFiles()
			.filter((f) => f.extension.toLowerCase() === "csv" && !this.store.has(f.path))
			.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base", numeric: true }));
	}

	/** Row count of a CSV with the default settings; null when too large or unreadable. */
	async countCsvRows(file: TFile): Promise<number | null> {
		if (file.stat.size > 20_000_000) return null;
		try {
			const text = await this.readCsv(file);
			return parseCsv(text, this.getFileConfig(file)).rows.length;
		} catch {
			return null;
		}
	}

	/** Gives the CSVs default import settings so they show in the index (no import). */
	async addToIndex(csvPaths: string[]): Promise<number> {
		const entries: Record<string, FileImportConfig> = {};
		for (const p of csvPaths) {
			if (this.store.has(p) || !isCsv(this.app.vault.getAbstractFileByPath(p))) continue;
			entries[p] = createDefaultFileConfig(this.getSettings());
		}
		const paths = Object.keys(entries);
		if (paths.length === 0) return 0;
		await this.store.setMany(entries);
		for (const p of paths) triggerCsvChanged(this.app, p);
		return paths.length;
	}

	/** Writes the bytes of a file picked outside the vault into the vault, adds it to the index and opens it. */
	async addExternalCsv(data: ArrayBuffer, folder: string, fileName: string, conflict: "replace" | "keep"): Promise<TFile> {
		const { vault } = this.app;
		const stem = sanitizeFileName(fileName.replace(/\.csv$/i, ""));
		if (stem === "") throw new Error("Enter a file name.");
		const dir = normalizePath(folder.trim() || "/");
		let walked = "";
		for (const seg of dir === "/" ? [] : dir.split("/")) {
			walked = walked ? `${walked}/${seg}` : seg;
			const node = vault.getAbstractFileByPath(walked);
			if (node instanceof TFolder) continue;
			if (node) throw new Error(`${walked} is not a folder.`);
			await vault.createFolder(walked);
		}
		const join = (name: string): string => normalizePath(dir === "/" ? `${name}.csv` : `${dir}/${name}.csv`);
		let path = join(stem);
		let file: TFile;
		const existing = vault.getAbstractFileByPath(path);
		if (existing && conflict === "replace") {
			if (!(existing instanceof TFile)) throw new Error(`${path} is a folder.`);
			await vault.modifyBinary(existing, data);
			file = existing;
		} else {
			for (let n = 1; existing && ((await vault.adapter.exists(path)) || vault.getAbstractFileByPath(path)); n++) path = join(`${stem} ${n}`);
			file = await vault.createBinary(path, data);
		}
		await this.addToIndex([file.path]);
		triggerCsvChanged(this.app, file.path);
		await this.app.workspace.getLeaf("tab").openFile(file);
		return file;
	}

	/** Runs the import dialog for every configured CSV that changed since its last import. */
	async reimportChanged(): Promise<void> {
		const changed: TFile[] = [];
		for (const p of this.store.paths()) {
			const f = this.app.vault.getAbstractFileByPath(p);
			if (isCsv(f) && (await this.csvStatus(f)).changed) changed.push(f);
		}
		if (changed.length === 0) {
			new Notice("No CSV files have changed since their last import.");
			return;
		}
		for (const f of changed) await this.importFromDisk(f);
	}

	/** Number of notes the import of this CSV owns (snapshot entries). */
	async countImportedNotes(csvPath: string): Promise<number> {
		return Object.keys(await this.storage.loadSnapshot(csvPath)).length;
	}

	/** Runs the import dialog for a CSV by path. */
	async reimport(csvPath: string): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(csvPath);
		if (!isCsv(f)) {
			new Notice("The CSV file no longer exists.");
			return;
		}
		await this.importFromDisk(f);
	}

	/**
	 * Moves the notes this import owns (snapshot entries that still exist as markdown files) to the trash, after
	 * confirmation, and clears the CSV's snapshot and undo state. The file config stays (last import reset).
	 * Resolves with the number of notes trashed (0 when cancelled).
	 */
	async deleteImportedNotes(csvPath: string): Promise<number> {
		const fileName = csvPath.split("/").pop() ?? csvPath;
		const snapshot = await this.storage.loadSnapshot(csvPath);
		const owned = Object.keys(snapshot).filter((p) => {
			const f = this.app.vault.getAbstractFileByPath(p);
			return f instanceof TFile && f.extension.toLowerCase() === "md";
		});
		if (owned.length === 0) {
			new Notice(`${fileName} has no imported notes to delete.`);
			return 0;
		}
		const cfg = this.configFor(csvPath);
		let folder = "";
		try {
			folder = staticPrefix(resolveTargetFolder(cfg, csvPath));
		} catch {
			folder = "";
		}
		const base = basePath(this.app, folder);
		const message = `This moves ${plural(owned.length, "note", "notes")} created by importing ${fileName} to the trash. Notes you created yourself are not affected.`;
		let alsoBase = false;
		if (base) {
			const r = await confirmDialogWithOption(this.app, "Delete imported notes?", message, "Delete notes", { label: "Also delete the base file" }, true);
			if (!r.ok) return 0;
			alsoBase = r.checked;
		} else if (!(await confirmDialog(this.app, "Delete imported notes?", message, "Delete notes", true))) {
			return 0;
		}

		const progress = owned.length > 50 ? new Notice(`Deleting notes: 0 of ${owned.length}`, 0) : null;
		let trashed = 0;
		let failed = 0;
		try {
			for (const [i, p] of owned.entries()) {
				const f = this.app.vault.getAbstractFileByPath(p);
				if (f instanceof TFile) {
					try {
						await this.app.fileManager.trashFile(f);
						trashed++;
					} catch (e) {
						failed++;
						console.error("CSV Importer: could not trash a note", p, e);
					}
				}
				if (progress && i % 25 === 0) progress.setMessage(`Deleting notes: ${i + 1} of ${owned.length}`);
			}
			if (alsoBase && base) {
				const bf = this.app.vault.getAbstractFileByPath(base);
				if (bf instanceof TFile) {
					try {
						await this.app.fileManager.trashFile(bf);
					} catch (e) {
						console.error("CSV Importer: could not trash the base file", e);
					}
				}
			}
		} finally {
			progress?.hide();
		}
		await this.storage.clearImportState(csvPath);
		const stored = this.store.get(csvPath);
		if (stored) {
			stored.lastImport = null;
			await this.store.set(csvPath, stored);
		}
		triggerCsvChanged(this.app, csvPath);
		new Notice(failed > 0 ? `Moved ${plural(trashed, "note", "notes")} to the trash. ${failed} could not be deleted.` : `Moved ${plural(trashed, "note", "notes")} to the trash.`);
		return trashed;
	}

	/** Deletes the settings and import history of a CSV after confirmation. Imported notes stay. */
	async removeFromIndex(csvPath: string): Promise<boolean> {
		const fileName = csvPath.split("/").pop() ?? csvPath;
		const ok = await confirmDialog(
			this.app,
			"Remove from index?",
			`Remove ${fileName} from the index? Its import settings and import history are deleted. Imported notes stay.`,
			"Remove",
			true,
		);
		if (!ok) return false;
		await this.store.delete(csvPath);
		await this.storage.delete(csvPath);
		triggerCsvChanged(this.app, csvPath);
		new Notice(`Removed ${fileName} from the index.`);
		return true;
	}

	/** Opens a note in a new tab (documented Workspace API only). */
	private openNote(path: string): void {
		const file = this.app.vault.getFileByPath(path);
		if (file) void this.app.workspace.getLeaf("tab").openFile(file);
		else new Notice("The note no longer exists.");
	}
}

/** The notice shown after an undo, e.g. "Import undone: 3 removed, 1 restored." */
function undoNoticeText(
	manifest: UndoManifest,
	outcome: { trashed: number; restored: number; failed: number; changed: string[] },
): string {
	const parts = [`${outcome.trashed} removed`, `${outcome.restored} restored`];
	if (outcome.failed > 0) parts.push(`${outcome.failed} failed`);
	let message = `Import undone: ${parts.join(", ")}.`;
	const n = outcome.changed.length;
	if (n > 0) {
		message += ` ${n} ${n === 1 ? "note was" : "notes were"} changed after the import and ${n === 1 ? "was" : "were"} left as ${n === 1 ? "it is" : "they are"}.`;
	}
	if (manifest.truncated) message += " The import was too large to undo completely.";
	return message;
}
