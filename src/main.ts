import { Notice, Plugin } from "obsidian";
import type { TFile } from "obsidian";
import { ConfigStore } from "./configStore";
import { CURRENT_DATA_VERSION, DEFAULT_SETTINGS, migrateFileConfig, sanitizeSettings } from "./defaults";
import type { CsvStatus, EditedNotes, ImportFileOptions, ImportIndexHost, ImportSummary } from "./host";
import { ImportService } from "./obsidian/importService";
import { isCsv, registerVaultEvents } from "./obsidian/vaultEvents";
import { CsvImporterSettingTab } from "./settings";
import type { SettingsHost } from "./settings";
import { ImportStorage } from "./storage";
import type { CsvEncoding, FileImportConfig, ImportResult, PluginData, PluginSettings } from "./types";
import { CsvView, VIEW_TYPE_CSV } from "./view/CsvView";
import { ImportConfigModal } from "./view/ImportConfigModal";
import { ImportIndexView, VIEW_TYPE_IMPORT_INDEX } from "./view/ImportIndexView";
import { IMPORT_BUTTON, IMPORT_SETTINGS, OPEN_CSV_IMPORTS, REIMPORT_BUTTON, UNDO_LAST_IMPORT } from "./view/labels";

/**
 * Plugin entry point: loads settings, registers the view, commands, menus and vault events, and hands the host
 * interface used by the UI to the `ImportService`.
 */
export default class CsvImporterPlugin extends Plugin implements ImportIndexHost, SettingsHost {
	override settings: PluginSettings = { ...DEFAULT_SETTINGS };
	private store!: ConfigStore;
	private storage!: ImportStorage;
	private service!: ImportService;
	/** data.json was written by a newer version of the plugin: it is read as far as known, but never overwritten. */
	private dataFromNewerVersion = false;

	override async onload(): Promise<void> {
		const raw = (await this.loadData()) as Partial<PluginData> | null;
		this.settings = sanitizeSettings(raw?.settings);
		const version = typeof raw?.version === "number" ? raw.version : 0;
		this.dataFromNewerVersion = version > CURRENT_DATA_VERSION;
		if (this.dataFromNewerVersion) {
			new Notice(
				"CSV importer: the saved settings come from a newer version of the plugin. Update the plugin; until then, changes to settings are not saved.",
				0,
			);
		}
		const files: Record<string, FileImportConfig> = {};
		const storedFiles = raw?.files && typeof raw.files === "object" ? raw.files : {};
		for (const [path, cfg] of Object.entries(storedFiles)) files[path] = migrateFileConfig(cfg, this.settings);
		this.store = new ConfigStore(files, () => this.persist());
		this.storage = new ImportStorage(this.app, this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
		this.service = new ImportService(this.app, this.storage, this.store, () => this.settings);
		void this.storage.init();
		if (version < CURRENT_DATA_VERSION) void this.persist().catch((e) => console.error("CSV Importer: could not save data", e));

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

		this.registerView(VIEW_TYPE_IMPORT_INDEX, (leaf) => new ImportIndexView(leaf, this));
		this.addRibbonIcon("table-properties", OPEN_CSV_IMPORTS, () => void this.openImportIndex());

		this.addSettingTab(new CsvImporterSettingTab(this.app, this, this));
		registerVaultEvents(this, this.store, this.storage);
		this.registerCommands();
		this.registerMenus();
	}

	private registerCommands(): void {
		const svc = this.service;
		this.addCommand({
			id: "open-import-index",
			name: OPEN_CSV_IMPORTS,
			callback: () => void this.openImportIndex(),
		});
		this.addCommand({
			id: "import-current-csv",
			name: "Import current CSV file",
			checkCallback: (checking) => {
				const file = svc.getActiveCsvFile();
				if (!file) return false;
				if (!checking) void svc.importFromDisk(file);
				return true;
			},
		});
		this.addCommand({
			id: "reimport-all-csv",
			name: "Re-import all CSV imports",
			callback: () => void svc.reimportAll(),
		});
		this.addCommand({
			id: "undo-import-current-csv",
			name: "Undo last import of current CSV file",
			checkCallback: (checking) => {
				const file = svc.getActiveCsvFile();
				if (!file || !svc.canUndo(file)) return false;
				if (!checking) void svc.undoLastImport(file);
				return true;
			},
		});
		this.addCommand({
			id: "configure-current-csv",
			name: "Open import settings for current CSV file",
			checkCallback: (checking) => {
				const file = svc.getActiveCsvFile();
				if (!file) return false;
				if (!checking) void this.openConfig(file);
				return true;
			},
		});
	}

	private registerMenus(): void {
		const svc = this.service;
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!isCsv(file)) return;
				const imported = (this.store.get(file.path)?.lastImport ?? null) !== null;
				menu.addItem((item) =>
					item
						.setTitle(imported ? REIMPORT_BUTTON : IMPORT_BUTTON)
						.setIcon(imported ? "refresh-cw" : "file-plus")
						.onClick(() => void svc.importFromDisk(file)),
				);
				menu.addItem((item) =>
					item
						.setTitle(IMPORT_SETTINGS)
						.setIcon("sliders-horizontal")
						.onClick(() => void this.openConfig(file)),
				);
				if (svc.canUndo(file)) {
					menu.addItem((item) =>
						item
							.setTitle(UNDO_LAST_IMPORT)
							.setIcon("undo-2")
							.onClick(() => void svc.undoLastImport(file)),
					);
				}
			}),
		);
	}

	/** Opens the imports index in a new tab, or reveals the existing one. */
	async openImportIndex(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_IMPORT_INDEX)[0];
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_IMPORT_INDEX, active: true });
		}
		await workspace.revealLeaf(leaf);
		workspace.setActiveLeaf(leaf, { focus: true });
	}

	private async openConfig(file: TFile): Promise<void> {
		try {
			const text = await this.service.readCsv(file);
			new ImportConfigModal(this.app, this, file, text).open();
		} catch (e) {
			console.error("CSV Importer: could not open the import settings", e);
			new Notice(`Could not read ${file.name}.`);
		}
	}

	// --- SettingsHost ---

	async saveSettings(): Promise<void> {
		await this.persist();
	}

	async forgetAllFileConfigs(): Promise<void> {
		await this.store.clear();
	}

	private persist(): Promise<void> {
		if (this.dataFromNewerVersion) return Promise.resolve();
		const data: PluginData = { version: CURRENT_DATA_VERSION, settings: this.settings, files: this.store ? this.store.toRecord() : {} };
		return this.saveData(data);
	}

	// --- CsvImporterHost (delegates to the service) ---

	getFileConfig(file: TFile): FileImportConfig {
		return this.service.getFileConfig(file);
	}

	saveFileConfig(file: TFile, config: FileImportConfig): Promise<void> {
		return this.service.saveFileConfig(file, config);
	}

	readCsv(file: TFile): Promise<string> {
		return this.service.readCsv(file);
	}

	readCsvDecoded(file: TFile, encoding: CsvEncoding): Promise<{ text: string; encoding: Exclude<CsvEncoding, "auto"> }> {
		return this.service.readCsvDecoded(file, encoding);
	}

	canUndo(file: TFile): boolean {
		return this.service.canUndo(file);
	}

	importFile(file: TFile, text: string, opts?: ImportFileOptions): Promise<ImportResult> {
		return this.service.runImportDialog(file, text, opts);
	}

	csvStatus(file: TFile): Promise<CsvStatus> {
		return this.service.csvStatus(file);
	}

	undoLastImport(file: TFile): Promise<void> {
		return this.service.undoLastImport(file);
	}

	// --- ImportIndexHost ---

	listImports(): Promise<ImportSummary[]> {
		return this.service.listImports();
	}

	countImportedNotes(csvPath: string): Promise<number> {
		return this.service.countImportedNotes(csvPath);
	}

	countEditedNotes(csvPath: string): Promise<EditedNotes> {
		return this.service.countEditedNotes(csvPath);
	}

	listUnindexedCsvs(): TFile[] {
		return this.service.listUnindexedCsvs();
	}

	countCsvRows(file: TFile): Promise<number | null> {
		return this.service.countCsvRows(file);
	}

	addToIndex(csvPaths: string[]): Promise<number> {
		return this.service.addToIndex(csvPaths);
	}

	addExternalCsv(data: ArrayBuffer, folder: string, fileName: string, conflict: "replace" | "keep"): Promise<TFile> {
		return this.service.addExternalCsv(data, folder, fileName, conflict);
	}

	reimportChanged(): Promise<void> {
		return this.service.reimportChanged();
	}

	reimport(csvPath: string): Promise<void> {
		return this.service.reimport(csvPath);
	}

	reimportAll(): Promise<void> {
		return this.service.reimportAll();
	}

	async configureImport(csvPath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(csvPath);
		if (isCsv(file)) await this.openConfig(file);
		else new Notice("The CSV file no longer exists.");
	}

	undoImport(csvPath: string): Promise<void> {
		return this.service.undoImport(csvPath);
	}

	deleteImportedNotes(csvPath: string): Promise<number> {
		return this.service.deleteImportedNotes(csvPath);
	}

	removeFromIndex(csvPath: string): Promise<boolean> {
		return this.service.removeFromIndex(csvPath);
	}
}
