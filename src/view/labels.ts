import type { ConflictStrategy, CsvEncoding, DateOrder, EmptyValueMode, PropertyType, RowFilterOp } from "../types";

/** User-facing strings shared by the settings tab, the import settings dialog and the table view. */

export const TYPE_LABELS: Record<PropertyType, string> = {
	text: "Text",
	number: "Number",
	checkbox: "Checkbox",
	date: "Date",
	datetime: "Date & time",
	list: "List",
};

/** Short labels used on the type badges in the table header. */
export const TYPE_BADGES: Record<PropertyType, string> = {
	text: "Text",
	number: "Number",
	checkbox: "Yes/no",
	date: "Date",
	datetime: "Date & time",
	list: "List",
};

export const ENCODING_LABELS: Record<CsvEncoding, string> = {
	auto: "Auto",
	"utf-8": "UTF-8",
	"utf-16le": "UTF-16 LE",
	"utf-16be": "UTF-16 BE",
	"windows-1252": "Windows-1252",
};

/** Delimiter choices, one map for the settings tab and the import settings dialog. */
export const DELIMITER_OPTIONS: Record<string, string> = {
	auto: "Detect automatically",
	",": "Comma",
	";": "Semicolon",
	"\t": "Tab",
	"|": "Pipe",
};

/** Decimal separator choices with an example, shared by the settings tab and the dialog. */
export const DECIMAL_OPTIONS: Record<string, string> = { ".": "Dot (0.625)", ",": "Comma (0,625)" };

export const EMPTY_VALUE_OPTIONS: Record<EmptyValueMode, string> = {
	empty: "Leave property empty",
	omit: "Omit property",
};

export const CONFLICT_OPTIONS: Record<ConflictStrategy, string> = {
	update: "Update properties",
	skip: "Skip",
	rename: "Create a copy",
	overwrite: "Replace whole note",
};

/** Per-strategy descriptions shown in the import settings dialog. */
export const CONFLICT_DESCRIPTIONS: Record<ConflictStrategy, string> = {
	update: "Updates the CSV's properties. Properties you added in Obsidian and the note body are kept.",
	skip: "Leaves existing notes untouched.",
	rename: "Creates a new note with a numeric suffix and keeps the existing note as it is.",
	overwrite: "Overwrites the note completely. Properties and text you added in Obsidian are lost. You can undo right after the import.",
};

/** Setting names used in both the settings tab and the import settings dialog. */
export const NAME = {
	encoding: "Encoding",
	delimiter: "Delimiter",
	hasHeader: "First row contains column names",
	decimal: "Decimal separator",
	listSeparator: "List separator",
	emptyCells: "Empty cells",
	targetFolder: "Target folder",
	fileName: "File name template",
	body: "Body template",
	tags: "Comma-separated tags",
	createBase: "Create a base",
	conflict: "When a note already exists",
	protectEdits: "Keep values edited in Obsidian",
	keepOnEmpty: "Keep values when the CSV cell is empty",
} as const;

/** Descriptions in the settings tab (defaults for unconfigured files). */
export const SETTINGS_DESC = {
	intro: "Defaults for CSV files you have not configured yet. Each file keeps its own settings once you save them.",
	encoding: "Auto detects UTF-8, UTF-16 and Windows-1252.",
	delimiter: "Column separator. Automatic detection looks at the file content.",
	decimal: "Used when reading numbers, for example 0,625 in many European exports.",
	listSeparator: "Splits cell values of list columns into items.",
	emptyCells: "How empty cells are written into the properties of a note.",
	midnight: "Detect a date instead of a date and time when every time in a column is 00:00:00.",
	targetFolder: "Leave empty to create notes in a folder named like the CSV file, next to it.",
	fileName: "Use {{Column name}} for cell values, {{row}} for the row number and {{file}} for the CSV name.",
	body: "Text placed below the properties. Supports the same placeholders.",
	tags: "Added to every imported note.",
	sourceLink: "Writes a source property that links back to the CSV file.",
	createBase: "Create a .base file next to the target folder that shows the imported notes as a table.",
	conflict: "Update properties keeps properties you added in Obsidian and the note body. Replace whole note overwrites the note completely.",
	protectEdits: "When updating, a CSV property you changed in Obsidian keeps your value.",
	keepOnEmpty: "When updating, an empty cell does not clear a value in the note.",
	pageSize: "Maximum number of rows rendered in the table before showing more.",
	imports: "See every CSV with saved import settings, and re-import, configure or undo from one list.",
	reset: "Removes the saved import settings of every CSV file. Imported notes are not affected.",
} as const;

/** Descriptions in the import settings dialog (one file). */
export const CONFIG_DESC = {
	targetFolder:
		"Leave empty to use the default folder shown as placeholder. Placeholders like {{Column}} create subfolders per row, for example Projects/{{Client}}.",
	fileName: "Use {{Column name}} for cell values, {{row}} for the row number and {{file}} for the CSV name. The note body is set in the Notes tab of the import settings.",
	key: "On re-import, the note whose property matches this column is updated, even if renamed. Pick a unique column such as an ID. The column is always written to the notes.",
	protectEdits: "If you changed a CSV property in Obsidian, re-imports keep your value.",
	keepOnEmpty: "An empty cell does not clear a value that exists in the note.",
	encoding: "Text encoding of the file. Change it if special characters look wrong.",
	delimiter: "Auto detects the delimiter from the file content.",
	hasHeader: "Turn off if the first row already contains data.",
	decimal: "Used to read numbers, for example 0,625 with a comma.",
	listSeparator: "Splits the values of columns with the list type.",
	emptyCells: "Leave the property empty, or omit it from the note when the cell is empty.",
	precision: "Decimal places for numbers, 0 to 10. Leave empty to keep the source precision.",
	body: "Text of each note. Supports the same placeholders as the file name. May be empty.",
	tags: "Added to every note.",
	sourceLink: "Adds a property that links to the CSV file.",
	createBase: "Creates a .base file next to the target folder that shows the imported notes as a table. Existing base files are never changed.",
	adopt: "Off: notes in the target folder that this CSV did not create are never changed.",
} as const;

export const PRECISION_ERROR = "Enter a whole number from 0 to 10, or leave empty.";
export const PAGE_SIZE_ERROR = "Enter a whole number from 10 to 100000.";

export const OVERWRITE_CONFIRM = {
	title: "Replace whole notes?",
	message: "Replace whole note overwrites notes completely. Properties and text you added in Obsidian are lost. You can undo right after the import.",
	confirm: "Replace notes",
} as const;

export function delimiterLabel(d: string): string {
	switch (d) {
		case ",": return "comma";
		case ";": return "semicolon";
		case "\t": return "tab";
		case "|": return "pipe";
		default: return d;
	}
}

export const EXTRA_PROPERTIES_HELP =
	"Add properties to the imported notes that are not in the CSV. They are only written to the notes, the CSV file is not changed. The default value fills in new notes and empty properties on re-import; values you set in Obsidian are kept. Use {{uuid}} for a unique ID per note.";

export const ROW_FILTER_OPS: Record<RowFilterOp, string> = {
	equals: "equals",
	notEquals: "does not equal",
	contains: "contains",
	notContains: "does not contain",
	empty: "is empty",
	notEmpty: "is not empty",
	greaterThan: "is greater than",
	lessThan: "is less than",
};

export const DATE_ORDER_OPTIONS: Record<DateOrder, string> = {
	auto: "Detect (only when unambiguous)",
	dmy: "Day first (DD/MM/YYYY)",
	mdy: "Month first (MM/DD/YYYY)",
};

/**
 * Copy from docs/UI-SPEC.md section 8 ("Copy changes"). Views reference these instead of inline strings.
 * Functions take plain values so they stay trivially testable.
 */

/** Primary import button: "Import 7 rows" (was "Import 7 rows as notes"). */
export function importRowsLabel(count: number): string {
	return `Import ${count} ${count === 1 ? "row" : "rows"}`;
}

/** Drift callout text: "The CSV has new or missing columns: + Tage, − Kostenstelle." */
export function driftMessage(added: string[], removed: string[]): string {
	const parts = [...added.map((c) => `+ ${c}`), ...removed.map((c) => `\u2212 ${c}`)];
	return `The CSV has new or missing columns: ${parts.join(", ")}.`;
}
export const REVIEW_COLUMNS = "Review columns";

/** Column options (replaces the "Template…" pill). */
export const COLUMN_OPTIONS = "Options";
export const VALUE_TEMPLATE = "Value template";
export const IGNORE_UNITS = "Ignore units (\u20ac, %, kg)";

/** Dialog footer: "Save and import" becomes "Import now"; it also saves. */
export const IMPORT_NOW = "Import now";
export const SAVE = "Save";
export const CANCEL = "Cancel";
export const CONFIGURE = "Configure";
export const CLOSE = "Close";

/** Key matching. */
export const MATCH_NOTES_BY = "Match notes by";
export function suggestedKey(column: string): string {
	return `Suggested: ${column} (unique in every row)`;
}

/** Row filter. */
export const FILTER_ROWS = "Filter rows";
export const FILTER_ROWS_WHERE = "Import rows where";

/** Run list row: "timesheet 3.md \u00b7 row 3". Pass the file name only (see relPath() for folder-relative paths). */
export function runRowLabel(name: string, row: number): string {
	return `${name} \u00b7 row ${row}`;
}

/** Index empty state. The hint is the full sentence; the title is the heading above it. */
export const NO_IMPORTS_TITLE = "No imports yet";
export const NO_IMPORTS_HINT = "Open a CSV file and choose Import to set one up.";
export const NO_IMPORTS_YET = `${NO_IMPORTS_TITLE}. ${NO_IMPORTS_HINT}`;

/** Source link toggle (was "Add link to the CSV file" / "Add source link"). */
export const LINK_NOTES_TO_CSV = "Link notes to the CSV";

/** Other strings named in the spec (sections 3, 4, 5, 6). */
export const NO_ROWS = "This file has no rows.";
export function noRowsMatch(query: string): string {
	return `No rows match \u201c${query}\u201d`;
}
export const IMPORT_FINISHED = "Import finished";
export const IMPORT_BUTTON = "Import";
export const REIMPORT_BUTTON = "Re-import";
export const REIMPORT_ALL = "Re-import all";
export const CSV_MISSING = "CSV missing";
export const OPEN_CSV_IMPORTS = "Open CSV imports";
export const RESET_ALL_SETTINGS = "Reset all import settings\u2026";
/** Settings tab section headings (spec section 6). */
export const SETTINGS_HEADINGS = {
	reading: "Reading files",
	notes: "New notes",
	reimport: "Re-import",
	table: "Table view",
	imports: "Imports",
	danger: "Danger zone",
} as const;
/** Tab names of the import settings dialog (spec section 2). */
export const CONFIG_TABS = {
	columns: "Columns",
	notes: "Notes",
	reimport: "Re-import",
	file: "File & rows",
} as const;
