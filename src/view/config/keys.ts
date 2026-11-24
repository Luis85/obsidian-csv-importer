import type { ColumnConfig, ParsedCsv } from "../../types";
import { suggestKeyColumn } from "../../csv/typeInference";

/** Columns with an average value longer than this are free text, never a good key. */
const MAX_AVG_KEY_LENGTH = 30;

/** Column names that say "this is an identifier" (as in the core suggestion); their values may contain spaces. */
const ID_NAME_RE = /^(?:id|key|uuid|nr|no|nummer|number|code)$|id$/i;

function averageLength(parsed: ParsedCsv, col: ColumnConfig): number {
	if (parsed.rows.length === 0) return 0;
	let total = 0;
	for (const r of parsed.rows) total += (r[col.index] ?? "").trim().length;
	return total / parsed.rows.length;
}

/** Share (0 to 1) of the non-empty values that contain a space. */
function spacedShare(parsed: ParsedCsv, col: ColumnConfig): number {
	let filled = 0;
	let spaced = 0;
	for (const r of parsed.rows) {
		const v = (r[col.index] ?? "").trim();
		if (v === "") continue;
		filled++;
		if (/\s/.test(v)) spaced++;
	}
	return filled === 0 ? 0 : spaced / filled;
}

/** True when half or more of the non-empty values contain a space: words, not identifiers. */
function looksLikeWords(parsed: ParsedCsv, col: ColumnConfig): boolean {
	return spacedShare(parsed, col) >= 0.5;
}

/** How well a column identifies a row: every value different, some value repeated, or some cell empty. */
export type KeyColumnStatus = "unique" | "duplicates" | "empty";

export function keyColumnStatus(parsed: ParsedCsv, col: ColumnConfig): KeyColumnStatus {
	if (parsed.rows.length === 0) return "empty";
	const seen = new Set<string>();
	let duplicates = false;
	for (const r of parsed.rows) {
		const v = (r[col.index] ?? "").trim();
		if (v === "") return "empty";
		if (seen.has(v)) duplicates = true;
		seen.add(v);
	}
	return duplicates ? "duplicates" : "unique";
}

/**
 * Key suggestion that never picks free text: columns with an average value over 30 characters are left out, and
 * so are columns whose values are mostly several words, unless the column name says it is an ID.
 */
export function suggestShortKey(parsed: ParsedCsv, columns: ColumnConfig[]): string | null {
	const candidates = columns.filter((c) => {
		if (averageLength(parsed, c) > MAX_AVG_KEY_LENGTH) return false;
		return ID_NAME_RE.test(c.source.trim()) || !looksLikeWords(parsed, c);
	});
	// Code-like columns (no spaces, such as an ISBN) before columns with some words (such as a title).
	const ordered = candidates.map((c, i) => ({ c, i, share: spacedShare(parsed, c) })).sort((a, b) => a.share - b.share || a.i - b.i);
	return suggestKeyColumn(parsed, ordered.map((x) => x.c));
}
