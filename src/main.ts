import { MarkdownView, normalizePath, Notice, Plugin, requireApiVersion, TAbstractFile, TFile, TFolder } from "obsidian";
import type { CsvImporterHost } from "./host";
import { ConfigStore } from "./configStore";
import { parseCsv } from "./csv/parser";
import { detectHeaderDrift, prepareConfig } from "./csv/typeInference";
import { decodeCsv } from "./csv/encoding";
import { buildBaseFile } from "./import/baseFile";
import { planNotes, resolveTargetFolder } from "./import/noteBuilder";
import { ImportStorage } from "./storage";
import { confirmDialog } from "./view/ConfirmModal";
import { ImportRunModal } from "./view/ImportRunModal";
import { applyUndo, applyUndoToSnapshot, registerPropertyTypes, writeNotes } from "./import/importer";
import { valueHash } from "./import/merge";
import { createDefaultFileConfig, CsvImporterSettingTab, DEFAULT_SETTINGS } from "./settings";
import type { SettingsHost } from "./settings";
import type { FileImportConfig, ImportResult, PluginData, PluginSettings } from "./types";
import { CsvView, VIEW_TYPE_CSV } from "./view/CsvView";
import { ImportConfigModal } from "./view/ImportConfigModal";

/** Static part of a folder template: everything before the first placeholder, without a trailing slash. */
function staticPrefix(folder: string): string {
	const i = folder.indexOf("{{");
	const head = i < 0 ? folder : folder.slice(0, i);
	return i < 0 ? head : head.replace(/\/[^/]*$/, "");
}

function isCsv(file: TAbstractFile | null): file is TFile {
	return file instanceof TFile && file.extension.toLowerCase() === "csv";
}

export default class CsvImporterPlugin extends Plugin implements CsvImporterHost, SettingsHost {
	settings: PluginSettings = { ...DEFAULT_SETTINGS };
	private store!: ConfigStore;
	private storage!: ImportStorage;

	async onload(): Promise<void> {
		const raw = (await this.loadData()) as Partial<PluginData> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw?.settings ?? {});
		this.store = new ConfigStore(raw?.files, () => this.persist());
		this.storage = new ImportStorage(this.app, this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
		void this.storage.init();

		this.registerView(VIEW_TYPE_CSV, (leaf) => new CsvView(leaf, this));
		try {
			this.registerExtensions(["csv"], VIEW_TYPE_CSV);
		} catch (e) {
			console.error("CSV Importer: could not register the csv extension", e);
			new Notice(
				"CSV importer could not take over .csv files because another plugin already handles them. Disable that plugin and reload to use the table view.",
				10000,
			);
		}

		this.addSettingTab(new CsvImporterSettingTab(this.app, this));

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFolder) {
					void this.store.renameFolder(oldPath, file.path);
				} else if (isCsv(file)) {
					void this.store.rename(oldPath, file.path);
					void this.storage.rename(oldPath, file.path);
				} else if (file instanceof TFile && file.extension.toLowerCase() === "md") {
					void this.storage.renameNote(oldPath, file.path);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (isCsv(file)) {
					void this.store.delete(file.path);
					void this.storage.delete(file.path);
				}
			}),
		);

		this.addCommand({
			id: "import-current-csv",
			name: "Import rows from current CSV file",
			checkCallback: (checking) => {
				const file = this.getActiveCsvFile();
				if (!file) return false;
				if (!checking) void this.importFromDisk(file);
				return true;
			},
		});
		this.addCommand({
			id: "reimport-all-csv",
			name: "Re-import all configured CSV files",
			callback: () => void this.reimportAll(),
		});
		this.addCommand({
			id: "undo-import-current-csv",
			name: "Undo last import of current CSV file",
			checkCallback: (checking) => {
				const file = this.getActiveCsvFile();
				if (!file || !this.canUndo(file)) return false;
				if (!checking) void this.undoLastImport(file);
				return true;
			},
		});
		this.addCommand({
			id: "configure-current-csv",
			name: "Configure import for current CSV file",
			checkCallback: (checking) => {
				const file = this.getActiveCsvFile();
				if (!file) return false;
				if (!checking) void this.openConfig(file);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!isCsv(file)) return;
				menu.addItem((item) =>
					item
						.setTitle("Import rows as notes")
						.setIcon("table")
						.onClick(() => void this.importFromDisk(file)),
				);
				menu.addItem((item) =>
					item
						.setTitle("Configure CSV import")
						.setIcon("settings")
						.onClick(() => void this.openConfig(file)),
				);
				if (this.canUndo(file)) {
					menu.addItem((item) =>
						item
							.setTitle("Undo last CSV import")
							.setIcon("undo-2")
							.onClick(() => void this.undoLastImport(file)),
					);
				}
			}),
		);
	}

	// --- SettingsHost ---

	async saveSettings(): Promise<void> {
		await this.persist();
	}

	async forgetAllFileConfigs(): Promise<void> {
		await this.store.clear();
	}

	private persist(): Promise<void> {
		const data: PluginData = { settings: this.settings, files: this.store ? this.store.toRecord() : {} };
		return this.saveData(data);
	}

	// --- CsvImporterHost ---

	getFileConfig(file: TFile): FileImportConfig {
		const stored = this.store.get(file.path);
		if (!stored) return createDefaultFileConfig(this.settings);
		return Object.assign(createDefaultFileConfig(this.settings), stored);
	}

	async saveFileConfig(file: TFile, config: FileImportConfig): Promise<void> {
		await this.store.set(file.path, config);
	}

	async readCsv(file: TFile): Promise<string> {
		const bytes = await this.app.vault.readBinary(file);
		return decodeCsv(bytes, this.getFileConfig(file).encoding).text;
	}

	canUndo(file: TFile): boolean {
		return this.storage.hasUndo(file.path);
	}

	async importFile(file: TFile, text: string): Promise<ImportResult> {
		try {
			await this.storage.init();
			const cfg = this.getFileConfig(file);
			const parsed = parseCsv(text, cfg);
			const drift = cfg.lastImport === null ? null : detectHeaderDrift(cfg.columns, parsed);
			prepareConfig(cfg, parsed, this.settings.midnightAsDate);
			const notes = planNotes(parsed, cfg, { path: file.path, basename: file.basename });
			const stored = await this.storage.loadSnapshot(file.path);
			const targetFolder = resolveTargetFolder(cfg, file.path);
			const staticFolder = staticPrefix(targetFolder);
			const basePathFor = (): string | null => {
				if (!staticFolder) return null;
				const p = normalizePath(`${staticFolder}.base`);
				return this.app.vault.getAbstractFileByPath(p) instanceof TFile ? p : null;
			};

			const modal = new ImportRunModal(this.app, {
				csvPath: file.path,
				csvBasename: file.basename,
				reportFolder: file.parent && !file.parent.isRoot() ? file.parent.path : "",
				drift,
				preview: async () =>
					(await writeNotes(this.app, notes, cfg, { dryRun: true, snapshot: stored, warnings: parsed.warnings })).result,
				execute: async (opts) => {
					this.notifyTypeConflicts(cfg);
					const snap = await this.storage.loadSnapshot(file.path);
					const out = await writeNotes(this.app, notes, cfg, {
						snapshot: snap,
						warnings: parsed.warnings,
						onCheckpoint: async (s, u) => {
							try {
								await this.storage.saveSnapshot(file.path, s);
								if (u.created.length > 0 || u.modified.length > 0) {
									await this.storage.saveUndo(file.path, { ...u, csvPath: file.path });
								}
							} catch (e) {
								console.error("CSV Importer: could not save import state", e);
							}
						},
						...opts,
					});
					const undo = { ...out.undo, csvPath: file.path };
					const undoable = undo.created.length > 0 || undo.modified.length > 0;
					if (cfg.createBase && staticFolder && (out.result.created > 0 || out.result.updated > 0)) {
						const created = await this.createBaseFile(staticFolder, cfg, file.basename);
						if (created) {
							// Trashed by undo together with the notes it lists.
							undo.created.push(created.path);
							(undo.writtenHashes ??= {})[created.path] = valueHash(created.content);
						}
					}
					await this.storage.saveSnapshot(file.path, out.snapshot);
					const keepUndo = undo.created.length > 0 || undo.modified.length > 0;
					if (keepUndo) await this.storage.saveUndo(file.path, undo);
					cfg.lastImport = Date.now();
					await this.saveFileConfig(file, cfg);
					return { result: out.result, undoable: undoable || keepUndo };
				},
				canUndo: () => this.canUndo(file),
				undo: () => this.undoLastImport(file),
				targetFolder: staticFolder,
				openFolder: () => this.revealFolder(staticFolder),
				basePath: basePathFor,
				openBase: () => {
					const p = basePathFor();
					const f = p ? this.app.vault.getAbstractFileByPath(p) : null;
					if (f instanceof TFile) void this.app.workspace.getLeaf("tab").openFile(f);
				},
			});
			modal.open();
			return await modal.closed;
		} catch (e) {
			console.error("CSV Importer: import failed", e);
			new Notice(`Import failed: ${e instanceof Error ? e.message : String(e)}`, 10000);
			return {
				created: 0,
				updated: 0,
				unchanged: 0,
				skipped: 0,
				failed: 1,
				cancelled: false,
				dryRun: true,
				rows: [],
				warnings: [],
				errors: [{ row: 0, message: e instanceof Error ? e.message : String(e) }],
			};
		}
	}

	async undoLastImport(file: TFile): Promise<void> {
		const manifest = await this.storage.loadUndo(file.path);
		if (!manifest) {
			new Notice("There is no import to undo for this file.");
			return;
		}
		const ok = await confirmDialog(
			this.app,
			"Undo last import",
			`This moves ${manifest.created.length} created ${manifest.created.length === 1 ? "note" : "notes"} to the trash and restores ${manifest.modified.length} modified ${manifest.modified.length === 1 ? "note" : "notes"} to their previous content. Notes you changed after the import are left as they are.`,
			"Undo import",
			true,
		);
		if (!ok) return;
		const snapshot = await this.storage.loadSnapshot(file.path);
		const outcome = await applyUndo(this.app, manifest);
		await this.storage.saveSnapshot(file.path, applyUndoToSnapshot(snapshot, manifest, new Set(outcome.changed)));
		await this.storage.saveUndo(file.path, null);
		const parts = [`${outcome.trashed} removed`, `${outcome.restored} restored`];
		if (outcome.failed > 0) parts.push(`${outcome.failed} failed`);
		let message = `Import undone: ${parts.join(", ")}.`;
		if (outcome.changed.length > 0) {
			const n = outcome.changed.length;
			message += ` ${n} ${n === 1 ? "note was" : "notes were"} changed after the import and ${n === 1 ? "was" : "were"} left as ${n === 1 ? "it is" : "they are"}.`;
		}
		if ((manifest as { truncated?: boolean }).truncated) message += " The import was too large to undo completely.";
		new Notice(message, 10000);
	}

	private notifyTypeConflicts(cfg: FileImportConfig): void {
		if (!this.settings.registerPropertyTypes) return;
		const reg = registerPropertyTypes(this.app, cfg.columns);
		if (reg.conflicts.length === 0) return;
		const label = (t: string): string => (t === "multitext" ? "list" : t);
		const lines = reg.conflicts.map(
			(c) =>
				`Property "${c.property}" is already typed as ${label(c.existing)} in Obsidian; kept that type. Values were written as ${label(c.wanted)}.`,
		);
		new Notice(lines.slice(0, 5).join("\n") + (lines.length > 5 ? `\n…and ${lines.length - 5} more.` : ""), 12000);
	}

	/** Creates the base file next to the notes folder (Obsidian 1.9+ only). Returns its path and content, or null. */
	private async createBaseFile(
		folder: string,
		cfg: FileImportConfig,
		csvBasename: string,
	): Promise<{ path: string; content: string } | null> {
		if (!requireApiVersion("1.9.0")) return null;
		try {
			const path = normalizePath(`${folder}.base`);
			if (this.app.vault.getAbstractFileByPath(path)) return null;
			const props = cfg.columns.filter((c) => c.include).map((c) => c.property);
			const content = buildBaseFile(folder, props, csvBasename);
			await this.app.vault.create(path, content);
			new Notice(`Created ${path}.`);
			return { path, content };
		} catch (e) {
			console.error("CSV Importer: could not create base file", e);
			new Notice("Could not create the base file.");
			return null;
		}
	}

	/** Shows a folder in the file explorer; falls back to opening its first note. */
	private revealFolder(path: string): void {
		const folder = path ? this.app.vault.getAbstractFileByPath(path) : this.app.vault.getRoot();
		if (!(folder instanceof TFolder)) {
			new Notice("The folder does not exist yet.");
			return;
		}
		const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
		const view = leaf?.view as unknown as { revealInFolder?: (f: TAbstractFile) => void } | undefined;
		if (leaf && typeof view?.revealInFolder === "function") {
			void this.app.workspace.revealLeaf(leaf);
			view.revealInFolder(folder);
			return;
		}
		const first = folder.children.find((c): c is TFile => c instanceof TFile);
		if (first) void this.app.workspace.getLeaf(false).openFile(first);
		else new Notice("The folder is empty.");
	}

	/** Runs the import dialog for every configured CSV file that still exists, one after the other. */
	private async reimportAll(): Promise<void> {
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

	// --- helpers ---

	private getActiveCsvFile(): TFile | null {
		const view = this.app.workspace.getActiveViewOfType(CsvView);
		if (view?.file) return view.file;
		const md = this.app.workspace.getActiveViewOfType(MarkdownView);
		const f = md?.file ?? this.app.workspace.getActiveFile();
		return isCsv(f) ? f : null;
	}

	private async importFromDisk(file: TFile): Promise<void> {
		try {
			const text = await this.readCsv(file);
			await this.importFile(file, text);
		} catch (e) {
			console.error("CSV Importer: could not read file", e);
			new Notice(`Could not read ${file.name}.`);
		}
	}

	private async openConfig(file: TFile): Promise<void> {
		try {
			const text = await this.readCsv(file);
			new ImportConfigModal(this.app, this, file, text).open();
		} catch (e) {
			console.error("CSV Importer: could not open configuration", e);
			new Notice(`Could not read ${file.name}.`);
		}
	}
}
