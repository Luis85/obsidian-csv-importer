/**
 * Shared types and contracts for the CSV Importer plugin.
 * Every module imports its cross-module types from here.
 */

/** Property types we can write into note frontmatter. Mirrors Obsidian's property types. */
export type PropertyType = "text" | "number" | "checkbox" | "date" | "datetime" | "list";

/** Delimiter option. "auto" means detect from file content. */
export type DelimiterOption = "auto" | "," | ";" | "\t" | "|";

/** How empty cells are written into frontmatter. */
export type EmptyValueMode = "empty" | "omit";

/** Text encoding of the CSV file. "auto": BOM sniffing, then UTF-8, falling back to Windows-1252. */
export type CsvEncoding = "auto" | "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

/** What to do when the target note already exists. */
export type ConflictStrategy =
	/** Leave the existing note untouched. */
	| "skip"
	/** Replace the whole note (frontmatter + body). */
	| "overwrite"
	/**
	 * Update only the CSV's own properties; keep every other property and the body.
	 * See FileImportConfig.protectEdits / keepValuesOnEmpty.
	 */
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
	/**
	 * Optional value transform applied after type conversion, e.g. `[[{{value}}]]` to turn the cell into a wikilink.
	 * `{{value}}` (alias `$value`) is the converted cell value; `{{Other column}}`, `{{row}}`, `{{file}}` also work.
	 * For `list` columns it is applied to every item. A non-empty template makes the value text (or list of text).
	 * Empty cells stay empty (template not applied). Empty string/undefined = no transform.
	 */
	valueTemplate?: string;
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
	/** How empty cells are written: `empty` -> `key:` (empty property), `omit` -> key left out. Never `""`. */
	emptyValues: EmptyValueMode;
	/** Round numbers to this many decimal places; null keeps the source precision. */
	numberPrecision: number | null;
	/**
	 * Source header of the column that identifies a row (e.g. an ID). When set, re-imports match existing
	 * notes in the target folder by this property's value instead of by file path, so renamed notes are
	 * still updated and no duplicates are created. Empty string = match by file path.
	 */
	keyColumn: string;
	encoding: CsvEncoding;
	/**
	 * Update mode: a CSV property whose value was changed in Obsidian since the last import keeps the
	 * Obsidian value (detected via the snapshot of last imported values). Properties added in Obsidian
	 * are always kept regardless of this flag.
	 */
	protectEdits: boolean;
	/** Update mode: an empty CSV cell does not clear a value that exists in the note. */
	keepValuesOnEmpty: boolean;
	/** Create a `.base` file listing the imported notes (only if it does not exist yet). */
	createBase: boolean;
	/**
	 * Allow re-imports to update existing notes that this CSV did not create (no snapshot entry and no source
	 * link to this CSV) when they match by key or path. Off by default: such notes are skipped as "not created
	 * by this import" so unrelated notes are never changed.
	 */
	adoptExistingNotes: boolean;
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
	defaultEmptyValues: EmptyValueMode;
	defaultEncoding: CsvEncoding;
	defaultProtectEdits: boolean;
	defaultKeepValuesOnEmpty: boolean;
	defaultCreateBase: boolean;
	/** Infer `date` instead of `datetime` when every time component is 00:00:00. */
	midnightAsDate: boolean;
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
	/**
	 * 1-based data row number of each entry in `rows` as counted in the file INCLUDING skipped blank rows
	 * (so `{{row}}` and file names stay stable when blank rows are skipped). Same length as `rows`.
	 */
	rowNumbers: number[];
	/** Non-fatal problems found while parsing, e.g. "Unterminated quote starting in row 12." Shown to the user. */
	warnings: string[];
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
	/** Property types of the frontmatter keys (columns + `tags` -> list, `source` -> text). Used by serializeNote. */
	types: Record<string, PropertyType>;
	/** Key for matching existing notes: `{ property, value }` when config.keyColumn is set and the cell is non-empty. */
	key: { property: string; value: string } | null;
}

/** Outcome of one planned note. */
export type NoteOutcome = "created" | "updated" | "unchanged" | "skipped" | "failed";

export interface RowOutcome {
	/** 1-based data row number. */
	row: number;
	/** Vault path of the note (existing note path for key matches). */
	path: string;
	outcome: NoteOutcome;
	/** Human readable reason for skipped/failed/unchanged, e.g. "already exists", "duplicate key". */
	reason?: string;
	/** Properties changed (updated/created) or that would change (dry run). */
	changed?: string[];
	/** Properties kept because they were edited in Obsidian since the last import. */
	preserved?: string[];
}

/** Hash of the last imported value per property, per note. Keyed by note path. */
export type ImportSnapshot = Record<string, Record<string, string>>;

/** What is needed to revert the last import of a CSV file. */
export interface UndoManifest {
	csvPath: string;
	timestamp: number;
	/** Notes created by the import (moved to trash on undo). */
	created: string[];
	/** Notes modified by the import with their full previous content. */
	modified: { path: string; content: string }[];
	/** Snapshot entries of the modified notes as they were before the import, restored on undo. */
	snapshotBefore?: ImportSnapshot;
	/**
	 * Hash (valueHash of the full text) of each created/modified note right after the import. Undo skips notes
	 * whose current content no longer matches (edited after the import) and reports them instead.
	 */
	writtenHashes?: Record<string, string>;
}

/** Summary of an import run. */
export interface ImportResult {
	created: number;
	updated: number;
	unchanged: number;
	skipped: number;
	failed: number;
	/** True when the run was stopped by the user. */
	cancelled: boolean;
	/** True for a dry run (nothing written). */
	dryRun: boolean;
	rows: RowOutcome[];
	/** Run-level warnings shown in the preview/report, e.g. "No key column: notes are matched by file name." */
	warnings: string[];
	errors: { row: number; message: string }[];
}
