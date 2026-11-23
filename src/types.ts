/**
 * Shared types and contracts for the CSV Importer plugin.
 * Every module imports its cross-module types from here.
 */

/** Property types we can write into note frontmatter. Mirrors Obsidian's property types. */
export type PropertyType = "text" | "number" | "checkbox" | "date" | "datetime" | "list";

/** Delimiter option. "auto" means detect from file content. */
export type DelimiterOption = "auto" | "," | ";" | "\t" | "|";

/** What to do when the target note already exists. */
export type ConflictStrategy =
	/** Leave the existing note untouched. */
	| "skip"
	/** Replace the whole note (frontmatter + body). */
	| "overwrite"
	/** Merge imported properties into existing frontmatter, keep the body. */
	| "update"
	/** Create a new note with a numeric suffix: "Name 1.md". */
	| "rename";

/** Per-column import configuration. */
export interface ColumnConfig {
	/** Header text in the CSV (or "Column N" when the file has no header row). */
	source: string;
	/** Zero-based index of the column in the CSV. */
	index: number;
	/** Frontmatter property name to write. Defaults to the sanitized header. */
	property: string;
	/** Property type. Initially inferred, user may override. */
	type: PropertyType;
	/** Whether the column is written into frontmatter. */
	include: boolean;
}

/** Import configuration persisted per CSV file (keyed by vault path). */
export interface FileImportConfig {
	delimiter: DelimiterOption;
	/** First row contains column names. */
	hasHeader: boolean;
	/** Decimal separator used when parsing numbers ("," for e.g. German exports like 0,625). */
	decimalSeparator: "." | ",";
	/**
	 * Folder (vault path) where notes are created. Empty string means
	 * "next to the CSV, in a folder named like the CSV file" (e.g. `Data/hours.csv` -> `Data/hours`).
	 */
	targetFolder: string;
	/**
	 * Note file name template. `{{Column Name}}` inserts a cell value by header,
	 * `{{row}}` inserts the 1-based data row number, `{{file}}` the CSV basename.
	 */
	fileNameTemplate: string;
	/** Note body template. Same placeholders as fileNameTemplate. May be empty. */
	bodyTemplate: string;
	conflict: ConflictStrategy;
	/** Comma separated tags added to the `tags` property of every imported note. */
	tags: string;
	/** Add a `source` property with a wikilink to the CSV file. */
	addSourceLink: boolean;
	/** Separator used to split values of `list` typed columns (e.g. ","). */
	listSeparator: string;
	/** Column configs. Empty array means "not configured yet" -> infer on open. */
	columns: ColumnConfig[];
	/** Epoch ms of the last import, or null. */
	lastImport: number | null;
}

/** Global plugin settings (defaults for new file configs + general behavior). */
export interface PluginSettings {
	defaultDelimiter: DelimiterOption;
	defaultHasHeader: boolean;
	defaultDecimalSeparator: "." | ",";
	/** Default target folder; empty = folder named after the CSV next to it. */
	defaultTargetFolder: string;
	defaultFileNameTemplate: string;
	defaultBodyTemplate: string;
	defaultConflict: ConflictStrategy;
	defaultTags: string;
	defaultAddSourceLink: boolean;
	defaultListSeparator: string;
	/** Infer `date` instead of `datetime` when every time component is 00:00:00. */
	midnightAsDate: boolean;
	/** Also register inferred types in Obsidian's property type registry (types.json). */
	registerPropertyTypes: boolean;
	/** Max rows rendered in the table before "show more". */
	pageSize: number;
}

/** Shape of data.json. */
export interface PluginData {
	settings: PluginSettings;
	/** Per-file configs keyed by CSV vault path. */
	files: Record<string, FileImportConfig>;
}

/** Result of parsing CSV text. */
export interface ParsedCsv {
	/** Header names. Generated as "Column 1".. when hasHeader is false. Always unique & non-empty. */
	headers: string[];
	/** Data rows (header row excluded). Rows are padded/truncated to headers.length. */
	rows: string[][];
	/** Delimiter actually used. */
	delimiter: Exclude<DelimiterOption, "auto">;
}

/** Value that can be written into YAML frontmatter. */
export type FrontmatterValue = string | number | boolean | string[] | null;

/** A note ready to be written: no vault access needed to produce it. */
export interface PlannedNote {
	/** Full vault path including `.md`. Conflicts are NOT resolved yet. */
	path: string;
	frontmatter: Record<string, FrontmatterValue>;
	body: string;
	/** 1-based data row number. */
	row: number;
}

/** Summary of an import run. */
export interface ImportResult {
	created: number;
	updated: number;
	skipped: number;
	failed: number;
	errors: { row: number; message: string }[];
}
