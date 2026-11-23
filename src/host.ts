import type { TFile } from "obsidian";
import type { CsvEncoding, FileImportConfig, ImportResult, PluginSettings } from "./types";

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
	/** Reads and decodes the CSV with an explicit encoding (e.g. an unsaved choice in the settings dialog). */
	readCsvDecoded(file: TFile, encoding: CsvEncoding): Promise<{ text: string; encoding: Exclude<CsvEncoding, "auto"> }>;
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

/** One configured CSV as shown in the imports index. */
export interface ImportSummary {
	csvPath: string;
	fileName: string;
	/** False when the CSV file no longer exists in the vault. */
	exists: boolean;
	/** Static part of the target folder, "" when unknown. */
	targetFolder: string;
	/** Timestamp of the last import, or null. */
	lastImport: number | null;
	hasUndo: boolean;
	/** Path of the `.base` file when it exists, else null. */
	basePath: string | null;
}

/** What the imports index view needs on top of the base host. */
export interface ImportIndexHost extends CsvImporterHost {
	/** All CSVs with saved settings, most recently imported first, then by name. */
	listImports(): Promise<ImportSummary[]>;
	/** Number of notes the CSV's import owns (snapshot entries). */
	countImportedNotes(csvPath: string): Promise<number>;
	/** Runs the normal import dialog flow for a CSV by path. */
	reimport(csvPath: string): Promise<void>;
	/** Runs the import dialog for every configured CSV that exists. */
	reimportAll(): Promise<void>;
	/** Opens the import settings dialog for a CSV by path. */
	configureImport(csvPath: string): Promise<void>;
	/** Reverts the last import (asks for confirmation). */
	undoImport(csvPath: string): Promise<void>;
	/** Moves the notes this import created to the trash after confirmation. Resolves with the number trashed. */
	deleteImportedNotes(csvPath: string): Promise<number>;
	/** Deletes settings and history for a CSV after confirmation; notes stay. Resolves true when removed. */
	removeFromIndex(csvPath: string): Promise<boolean>;
}
