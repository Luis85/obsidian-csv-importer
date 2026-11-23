import type { ColumnConfig, FileImportConfig, FrontmatterValue, ParsedCsv, PropertyType } from "../types";

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
		if (exp < 0) str = n.toFixed(Math.min(100, mantDigits - exp));
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
	`^${DATE_SRC}[T ](\\d{1,2}):(\\d{2})(?::(\\d{2})(?:[.,]\\d+)?)?\\s*(?:Z|[+-]\\d{2}(?::?\\d{2})?)?$`,
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
export function parseDateValue(raw: string): ParsedDate | null {
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

/**
 * Interpret a plain number as an Excel serial date (1900 date system incl. the Lotus leap-year bug:
 * serial 60 is the fake 1900-02-29, serials > 60 count from 1899-12-30). Fraction = time of day.
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
	let date: string;
	if (day === 60) date = "1900-02-29";
	else {
		const base = day < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
		const d = new Date(base + day * 86400000);
		date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
	}
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
 * Infer the property type of a column from its raw (string) values. Empty values are ignored.
 * Order: checkbox (true/false/yes/no), number, date, datetime, else text. `list` is never inferred.
 */
export function inferColumnType(values: string[], opts: InferenceOptions): PropertyType {
	const vals = values.map((v) => v.trim()).filter((v) => v !== "");
	if (vals.length === 0) return "text";
	if (vals.every((v) => parseBool(v) !== null)) return "checkbox";
	if (vals.every((v) => parseNumber(v, opts.decimalSeparator, true) !== null)) return "number";
	const dates = vals.map(parseDateValue);
	if (dates.every((d) => d !== null)) {
		const list = dates.filter((d): d is ParsedDate => d !== null);
		const anyTime = list.some((d) => d.kind === "datetime");
		if (!anyTime) return "date";
		if (opts.midnightAsDate && list.every((d) => d.kind === "date" || d.time === "00:00:00")) return "date";
		return "datetime";
	}
	return "text";
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
	return s === "" ? "property" : s;
}

function uniqueName(base: string, used: Set<string>): string {
	let name = base;
	let n = 2;
	while (used.has(name)) name = `${base} ${n++}`;
	used.add(name);
	return name;
}

function columnValues(parsed: ParsedCsv, index: number): string[] {
	return parsed.rows.map((r) => r[index] ?? "");
}

/** Build fresh column configs (inferred types, all included) for a parsed CSV. Property names are unique. */
export function buildColumnConfigs(parsed: ParsedCsv, opts: InferenceOptions): ColumnConfig[] {
	const used = new Set<string>();
	return parsed.headers.map((source, index) => ({
		source,
		index,
		property: uniqueName(toPropertyName(source), used),
		type: inferColumnType(columnValues(parsed, index), opts),
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
		if (c) used.add(c.property);
	}
	return parsed.headers.map((source, index) => {
		const c = bySource.get(source);
		if (c) return { ...c, index };
		return {
			source,
			index,
			property: uniqueName(toPropertyName(source), used),
			type: inferColumnType(columnValues(parsed, index), opts),
			include: true,
		};
	});
}

/**
 * Guess the decimal separator from the data: a column whose values all parse as numbers
 * with one separator but not with the other votes for that separator.
 * Returns null when the data gives no evidence either way.
 */
export function detectDecimalSeparator(parsed: ParsedCsv): "." | "," | null {
	let comma = 0;
	let dot = 0;
	for (let c = 0; c < parsed.headers.length; c++) {
		const vals = parsed.rows.map((r) => (r[c] ?? "").trim()).filter((v) => v !== "");
		if (vals.length === 0) continue;
		const asDot = vals.every((v) => parseNumber(v, ".", true) !== null);
		const asComma = vals.every((v) => parseNumber(v, ",", true) !== null);
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
	config.columns = reconcileColumns(config.columns, parsed, {
		decimalSeparator: config.decimalSeparator,
		midnightAsDate,
		listSeparator: config.listSeparator,
	});
	return config;
}

/**
 * Compare saved column sources with the current headers. `added`: headers without a saved column;
 * `removed`: saved column sources no longer in the file. Both empty when `columns` is empty (not configured yet).
 */
export function detectHeaderDrift(columns: ColumnConfig[], parsed: ParsedCsv): { added: string[]; removed: string[] } {
	if (columns.length === 0) return { added: [], removed: [] };
	const saved = new Set(columns.map((c) => c.source));
	const current = new Set(parsed.headers);
	return {
		added: parsed.headers.filter((h) => !saved.has(h)),
		removed: columns.map((c) => c.source).filter((s) => !current.has(s)),
	};
}
