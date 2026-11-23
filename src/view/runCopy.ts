import type { ImportResult, NoteOutcome, RowFilter } from "../types";
import { ROW_FILTER_OPS } from "./labels";

/** Copy owned by the table view and the import run dialog (UI-SPEC sections 3 and 4). */

export const CONFIGURE_IMPORT = "Configure";
export const UNDO = "Undo";
export const MORE_ACTIONS = "More actions";
export const FILTER_PLACEHOLDER = "Filter rows…";
export const FILTER_LABEL = "Filter rows in all columns";
export const SHOW_MORE = "Show more";

export const FIRST_IMPORT_TITLE = "Ready to import";
export const COLUMNS_CHANGED_TITLE = "Columns changed";
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
export const CANCEL = "Cancel";
export const OPEN_BASE = "Open base";
export const OPEN_FIRST_NOTE = "Open first note";
export const SAVE_REPORT = "Save report as note";
export const UNDO_IMPORT = "Undo import";
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

export function moreRows(n: number): string {
	return `…and ${n} more rows.`;
}

export function previewImportLabel(n: number): string {
	return n > 0 ? `Import ${n} ${n === 1 ? "note" : "notes"}` : "Import";
}

export function rowsProgress(done: number, total: number): string {
	return `${done} of ${total} rows`;
}

export const STOPPING = "Stopping after the current row…";
export const STARTING = "Starting…";
