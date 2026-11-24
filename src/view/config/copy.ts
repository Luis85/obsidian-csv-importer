/** Strings of the import settings dialog that are not (yet) in the shared labels. */

export const COLUMNS_HELP = "Choose which CSV columns become note properties.";
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
export const KEY_NONE = "no key";
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
export const UNIQUE_IN_EVERY_ROW = "unique in every row";
export const OPTIONS_OPEN = "Show options";
export const OPTIONS_CLOSE = "Hide options";
export const RESULT = "Result";
export const FILE_NAME_DESC = "Use {{Column name}} for cell values, {{row}} for the row number and {{file}} for the CSV name. The note body is set below.";
