import type { DelimiterOption, ParsedCsv } from "../types";
import { stripBom } from "./encoding";

type Delim = Exclude<DelimiterOption, "auto">;
const CANDIDATES: Delim[] = [",", ";", "\t", "|"];

/**
 * Split text into records. Quote-aware; accepts CRLF/LF/CR. Completely blank lines are skipped
 * (so trailing empty lines never produce rows). Stops after `maxRecords` records.
 */
function parseRecords(
	text: string,
	delimiter: string,
	maxRecords = Infinity,
	info?: { unterminatedAt: number },
): string[][] {
	let quoteStartRecord = -1;
	const records: string[][] = [];
	let row: string[] = [];
	let field = "";
	let inQuotes = false;
	let quoted = false; // current field began with a quote
	let started = false; // current field has any content/quote

	const endField = () => {
		row.push(field);
		field = "";
		quoted = false;
		started = false;
	};
	const endRow = () => {
		if (row.length === 0 && !started && field === "") {
			return; // blank line
		}
		endField();
		records.push(row);
		row = [];
	};

	const n = text.length;
	for (let i = 0; i < n && records.length < maxRecords; i++) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += ch;
			}
			continue;
		}
		if (ch === '"' && !started) {
			inQuotes = true;
			quoteStartRecord = records.length;
			quoted = true;
			started = true;
		} else if (ch === delimiter) {
			endField();
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && text[i + 1] === "\n") i++;
			endRow();
		} else {
			field += ch;
			started = true;
		}
	}
	if (inQuotes && info) info.unterminatedAt = quoteStartRecord;
	if (records.length < maxRecords && (row.length > 0 || started || field !== "" || quoted)) {
		endField();
		records.push(row);
	}
	return records;
}

/** Guess the delimiter by consistency of field counts across the first lines (quote-aware). Defaults to ",". */
export function detectDelimiter(text: string): Delim {
	text = stripBom(text, true);
	let best: Delim = ",";
	let bestScore = -1;
	let bestCount = 0;
	for (const d of CANDIDATES) {
		const rows = parseRecords(text, d, 20);
		if (rows.length === 0) continue;
		const freq = new Map<number, number>();
		for (const r of rows) freq.set(r.length, (freq.get(r.length) ?? 0) + 1);
		let modeCount = 0;
		let modeFreq = 0;
		for (const [count, f] of freq) {
			if (f > modeFreq || (f === modeFreq && count > modeCount)) {
				modeCount = count;
				modeFreq = f;
			}
		}
		if (modeCount <= 1) continue;
		const score = modeFreq / rows.length;
		if (score > bestScore || (score === bestScore && modeCount > bestCount)) {
			best = d;
			bestScore = score;
			bestCount = modeCount;
		}
	}
	return best;
}

function uniqueHeaders(raw: string[]): string[] {
	const used = new Set<string>();
	return raw.map((h, i) => {
		const base = h.replace(/\ufeff/g, "").trim() || `Column ${i + 1}`;
		let candidate = base;
		let n = 2;
		while (used.has(candidate)) candidate = `${base} ${n++}`;
		used.add(candidate);
		return candidate;
	});
}

/**
 * RFC 4180 parser: quoted fields, escaped quotes (""), embedded delimiters/newlines,
 * CRLF/LF/CR line endings, UTF-8 BOM stripped, blank lines ignored.
 * Headers are trimmed, made non-empty ("Column N") and unique ("Name", "Name 2").
 * Rows are padded with "" / truncated to the header count. Rows whose cells are all blank are skipped.
 * Non-fatal problems are reported in `warnings` (always an array).
 */
export function parseCsv(text: string, opts: { delimiter: DelimiterOption; hasHeader: boolean }): ParsedCsv {
	text = stripBom(text, true);
	const delimiter: Delim = opts.delimiter === "auto" ? detectDelimiter(text) : opts.delimiter;
	const info = { unterminatedAt: -1 };
	const records = parseRecords(text, delimiter, Infinity, info);
	const warnings: string[] = [];
	if (info.unterminatedAt >= 0) {
		const rowNo = opts.hasHeader ? info.unterminatedAt : info.unterminatedAt + 1;
		warnings.push(
			`Unterminated quote starting in row ${Math.max(rowNo, 1)}. The rest of the file was read as one value.`,
		);
	}

	let headers: string[];
	if (opts.hasHeader) {
		const first = records.shift();
		headers = uniqueHeaders(first ?? []);
	} else {
		let width = 0;
		for (const r of records) if (r.length > width) width = r.length;
		headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
	}
	const w = headers.length;
	const rows: string[][] = [];
	const rowNumbers: number[] = [];
	let tooLong = 0;
	let blank = 0;
	for (let ri = 0; ri < records.length; ri++) {
		const r = records[ri];
		if (!r) continue;
		let allBlank = true;
		for (let i = 0; i < r.length; i++) {
			if ((r[i] ?? "").trim() !== "") {
				allBlank = false;
				break;
			}
		}
		if (allBlank) {
			blank++;
			continue;
		}
		rowNumbers.push(ri + 1);
		if (r.length === w) rows.push(r);
		else if (r.length > w) {
			tooLong++;
			rows.push(r.slice(0, w));
		} else rows.push(r.concat(new Array<string>(w - r.length).fill("")));
	}
	if (tooLong > 0) {
		warnings.push(
			tooLong === 1
				? "1 row has more values than the header; extra values were ignored."
				: `${tooLong} rows have more values than the header; extra values were ignored.`,
		);
	}
	if (blank > 0) warnings.push(`${blank} blank ${blank === 1 ? "row was" : "rows were"} skipped.`);
	return { headers, rows, delimiter, warnings, rowNumbers };
}
