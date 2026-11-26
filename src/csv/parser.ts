import type { DelimiterOption, ParsedCsv } from "../types";
import { stripBom } from "./encoding";

type Delim = Exclude<DelimiterOption, "auto">;
const CANDIDATES: Delim[] = [",", ";", "\t", "|"];

/**
 * Split text into records. Quote-aware; accepts CRLF/LF/CR, and line breaks inside quoted fields become LF. Completely blank lines are skipped
 * (so trailing empty lines never produce rows). Stops after `maxRecords` records.
 */
function parseRecords(
	text: string,
	delimiter: string,
	maxRecords = Infinity,
	info?: { unterminatedAt: number },
): string[][] {
	const s = new RecordSplitter(text, delimiter);
	const n = text.length;
	for (let i = 0; i < n && s.records.length < maxRecords; i++) i = s.inQuotes ? s.quotedChar(i) : s.plainChar(i);
	if (s.inQuotes && info) info.unterminatedAt = s.quoteStartRecord;
	if (s.records.length < maxRecords && s.hasPendingRecord()) {
		s.endField();
		s.records.push(s.row);
	}
	return s.records;
}

/** The state of parseRecords while it walks the text. */
class RecordSplitter {
	readonly records: string[][] = [];
	row: string[] = [];
	inQuotes = false;
	/** Record index where the open quote started. */
	quoteStartRecord = -1;
	private field = "";
	/** The current field began with a quote. */
	private quoted = false;
	/** The current field has any content or quote. */
	private started = false;

	constructor(
		private readonly text: string,
		private readonly delimiter: string,
	) {}

	/**
	 * Inside quotes: `""` is a quote, a single `"` closes, and a line break (CRLF, CR or LF) becomes `\n`, as it is
	 * written to the note. Returns the index of the last character consumed.
	 */
	quotedChar(i: number): number {
		const ch = this.text[i];
		if (ch === "\r") {
			this.field += "\n";
			return this.text[i + 1] === "\n" ? i + 1 : i;
		}
		if (ch !== '"') this.field += ch;
		else if (this.text[i + 1] === '"') {
			this.field += '"';
			return i + 1;
		} else this.inQuotes = false;
		return i;
	}

	/** Outside quotes. Returns the index of the last character consumed. */
	plainChar(i: number): number {
		const ch = this.text[i];
		// A quote opens a quoted field at its start, also after spaces (`a, "b,c"`, as hand-written CSV often has).
		if (ch === '"' && this.atFieldStart()) {
			this.field = "";
			this.inQuotes = true;
			this.quoteStartRecord = this.records.length;
			this.quoted = true;
			this.started = true;
		} else if (ch === this.delimiter) {
			this.endField();
		} else if (ch === "\n" || ch === "\r") {
			this.endRow();
			if (ch === "\r" && this.text[i + 1] === "\n") return i + 1;
		} else {
			this.field += ch;
			this.started = true;
		}
		return i;
	}

	/** Nothing but spaces read in this field yet (a quote here opens a quoted field). */
	private atFieldStart(): boolean {
		return !this.started || (!this.quoted && /^[ ]+$/.test(this.field));
	}

	endField(): void {
		this.row.push(this.field);
		this.field = "";
		this.quoted = false;
		this.started = false;
	}

	private endRow(): void {
		if (this.row.length === 0 && !this.started && this.field === "") return; // blank line
		this.endField();
		this.records.push(this.row);
		this.row = [];
	}

	/** Text after the last line break that still forms a record. */
	hasPendingRecord(): boolean {
		return this.row.length > 0 || this.started || this.field !== "" || this.quoted;
	}
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
		const mode = modeFieldCount(rows);
		if (mode.count <= 1) continue;
		const score = mode.freq / rows.length;
		if (score > bestScore || (score === bestScore && mode.count > bestCount)) {
			best = d;
			bestScore = score;
			bestCount = mode.count;
		}
	}
	return best;
}

/** The most common number of fields per record (the larger one on a tie) and how many records have it. */
function modeFieldCount(rows: string[][]): { count: number; freq: number } {
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
	return { count: modeCount, freq: modeFreq };
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

	const headers = opts.hasHeader ? uniqueHeaders(records.shift() ?? []) : numberedHeaders(records);
	const { rows, rowNumbers, tooLong, blank } = fitRecords(records, headers.length);
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

/** "Column 1".."Column N" for the widest record (files without a header row). */
function numberedHeaders(records: string[][]): string[] {
	let width = 0;
	for (const r of records) if (r.length > width) width = r.length;
	return Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
}

/**
 * Data rows padded with "" / truncated to `w` values, with their 1-based record numbers. Records whose cells are
 * all blank are skipped and counted, as are the truncated ones.
 */
function fitRecords(records: string[][], w: number): { rows: string[][]; rowNumbers: number[]; tooLong: number; blank: number } {
	const rows: string[][] = [];
	const rowNumbers: number[] = [];
	let tooLong = 0;
	let blank = 0;
	for (let ri = 0; ri < records.length; ri++) {
		const r = records[ri];
		if (!r) continue;
		if (r.every((c) => (c ?? "").trim() === "")) {
			blank++;
			continue;
		}
		rowNumbers.push(ri + 1);
		if (r.length > w) tooLong++;
		rows.push(fitRow(r, w));
	}
	return { rows, rowNumbers, tooLong, blank };
}

function fitRow(r: string[], w: number): string[] {
	if (r.length === w) return r;
	if (r.length > w) return r.slice(0, w);
	return r.concat(new Array<string>(w - r.length).fill(""));
}
