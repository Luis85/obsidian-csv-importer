import type { ImportResult, NoteOutcome, RowFilter } from "../types";
import { IMPORT_SETTINGS, OPEN_BASE, ROW_FILTER_OPS, UNDO_LAST_IMPORT } from "./labels";

/** Shared names (UX review, vocabulary), re-exported for the table view and the run dialog. */
export { IMPORT_SETTINGS, OPEN_BASE, UNDO_LAST_IMPORT };

/** Copy owned by the table view and the import run dialog (UI-SPEC sections 3 and 4). */

/** Header action of the table view. */
export const IMPORT_ACTION = "Import";
/** Status line link; its tooltip and aria-label say the full name. */
export const UNDO = "Undo";
export const MORE_ACTIONS = "More actions";
/** Tooltip of the header checkbox: says what row selection is for. */
export const SELECT_ROWS_HINT = "Select rows to import only those";
export const FILTER_PLACEHOLDER = "Filter rows…";
export const FILTER_LABEL = "Filter rows in all columns";
export const SHOW_MORE = "Show more";

/** Shown instead of "Show more" once the table holds MAX_SHOWN_ROWS rows. */
export function shownRowsCap(shown: number, total: number): string {
	return `Showing the first ${shown.toLocaleString()} of ${total.toLocaleString()} rows. Use the filter to find other rows; the import always includes every row.`;
}
export const CLEAR_SELECTION = "Clear selection";
export const CHANGED_SINCE_IMPORT = "Changed since last import";
export const RE_IMPORT = "Re-import";

/** Primary button while rows are selected: "Import 3 selected rows". */
export function importSelectedLabel(n: number): string {
	return `Import ${n} selected ${n === 1 ? "row" : "rows"}`;
}

/** Status line while rows are selected: "3 rows selected". */
export function selectedCount(n: number): string {
	return `${n} ${n === 1 ? "row" : "rows"} selected`;
}

export function selectRowLabel(n: number): string {
	return `Select row ${n}`;
}

export const FIRST_IMPORT_TITLE = "Ready to import";
const COLUMNS_CHANGED_TITLE = "Columns changed";

/** Callout title for several unrelated issues: "2 things to check". */
export function thingsToCheck(n: number): string {
	return `${n} ${n === 1 ? "thing" : "things"} to check`;
}

/** Titles for the warnings the parser and the importer produce, matched by their wording. */
const WARNING_TITLES: [RegExp, string][] = [
	[/^The CSV has new or missing columns/, COLUMNS_CHANGED_TITLE],
	[/^Unterminated quote/, "Unclosed quote in the file"],
	[/more values than the header/, "Rows with extra values"],
	[/blank rows? (was|were) skipped/, "Blank rows skipped"],
	[/^No key column/, "Notes are matched by file name"],
	[/share[s]? a key with another row/, "Duplicate keys in the CSV"],
	[/share[s]? a key with another note/, "Duplicate notes in the target folder"],
	[/^This import creates or updates \d+ notes/, "Large import"],
	[/^Row filter:/, "Row filter is on"],
	[/^Extra property .* is ignored/, "Extra property ignored"],
	[/^Some notes were skipped because this import did not create them/, "Notes not created by this import"],
	[/too large to undo completely/, "Undo is incomplete"],
	[/import history could not be saved/, "Import history not saved"],
];

/** The title that names one warning; a generic one for wording this list does not know. */
export function warningTitle(text: string): string {
	for (const [re, title] of WARNING_TITLES) if (re.test(text)) return title;
	return "Check before importing";
}

/**
 * Title of a callout that lists `items`: the title of the one kind of issue when they are all the same kind,
 * otherwise "N things to check". UX review finding 2.
 */
export function calloutTitle(items: string[]): string {
	const titles = new Set(items.map(warningTitle));
	const [only] = titles;
	return titles.size === 1 && only ? only : thingsToCheck(items.length);
}
export const ROW_FILTER_TITLE = "Row filter";
export const READ_ERROR_TITLE = "Could not read this file";
export const CHECK_DELIMITER = "Try another delimiter or encoding in the import settings.";

export function firstImportItems(folder: string): string[] {
	return [
		`Notes will be created in ${folder || "a folder next to this file"}.`,
		"Column types were detected automatically. Click a type to change it.",
	];
}

/** "Importing 4 of 6 rows (Rolle equals Softwareentwickler)". */
export function filterBullet(imported: number, total: number, f: RowFilter): string {
	const needsValue = f.op !== "empty" && f.op !== "notEmpty";
	const cond = `${f.column} ${ROW_FILTER_OPS[f.op]}${needsValue ? ` ${f.value}` : ""}`;
	return `Importing ${imported} of ${total} ${total === 1 ? "row" : "rows"} (${cond})`;
}

export function importedAgo(rel: string): string {
	return `Imported ${rel}`;
}

export function filterMatchCount(shown: number, total: number): string {
	return `${shown} of ${total} rows match`;
}

// --- run dialog ---

export const PREVIEW_TITLE = "Import preview";
export const IMPORTING_TITLE = "Importing";
export const CHECKING_ROWS = "Checking rows…";
export const STOP_IMPORT = "Stop import";
export const OPEN_FIRST_NOTE = "Open first note";
export const SAVE_REPORT = "Save report as note";
export const UNDO_IMPORT = UNDO_LAST_IMPORT;
export const NOTHING_TO_CHANGE = "Nothing to change.";
export const NO_DATA_ROWS = "The file has no data rows.";

export const OUTCOME_ORDER: NoteOutcome[] = ["failed", "skipped", "created", "updated", "unchanged"];
export const OUTCOME_LABEL: Record<NoteOutcome, string> = {
	created: "New",
	updated: "Updated",
	unchanged: "Unchanged",
	skipped: "Skipped",
	failed: "Failed",
};

export function targetLine(folder: string): string {
	return `→ ${folder.replace(/\/+$/, "")}/`;
}

/** "2 new · 2 updated · 1 unchanged · 2 skipped · 1 failed", zero counts left out. */
export function countsLine(r: ImportResult): string {
	const parts: [number, string][] = [
		[r.created, "new"],
		[r.updated, "updated"],
		[r.unchanged, "unchanged"],
		[r.skipped, "skipped"],
		[r.failed, "failed"],
	];
	const text = parts.filter(([n]) => n > 0).map(([n, l]) => `${n} ${l}`).join(" · ");
	return text || "Nothing to import";
}

function notes(n: number): string {
	return `${n} ${n === 1 ? "note" : "notes"}`;
}

function folderSuffix(folder: string): string {
	const f = folder.replace(/\/+$/, "");
	return f ? ` to ${f}/` : "";
}

/**
 * One-sentence headline above the counts (UX review finding 15).
 * Preview: "4 notes will be written to Data/timesheet/. 3 rows need attention."
 * Done: "4 notes written to Data/timesheet/. 3 rows need attention."
 * `written` is the number of new and updated notes (in the preview: the ones still checked).
 */
export function runHeadline(phase: "preview" | "done" | "stopped", written: number, attention: number, folder: string): string {
	let first: string;
	if (written === 0) first = phase === "preview" ? "No notes will be written." : "No notes were written.";
	else if (phase === "preview") first = `${notes(written)} will be written${folderSuffix(folder)}.`;
	else first = `${notes(written)} written${folderSuffix(folder)}${phase === "stopped" ? " before the import was stopped" : ""}.`;
	if (attention <= 0) return first;
	return `${first} ${attention} ${attention === 1 ? "row needs" : "rows need"} attention.`;
}

export function moreRows(n: number): string {
	return `…and ${n} more rows.`;
}

/** Preview button: "Import 6 notes", or "Import 4 of 6 notes" when some are unchecked; plain "Import" with none. */
export function previewImportLabel(n: number, total: number = n): string {
	if (n <= 0) return "Import";
	if (n < total) return `Import ${n} of ${total} ${total === 1 ? "note" : "notes"}`;
	return `Import ${n} ${n === 1 ? "note" : "notes"}`;
}

export function selectGroupLabel(name: string, count: number): string {
	return `Include all ${count} ${name.toLowerCase()} notes in the import`;
}

export function selectNoteLabel(row: number): string {
	return `Include row ${row} in the import`;
}

export function rowsProgress(done: number, total: number): string {
	return `${done} of ${total} rows`;
}

export const STOPPING = "Stopping after the current row…";
export const STARTING = "Starting…";
