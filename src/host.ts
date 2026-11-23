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
	/** Reads and decodes the CSV file honoring config.encoding (handles UTF-16 / Windows-1252). */
	readCsv(file: TFile): Promise<string>;
	/**
	 * Runs the import flow for the CSV (opens the import dialog: dry-run preview -> confirm -> progress with
	 * stop -> report). `text` is the current decoded content. Resolves with the result when the dialog closes
	 * (a dry-run-only result with dryRun=true if the user cancelled before writing).
	 */
	importFile(file: TFile, text: string): Promise<ImportResult>;
	/** Whether the last import of this CSV can be undone. */
	canUndo(file: TFile): boolean;
	/** Reverts the last import of this CSV (asks for confirmation, shows a notice). */
	undoLastImport(file: TFile): Promise<void>;
}
