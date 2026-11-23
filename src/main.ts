import { Notice, Plugin } from "obsidian";
import type { TFile } from "obsidian";
import { ConfigStore } from "./configStore";
import { DEFAULT_SETTINGS } from "./defaults";
import type { CsvImporterHost } from "./host";
import { ImportService } from "./obsidian/importService";
import { isCsv, registerVaultEvents } from "./obsidian/vaultEvents";
import { CsvImporterSettingTab } from "./settings";
import type { SettingsHost } from "./settings";
import { ImportStorage } from "./storage";
import type { CsvEncoding, FileImportConfig, ImportResult, PluginData, PluginSettings } from "./types";
import { CsvView, VIEW_TYPE_CSV } from "./view/CsvView";
import { ImportConfigModal } from "./view/ImportConfigModal";

/**
 * Plugin entry point: loads settings, registers the view, commands, menus and vault events, and hands the host
 * interface used by the UI to the `ImportService`.
 */
export default class CsvImporterPlugin extends Plugin implements CsvImporterHost, SettingsHost {
	settings: PluginSettings = { ...DEFAULT_SETTINGS };
	private store!: ConfigStore;
	private storage!: ImportStorage;
	private service!: ImportService;

	async onload(): Promise<void> {
		const raw = (await this.loadData()) as Partial<PluginData> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw?.settings ?? {});
		this.store = new ConfigStore(raw?.files, () => this.persist());
		this.storage = new ImportStorage(this.app, this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
		this.service = new ImportService(this.app, this.storage, this.store, () => this.settings);
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
		registerVaultEvents(this, this.store, this.storage);
		this.registerCommands();
		this.registerMenus();
	}

	private registerCommands(): void {
		const svc = this.service;
		this.addCommand({
			id: "import-current-csv",
			name: "Import rows from current CSV file",
			checkCallback: (checking) => {
				const file = svc.getActiveCsvFile();
				if (!file) return false;
				if (!checking) void svc.importFromDisk(file);
				return true;
			},
		});
		this.addCommand({
			id: "reimport-all-csv",
			name: "Re-import all configured CSV files",
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
			name: "Configure import for current CSV file",
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
				menu.addItem((item) =>
					item
						.setTitle("Import rows as notes")
						.setIcon("table")
						.onClick(() => void svc.importFromDisk(file)),
				);
				menu.addItem((item) =>
					item
						.setTitle("Configure CSV import")
						.setIcon("settings")
						.onClick(() => void this.openConfig(file)),
				);
				if (svc.canUndo(file)) {
					menu.addItem((item) =>
						item
							.setTitle("Undo last CSV import")
							.setIcon("undo-2")
							.onClick(() => void svc.undoLastImport(file)),
					);
				}
			}),
		);
	}

	private async openConfig(file: TFile): Promise<void> {
		try {
			const text = await this.service.readCsv(file);
			new ImportConfigModal(this.app, this, file, text).open();
		} catch (e) {
			console.error("CSV Importer: could not open configuration", e);
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
		const data: PluginData = { settings: this.settings, files: this.store ? this.store.toRecord() : {} };
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

	importFile(file: TFile, text: string): Promise<ImportResult> {
		return this.service.runImportDialog(file, text);
	}

	undoLastImport(file: TFile): Promise<void> {
		return this.service.undoLastImport(file);
	}
}
