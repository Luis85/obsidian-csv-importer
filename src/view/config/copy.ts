/** Strings of the import settings dialog that are not (yet) in the shared labels. */

/** Tab names, in the order the dialog shows them. The ids are stable (tests and other views open tabs by id). */
export const TAB_LABELS = {
	columns: "Properties",
	notes: "Notes",
	rows: "Rows",
	reimport: "Re-import",
	file: "File format",
} as const;
export type ConfigTabId = keyof typeof TAB_LABELS;

export const COLUMNS_HELP = "Choose which CSV columns become note properties, and their names and types.";
export const EXTRA_PROPERTIES = "Extra properties";
export const EXTRA_PROPERTIES_DESC = "Properties that are not columns, such as status or an ID. Written to the notes only, the CSV is not changed.";
export const EXTRA_DEFAULT_HELP = "Fills new notes and empty properties. Values you set in Obsidian are kept.";
export const VALUES = "Values";
export const VALUES_DESC = "How cell values are written into the properties.";
export const ROWS_FILTER_DESC = "Rows that do not match are left out of the preview and the import.";
export const ADOPT_NAME = "Update notes not created by this import";
export const PARSE_ERROR_HINT = "Try another delimiter or encoding on the File format tab.";
export const REDETECT_TYPES = "Re-detect types";
export const NEW_PROPERTY = "New property";
export const ADD_PROPERTY = "Add property";
export const ADD_EMPTY_PROPERTY = "Empty property";
export const ADD_ID_PROPERTY = "ID (unique per note)";
export const PREVIEW = "Preview";
export const PREVIEW_TOGGLE_TITLE = "Show the note preview instead of the settings";
export const SUMMARY_LABEL = "Summary of the import settings";
export const REVIEW_FILE_SETTINGS = "Review file settings";
export const TAB_CHANGED = "changed from default";
/** Summary part when no key is set: notes are matched by their file name. */
export const KEY_NONE = "matched by file name";
export function keySummary(columns: string[]): string {
	return `matched by ${columns.join(" + ")}`;
}
export const KEY_PROPERTY = "Key property";
export const NO_COLUMNS = "No columns found.";
export const SAMPLE_HEADER = "Sample";

export function keyExample(values: string[]): string {
	return `Example: ${values.join(" | ")}`;
}

export function rowOfFiltered(row: number, total: number, filtered: boolean): string {
	return `Row ${row} of ${total}${filtered ? " (filtered)" : ""}`;
}

export function filterCount(matching: number, total: number): string {
	return `${matching} of ${total} rows match.`;
}

export function filteredSummary(matching: number, total: number): string {
	return `filter: ${matching} of ${total} rows`;
}

export const NO_ROWS_MATCH_FILTER = "No rows match the filter.";
export const KEY_SUGGESTED = "suggested";
export const KEY_HAS_DUPLICATES = "has duplicates";
export const KEY_HAS_EMPTY = "has empty cells";
export function useKey(column: string): string {
	return `Use ${column}`;
}
export const OPTIONS_OPEN = "Show options";
export const OPTIONS_CLOSE = "Hide options";
export const RESULT = "Result";
export const FILE_NAME_DESC = "Use {{Column name}} for cell values, {{row}} for the row number and {{file}} for the CSV name. The note body is set below.";
