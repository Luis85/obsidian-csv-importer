import type { TFile } from "obsidian";
import type { CsvEncoding, FileImportConfig, ImportResult, LastRunCounts, PluginSettings } from "./types";

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
	importFile(file: TFile, text: string, opts?: ImportFileOptions): Promise<ImportResult>;
	/**
	 * Whether the CSV changed since its last import (size and modification time first, content hash only when
	 * they differ). A CSV that was never imported is not "changed". An import from before fingerprints were
	 * recorded counts as changed until it is imported again.
	 */
	csvStatus(file: TFile): Promise<CsvStatus>;
	/** Whether the last import of this CSV can be undone. */
	canUndo(file: TFile): boolean;
	/** Reverts the last import of this CSV (asks for confirmation, shows a notice). */
	undoLastImport(file: TFile): Promise<void>;
}

/** Options of `CsvImporterHost.importFile`. */
export interface ImportFileOptions {
	/**
	 * Original 1-based data row numbers (`ParsedCsv.rowNumbers`) to import. When given, only the notes of these rows
	 * are previewed and written; other rows are ignored for this run. Not persisted.
	 */
	rows?: number[];
}

/** Whether a CSV differs from what was last imported. */
export interface CsvStatus {
	/** True when the CSV was imported before and its content differs from that import (or no fingerprint was recorded). */
	changed: boolean;
	/** The CSV has been imported at least once. */
	imported: boolean;
	/** Epoch ms of the last import, or null. */
	lastImport: number | null;
	/** Modification time of the CSV file (epoch ms). */
	modifiedAt: number;
}

/** Notes of an import whose managed properties were edited in Obsidian since the import. */
export interface EditedNotes {
	/** Number of notes with at least one edited managed property. */
	count: number;
	/** Names of the edited properties (sorted, at most `limit`). */
	properties: string[];
	/** Number of notes checked. */
	checked: number;
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
	/** The CSV changed since its last import (see `CsvImporterHost.csvStatus`). */
	changed: boolean;
	/** Modification time of the CSV (epoch ms), null when the file is missing. */
	modifiedAt: number | null;
	/** Outcome counts of the last import; null for imports from before they were recorded. */
	lastRun: LastRunCounts | null;
}

/** What the imports index view needs on top of the base host. */
export interface ImportIndexHost extends CsvImporterHost {
	/** All CSVs with saved settings, most recently imported first, then by name. */
	listImports(): Promise<ImportSummary[]>;
	/** Number of notes the CSV's import owns (snapshot entries). */
	countImportedNotes(csvPath: string): Promise<number>;
	/** Notes of this CSV's import whose managed properties differ from what the import wrote (loaded lazily per row). */
	countEditedNotes(csvPath: string): Promise<EditedNotes>;
	/** CSV files in the vault that have no import settings yet, by path. */
	listUnindexedCsvs(): TFile[];
	/** Number of data rows of a CSV with the default settings (for the scan list), or null when it cannot be read. */
	countCsvRows(file: TFile): Promise<number | null>;
	/** Creates default settings for these CSVs so they appear in the index. No import. Resolves with the number added. */
	addToIndex(csvPaths: string[]): Promise<number>;
	/** Copies the bytes of a file chosen outside the vault into the vault, adds it to the index and opens it. */
	addExternalCsv(data: ArrayBuffer, folder: string, fileName: string, conflict: "replace" | "keep"): Promise<TFile>;
	/** Runs the import dialog for every CSV that changed since its last import, one after the other. */
	reimportChanged(): Promise<void>;
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
