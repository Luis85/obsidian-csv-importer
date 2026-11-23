import type { ColumnConfig, FileImportConfig, FrontmatterValue, HeaderDrift, ParsedCsv, PropertyType } from "../types";

export interface InferenceOptions {
	decimalSeparator: "." | ",";
	/** Infer `date` instead of `datetime` when all times are 00:00(:00). */
	midnightAsDate: boolean;
	listSeparator: string;
}

export interface ConversionOptions {
	decimalSeparator: "." | ",";
	listSeparator: string;
	/** Round numbers to this many decimals (trailing zeros stripped). null/undefined keeps the source precision. */
	precision?: number | null;
}

/** Conversion options derived from a file's import config. */
export function conversionOptionsOf(cfg: FileImportConfig): ConversionOptions {
	return { decimalSeparator: cfg.decimalSeparator, listSeparator: cfg.listSeparator, precision: cfg.numberPrecision };
}

/** Inference options derived from a file's import config. */
export function inferenceOptionsOf(cfg: FileImportConfig, midnightAsDate: boolean): InferenceOptions {
	return { decimalSeparator: cfg.decimalSeparator, midnightAsDate, listSeparator: cfg.listSeparator };
}

/**
 * Format a number as the shortest decimal string that round-trips (never exponent notation),
 * optionally rounded to `precision` decimals with trailing zeros stripped.
 */
export function formatNumber(n: number, precision?: number | null): string {
	if (!Number.isFinite(n)) return "";
	if (precision !== null && precision !== undefined && precision >= 0) {
		const p = Math.min(Math.floor(precision), 100);
		const fixed = Math.abs(n) < 1e21 ? n.toFixed(p) : String(n);
		if (!fixed.includes("e")) {
			const out = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
			return out === "-0" || out === "" ? "0" : out;
		}
	}
	let str = String(n);
	const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(str);
	if (m) {
		const exp = Number(m[4]);
		const mantDigits = (m[3] ?? "").length;
		if (exp < 0 && mantDigits - exp > 100) {
			// Too small for toFixed (would round to 0): keep exponent form, always with a decimal point (YAML float).
			str = `${m[1]}${m[2]}.${m[3] ?? "0"}e${m[4]}`;
		} else if (exp < 0) str = n.toFixed(mantDigits - exp);
		else str = (m[1] + m[2] + (m[3] ?? "")).padEnd(m[1].length + 1 + exp, "0");
	}
	return str === "-0" ? "0" : str;
}

// ---------------------------------------------------------------- numbers

/**
 * Parse a number honoring the decimal separator. Thousands grouping (the other separator, groups of 3)
 * is accepted. In `strict` mode (used for inference) values with leading zeros ("007") or more than
 * 15 significant digits (IDs, phone numbers) are rejected so they stay text.
 */
export function parseNumber(raw: string, decimalSeparator: "." | ",", strict = false): number | null {
	const s = raw.trim();
	if (s === "") return null;
	const thousands = decimalSeparator === "." ? "\\," : "\\.";
	const decimal = decimalSeparator === "." ? "\\." : ",";
	const re = new RegExp(
		`^([+-]?)([1-9]\\d{0,2}(?:${thousands}\\d{3})+|\\d+)?(?:${decimal}(\\d+))?(?:[eE]([+-]?\\d+))?$`,
	);
	const m = re.exec(s);
	if (!m) return null;
	const [, sign, intPart, frac, exp] = m;
	if (intPart === undefined && frac === undefined) return null;
	const intDigits = (intPart ?? "").replace(/[.,]/g, "");
	if (strict) {
		if (sign === "+" || exp !== undefined) return null;
		if (intDigits.length > 1 && intDigits.startsWith("0")) return null;
		if (intDigits.length + (frac?.length ?? 0) > 15) return null;
	}
	const normalized = `${sign}${intDigits || "0"}${frac ? "." + frac : ""}${exp ? "e" + exp : ""}`;
	const n = Number(normalized);
	return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- dates

export interface ParsedDate {
	kind: "date" | "datetime";
	/** YYYY-MM-DD */
	date: string;
	/** HH:mm:ss (datetime only) */
	time?: string;
}

const DATE_RE = /^(?:(\d{4})-(\d{2})-(\d{2})|(\d{4})\/(\d{2})\/(\d{2})|(\d{2})\.(\d{2})\.(\d{4}))$/;
const DATE_SRC = "(\\d{4}-\\d{2}-\\d{2}|\\d{4}/\\d{2}/\\d{2}|\\d{2}\\.\\d{2}\\.\\d{4})";
const DATETIME_RE = new RegExp(
	`^${DATE_SRC}[T ](\\d{1,2}):(\\d{2})(?::(\\d{2})(?:[.,]\\d+)?)?\\s*(Z|[+-]\\d{2}(?::?\\d{2})?)?$`,
);

function pad(n: number | string, len = 2): string {
	return String(n).padStart(len, "0");
}

function parseDatePart(s: string): string | null {
	const m = DATE_RE.exec(s);
	if (!m) return null;
	let y: number, mo: number, d: number;
	if (m[1]) [y, mo, d] = [+m[1], +m[2], +m[3]];
	else if (m[4]) [y, mo, d] = [+m[4], +m[5], +m[6]];
	else [y, mo, d] = [+m[9], +m[8], +m[7]];
	if (mo < 1 || mo > 12 || d < 1) return null;
	const dim = new Date(Date.UTC(2000, mo, 0)).getUTCDate(); // days in month for leap year 2000
	const days = mo === 2 && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 28 : dim;
	if (d > days) return null;
	return `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
}

/** Recognize a date or datetime string. Timezone and fractional seconds are dropped. */
function parseDateValue(raw: string): ParsedDate | null {
	const s = raw.trim();
	const date = parseDatePart(s);
	if (date) return { kind: "date", date };
	const m = DATETIME_RE.exec(s);
	if (!m) return null;
	const d = parseDatePart(m[1]);
	if (!d) return null;
	const h = +m[2];
	const mi = +m[3];
	const sec = m[4] === undefined ? 0 : +m[4];
	if (h > 23 || mi > 59 || sec > 59) return null;
	return { kind: "datetime", date: d, time: `${pad(h)}:${pad(mi)}:${pad(sec)}` };
}

/** True when at least one value is a datetime carrying a `Z` / UTC-offset suffix (which conversion drops). */
export function hasTimezoneOffsets(values: string[]): boolean {
	for (const v of values) {
		const m = DATETIME_RE.exec(v.trim());
		if (m && m[5] !== undefined && parseDatePart(m[1]) !== null) return true;
	}
	return false;
}

/**
 * Interpret a plain number as an Excel serial date (1900 date system incl. the Lotus leap-year bug:
 * serial 60 is the fake 1900-02-29 and is rejected, serials > 60 count from 1899-12-30). Fraction = time of day.
 * Range 1..2958465. Never used for inference.
 */
export function parseExcelSerial(raw: string, decimalSeparator: "." | ","): ParsedDate | null {
	const t = raw.trim();
	if (!/^\d+(?:[.,]\d+)?$/.test(t)) return null;
	const n = parseNumber(t, decimalSeparator, false);
	if (n === null || n < 1 || n > 2958465) return null;
	let day = Math.floor(n);
	let secs = Math.round((n - day) * 86400);
	if (secs >= 86400) {
		day += 1;
		secs -= 86400;
	}
	if (day === 60) return null; // fake 1900-02-29 (Lotus bug): not a real date
	const base = day < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
	const dt = new Date(base + day * 86400000);
	const date = `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
	if (secs === 0) return { kind: "date", date };
	return { kind: "datetime", date, time: `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}` };
}

// ---------------------------------------------------------------- checkbox

const TRUE_WORDS = new Set(["true", "yes"]);
const FALSE_WORDS = new Set(["false", "no"]);

function parseBool(raw: string): boolean | null {
	const s = raw.trim().toLowerCase();
	if (TRUE_WORDS.has(s)) return true;
	if (FALSE_WORDS.has(s)) return false;
	return null;
}

// ---------------------------------------------------------------- API

/**
 * Single pass over `count` values (via `get`) deciding the column type. Empty values are ignored.
 * Order: checkbox, number, date, datetime, else text.
 */
function inferFrom(count: number, get: (i: number) => string, opts: InferenceOptions): PropertyType {
	let n = 0;
	let allBool = true;
	let anyNotNo = false;
	let allNum = true;
	let allDate = true;
	let anyTime = false;
	let allMidnight = true;
	for (let i = 0; i < count; i++) {
		const v = get(i).trim();
		if (v === "") continue;
		n++;
		if (allBool) {
			if (parseBool(v) === null) allBool = false;
			else if (v !== "no" && v !== "No" && v !== "NO") anyNotNo = true;
		}
		if (allNum && parseNumber(v, opts.decimalSeparator, true) === null) allNum = false;
		if (allDate) {
			const d = parseDateValue(v);
			if (d === null) allDate = false;
			else if (d.kind === "datetime") {
				anyTime = true;
				if (d.time !== "00:00:00") allMidnight = false;
			}
		}
		if (!allBool && !allNum && !allDate) return "text";
	}
	if (n === 0) return "text";
	// A column of only bare "no" is far more likely a text/word column than a checkbox.
	if (allBool && anyNotNo) return "checkbox";
	if (allNum) return "number";
	if (allDate) {
		if (!anyTime) return "date";
		if (opts.midnightAsDate && allMidnight) return "date";
		return "datetime";
	}
	return "text";
}

/**
 * Infer the property type of a column from its raw (string) values. Empty values are ignored.
 * Order: checkbox (true/false/yes/no), number, date, datetime, else text. `list` is never inferred.
 * Strict: "+49..." and exponents ("1e5") are text; a column of only bare "no" is text.
 */
export function inferColumnType(values: string[], opts: InferenceOptions): PropertyType {
	return inferFrom(values.length, (i) => values[i], opts);
}

function inferColumn(parsed: ParsedCsv, index: number, opts: InferenceOptions): PropertyType {
	const rows = parsed.rows;
	return inferFrom(rows.length, (i) => rows[i][index] ?? "", opts);
}

/**
 * Convert a raw cell to a typed frontmatter value.
 * Empty -> null. Never throws: a non-empty value that cannot be parsed as `type` falls back to the
 * trimmed raw string. Output: number -> number, checkbox -> boolean, date -> "YYYY-MM-DD",
 * datetime -> "YYYY-MM-DDTHH:mm:ss", list -> string[] (null when no items), text -> trimmed string.
 */
export function convertValue(raw: string, type: PropertyType, opts: ConversionOptions): FrontmatterValue {
	const t = (raw ?? "").trim();
	if (t === "") return null;
	switch (type) {
		case "number": {
			const n = parseNumber(t, opts.decimalSeparator, false);
			if (n === null) return t;
			const p = opts.precision;
			return p !== null && p !== undefined ? Number(formatNumber(n, p)) : n;
		}
		case "checkbox": {
			const b = parseBool(t);
			return b === null ? t : b;
		}
		case "date": {
			const d = parseDateValue(t) ?? parseExcelSerial(t, opts.decimalSeparator);
			return d ? d.date : t;
		}
		case "datetime": {
			const d = parseDateValue(t) ?? parseExcelSerial(t, opts.decimalSeparator);
			return d ? `${d.date}T${d.time ?? "00:00:00"}` : t;
		}
		case "list": {
			const sep = opts.listSeparator;
			const items = (sep ? t.split(sep) : [t]).map((x) => x.trim()).filter((x) => x !== "");
			return items.length > 0 ? items : null;
		}
		default:
			return t;
	}
}

/** Turn a header into a safe property name (trimmed, whitespace collapsed, no YAML-hostile chars, non-empty). */
export function toPropertyName(header: string): string {
	let s = (header ?? "")
		// eslint-disable-next-line no-control-regex -- stripping control characters is intended
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/[#[\]{},]/g, "")
		.replace(/:(?=\s|$)/g, "")
		.replace(/\s+/g, " ")
		.trim();
	// strip leading indicator characters
	s = s.replace(/^[-?:!&*|>'"%@`\s]+/, "").trim();
	if (s.length > 200) {
		let cut = 200;
		const c = s.charCodeAt(cut - 1);
		if (c >= 0xd800 && c <= 0xdbff) cut--; // do not split a surrogate pair
		s = s.slice(0, cut).trim();
	}
	return s === "" ? "property" : s;
}

/** `used` holds lower-cased names: property names are unique case-insensitively ("Name" vs "name" -> "name 2"). */
function uniqueName(base: string, used: Set<string>): string {
	let name = base;
	let n = 2;
	while (used.has(name.toLowerCase())) name = `${base} ${n++}`;
	used.add(name.toLowerCase());
	return name;
}

/** Build fresh column configs (inferred types, all included) for a parsed CSV. Property names are unique. */
export function buildColumnConfigs(parsed: ParsedCsv, opts: InferenceOptions): ColumnConfig[] {
	const used = new Set<string>();
	return parsed.headers.map((source, index) => ({
		source,
		index,
		property: uniqueName(toPropertyName(source), used),
		type: inferColumn(parsed, index, opts),
		include: true,
	}));
}

/**
 * Merge previously saved column configs with the current file structure:
 * columns matched by `source` header keep user choices (property/type/include) and get the new index;
 * new columns are inferred; columns no longer present are dropped. Result is ordered by index.
 */
export function reconcileColumns(existing: ColumnConfig[], parsed: ParsedCsv, opts: InferenceOptions): ColumnConfig[] {
	const bySource = new Map<string, ColumnConfig>();
	for (const c of existing) if (!bySource.has(c.source)) bySource.set(c.source, c);
	const used = new Set<string>();
	for (const h of parsed.headers) {
		const c = bySource.get(h);
		if (c) used.add(c.property.toLowerCase());
	}
	return parsed.headers.map((source, index) => {
		const c = bySource.get(source);
		if (c) return { ...c, index };
		return {
			source,
			index,
			property: uniqueName(toPropertyName(source), used),
			type: inferColumn(parsed, index, opts),
			include: true,
		};
	});
}

/**
 * Guess the decimal separator from the data: a column whose values all parse as numbers
 * with one separator but not with the other votes for that separator.
 * Returns null when the data gives no evidence either way.
 */
function detectDecimalSeparator(parsed: ParsedCsv): "." | "," | null {
	let comma = 0;
	let dot = 0;
	for (let c = 0; c < parsed.headers.length; c++) {
		let seen = false;
		let asDot = true;
		let asComma = true;
		for (const r of parsed.rows) {
			const v = (r[c] ?? "").trim();
			if (v === "") continue;
			seen = true;
			if (asDot && parseNumber(v, ".", true) === null) asDot = false;
			if (asComma && parseNumber(v, ",", true) === null) asComma = false;
			if (!asDot && !asComma) break;
		}
		if (!seen) continue;
		if (asComma && !asDot) comma++;
		else if (asDot && !asComma) dot++;
	}
	if (comma > dot) return ",";
	if (dot > comma) return ".";
	return null;
}

/**
 * Bring a config in line with the current file content: for a file that was never configured
 * (no columns yet) the decimal separator is detected from the data; then columns are reconciled.
 * Mutates and returns `config`.
 */
export function prepareConfig(
	config: FileImportConfig,
	parsed: ParsedCsv,
	midnightAsDate: boolean,
): FileImportConfig {
	if (config.columns.length === 0) {
		config.decimalSeparator = detectDecimalSeparator(parsed) ?? config.decimalSeparator;
	}
	config.columns = reconcileColumns(config.columns, parsed, inferenceOptionsOf(config, midnightAsDate));
	return config;
}

/**
 * Compare saved column sources with the current headers. `added`: headers without a saved column;
 * `removed`: saved column sources no longer in the file. Both empty when `columns` is empty (not configured yet).
 */
export function detectHeaderDrift(columns: ColumnConfig[], parsed: ParsedCsv): HeaderDrift {
	if (columns.length === 0) return { added: [], removed: [] };
	const saved = new Set(columns.map((c) => c.source));
	const current = new Set(parsed.headers);
	return {
		added: parsed.headers.filter((h) => !saved.has(h)),
		removed: columns.map((c) => c.source).filter((s) => !current.has(s)),
	};
}

const ID_NAME_RE = /^(?:id|key|uuid|nr|no|nummer|number|code)$/i;

/**
 * Suggest a column to use as the note key: the first included column whose values are non-empty in every row
 * and unique (case-sensitive, trimmed). Id-like headers (id, key, uuid, nr, no, nummer, number, code, or ending
 * in "id") are preferred; number/date/checkbox/list columns are only considered when named like an id.
 * Returns the column's `source` or null.
 */
export function suggestKeyColumn(parsed: ParsedCsv, columns: ColumnConfig[]): string | null {
	if (parsed.rows.length === 0) return null;
	let fallback: string | null = null;
	for (const col of columns) {
		if (!col.include) continue;
		const idLike = ID_NAME_RE.test(col.source.trim()) || /id$/i.test(col.source.trim());
		if (!idLike && col.type !== "text") continue;
		const seen = new Set<string>();
		let ok = true;
		for (const r of parsed.rows) {
			const v = (r[col.index] ?? "").trim();
			if (v === "" || seen.has(v)) {
				ok = false;
				break;
			}
			seen.add(v);
		}
		if (!ok) continue;
		if (idLike) return col.source;
		fallback ??= col.source;
	}
	return fallback;
}
