import type { TFile } from "obsidian";
import type { FileImportConfig, ImportResult, PluginSettings } from "./types";

/**
 * What the view/modals need from the plugin. Implemented by the plugin class in main.ts.
 * Keeps UI code decoupled from main.ts (no circular imports).
 */
export interface CsvImporterHost {
	readonly settings: PluginSettings;
	/** Returns the persisted config for a CSV file, or a fresh one built from defaults (not persisted yet). */
	getFileConfig(file: TFile): FileImportConfig;
	/** Persists the config for a CSV file. */
	saveFileConfig(file: TFile, config: FileImportConfig): Promise<void>;
	/**
	 * Imports all rows of the given CSV using its (persisted) config.
	 * `text` is the current file content. Shows progress/notice itself and returns the result.
	 */
	importFile(file: TFile, text: string): Promise<ImportResult>;
}
