import type { ColumnConfig, ParsedCsv } from "../../types";
import { suggestKeyColumn } from "../../csv/typeInference";

/** Columns with an average value longer than this are free text, never a good key. */
const MAX_AVG_KEY_LENGTH = 30;

function averageLength(parsed: ParsedCsv, col: ColumnConfig): number {
	if (parsed.rows.length === 0) return 0;
	let total = 0;
	for (const r of parsed.rows) total += (r[col.index] ?? "").trim().length;
	return total / parsed.rows.length;
}

/** True when the column has a different, non-empty value in every row. */
export function isUniqueColumn(parsed: ParsedCsv, col: ColumnConfig): boolean {
	if (parsed.rows.length === 0) return false;
	const seen = new Set<string>();
	for (const r of parsed.rows) {
		const v = (r[col.index] ?? "").trim();
		if (v === "" || seen.has(v)) return false;
		seen.add(v);
	}
	return true;
}

/** Key suggestion that never picks a long free-text column: only short columns are offered to the core check. */
export function suggestShortKey(parsed: ParsedCsv, columns: ColumnConfig[]): string | null {
	const short = columns.filter((c) => averageLength(parsed, c) <= MAX_AVG_KEY_LENGTH);
	return suggestKeyColumn(parsed, short);
}
