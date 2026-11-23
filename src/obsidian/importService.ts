import { MarkdownView, Notice } from "obsidian";
import type { App, TFile } from "obsidian";
import type { ConfigStore } from "../configStore";
import { decodeCsv } from "../csv/encoding";
import { parseCsv } from "../csv/parser";
import { detectHeaderDrift, prepareConfig } from "../csv/typeInference";
import { emptyResult } from "../core/result";
import { errorMessage, plural } from "../core/util";
import { ROW_FILTER_WARNING, HISTORY_NOT_SAVED_WARNING, applyUndo, applyUndoToSnapshot, writeNotes } from "../import/importer";
import { valueHash } from "../import/merge";
import { countMatching, planNotes, resolveTargetFolder, staticPrefix } from "../import/noteBuilder";
import { createDefaultFileConfig, migrateFileConfig } from "../defaults";
import type { ImportStorage } from "../storage";
import type { CsvEncoding, FileImportConfig, ImportResult, ImportSnapshot, PluginSettings, UndoManifest } from "../types";
import { confirmDialog } from "../view/ConfirmModal";
import { CsvView } from "../view/CsvView";
import { ImportRunModal } from "../view/ImportRunModal";
import type { ImportRunControls } from "../view/ImportRunModal";
import { basePath, createBaseFile, openBase } from "./baseFiles";
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

	saveFileConfig(file: TFile, config: FileImportConfig): Promise<void> {
		return this.store.set(file.path, config);
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
	async runImportDialog(file: TFile, text: string): Promise<ImportResult> {
		try {
			await this.storage.init();
			const cfg = this.getFileConfig(file);
			const parsed = parseCsv(text, cfg);
			const drift = cfg.lastImport === null ? null : detectHeaderDrift(cfg.columns, parsed);
			prepareConfig(cfg, parsed, this.getSettings().midnightAsDate);
			const notes = planNotes(parsed, cfg, { path: file.path, basename: file.basename });
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
					const snap = await this.storage.loadSnapshot(file.path);
					const out = await writeNotes(this.app, notes, cfg, {
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
						...opts,
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
					return this.saveFinalState(file, cfg, out.snapshot, undo, out.result);
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
	): Promise<{ result: ImportResult; undoable: boolean }> {
		const undoable = hasChanges(undo);
		try {
			await this.storage.saveSnapshot(file.path, snapshot);
			if (undoable) await this.storage.saveUndo(file.path, undo);
			cfg.lastImport = Date.now();
			await this.saveFileConfig(file, cfg);
		} catch (e) {
			console.error("CSV Importer: could not save import history", e);
			result.warnings.push(HISTORY_NOT_SAVED_WARNING);
		}
		return { result, undoable };
	}

	// --- undo ---

	/** Asks for confirmation, reverts the last import of the CSV and shows a notice. */
	async undoLastImport(file: TFile): Promise<void> {
		const manifest = await this.storage.loadUndo(file.path);
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
		const snapshot = await this.storage.loadSnapshot(file.path);
		const outcome = await applyUndo(this.app, manifest);
		await this.storage.saveSnapshot(file.path, applyUndoToSnapshot(snapshot, manifest, new Set(outcome.changed)));
		await this.storage.saveUndo(file.path, null);
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
