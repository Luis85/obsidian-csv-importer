import { MarkdownView, Notice, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import type { CsvImporterHost } from "./host";
import { ConfigStore } from "./configStore";
import { parseCsv } from "./csv/parser";
import { prepareConfig } from "./csv/typeInference";
import { planNotes } from "./import/noteBuilder";
import { registerPropertyTypes, writeNotes } from "./import/importer";
import { createDefaultFileConfig, CsvImporterSettingTab, DEFAULT_SETTINGS } from "./settings";
import type { SettingsHost } from "./settings";
import type { FileImportConfig, ImportResult, PluginData, PluginSettings } from "./types";
import { CsvView, VIEW_TYPE_CSV } from "./view/CsvView";
import { ImportConfigModal } from "./view/ImportConfigModal";

function isCsv(file: TAbstractFile | null): file is TFile {
	return file instanceof TFile && file.extension.toLowerCase() === "csv";
}

export default class CsvImporterPlugin extends Plugin implements CsvImporterHost, SettingsHost {
	settings: PluginSettings = { ...DEFAULT_SETTINGS };
	private store!: ConfigStore;

	async onload(): Promise<void> {
		const raw = (await this.loadData()) as Partial<PluginData> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw?.settings ?? {});
		this.store = new ConfigStore(raw?.files, () => this.persist());

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
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (isCsv(file)) void this.store.delete(file.path);
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

	async importFile(file: TFile, text: string): Promise<ImportResult> {
		const empty: ImportResult = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
		const notice = new Notice("Importing…", 0);
		try {
			const cfg = this.getFileConfig(file);
			const parsed = parseCsv(text, cfg);
			prepareConfig(cfg, parsed, this.settings.midnightAsDate);
			const notes = planNotes(parsed, cfg, { path: file.path, basename: file.basename });
			if (this.settings.registerPropertyTypes) {
				const reg = registerPropertyTypes(this.app, cfg.columns);
				if (reg.conflicts.length > 0) {
					const label = (t: string): string => (t === "multitext" ? "list" : t);
					const wantedLabel = (t: string): string => (t === "multitext" ? "list" : t);
					const lines = reg.conflicts.map(
						(c) =>
							`Property "${c.property}" is already typed as ${label(c.existing)} in Obsidian; kept that type. Values were written as ${wantedLabel(c.wanted)}.`,
					);
					console.warn("CSV Importer: property type conflicts", reg.conflicts);
					new Notice(lines.slice(0, 5).join("\n") + (lines.length > 5 ? `\n…and ${lines.length - 5} more.` : ""), 12000);
				}
			}

			let lastShown = 0;
			const result = await writeNotes(this.app, notes, cfg, (done, total) => {
				const now = Date.now();
				if (now - lastShown > 100 || done === total) {
					lastShown = now;
					notice.setMessage(`Importing ${done}/${total}…`);
				}
			});

			cfg.lastImport = Date.now();
			await this.saveFileConfig(file, cfg);

			notice.hide();
			const parts = [`${result.created} created`, `${result.updated} updated`, `${result.skipped} skipped`];
			if (result.failed > 0) parts.push(`${result.failed} failed`);
			new Notice(`Import finished: ${parts.join(", ")}.`, 8000);
			for (const err of result.errors.slice(0, 20)) {
				console.error(`CSV Importer: row ${err.row}: ${err.message}`);
			}
			return result;
		} catch (e) {
			notice.hide();
			console.error("CSV Importer: import failed", e);
			new Notice(`Import failed: ${e instanceof Error ? e.message : String(e)}`, 10000);
			return { ...empty, failed: 1, errors: [{ row: 0, message: e instanceof Error ? e.message : String(e) }] };
		}
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
			const text = await this.app.vault.read(file);
			await this.importFile(file, text);
		} catch (e) {
			console.error("CSV Importer: could not read file", e);
			new Notice(`Could not read ${file.name}.`);
		}
	}

	private async openConfig(file: TFile): Promise<void> {
		try {
			const text = await this.app.vault.read(file);
			new ImportConfigModal(this.app, this, file, text).open();
		} catch (e) {
			console.error("CSV Importer: could not open configuration", e);
			new Notice(`Could not read ${file.name}.`);
		}
	}
}
