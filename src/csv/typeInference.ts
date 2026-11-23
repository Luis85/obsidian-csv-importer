import type { ColumnConfig, DateOrder, FileImportConfig, FrontmatterValue, HeaderDrift, ParsedCsv, PropertyType } from "../types";

/** Capture group of a regex match; the patterns used here always set the groups read through this. */
function grp(m: RegExpExecArray, i: number): string {
	return m[i] ?? "";
}

export interface InferenceOptions {
	decimalSeparator: "." | ",";
	/** Infer `date` instead of `datetime` when all times are 00:00(:00). */
	midnightAsDate: boolean;
	listSeparator: string;
	/** How ambiguous slash dates are read (default "auto"). */
	dateOrder?: DateOrder;
}

export interface ConversionOptions {
	decimalSeparator: "." | ",";
	listSeparator: string;
	/** Round numbers to this many decimals (trailing zeros stripped). null/undefined keeps the source precision. */
	precision?: number | null;
	/** Number columns: strip currency symbols, percent signs and space thousands separators before parsing. */
	stripUnits?: boolean;
	/** How ambiguous slash dates are read (default "auto": per value, ambiguous values stay text). */
	dateOrder?: DateOrder;
}

/** Conversion options derived from a file's import config. */
export function conversionOptionsOf(cfg: FileImportConfig): ConversionOptions {
	return { decimalSeparator: cfg.decimalSeparator, listSeparator: cfg.listSeparator, precision: cfg.numberPrecision, dateOrder: cfg.dateOrder };
}

/** Inference options derived from a file's import config. */
export function inferenceOptionsOf(cfg: FileImportConfig, midnightAsDate: boolean): InferenceOptions {
	return { decimalSeparator: cfg.decimalSeparator, midnightAsDate, listSeparator: cfg.listSeparator, dateOrder: cfg.dateOrder };
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
		else str = (grp(m, 1) + grp(m, 2) + (m[3] ?? "")).padEnd(grp(m, 1).length + 1 + exp, "0");
	}
	return str === "-0" ? "0" : str;
}

// ---------------------------------------------------------------- numbers

const UNIT_WORDS_RE = /\b(?:CHF|EUR|USD|GBP)\b/gi;
const GROUPED_SPACES_RE = /^([+-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?=[.,]\d+$|$)/;

/** Remove currency symbols/codes, percent signs and space-like thousands separators from a numeric cell. */
export function stripNumberUnits(raw: string): string {
	let s = raw.replace(/[\u20ac$\u00a3\u00a5%]/g, "").replace(UNIT_WORDS_RE, "").trim();
	const g = GROUPED_SPACES_RE.exec(s);
	if (g) s = grp(g, 1).replace(/[ \u00a0\u202f]/g, "") + s.slice(grp(g, 1).length);
	return s.replace(/^([+-])\s+/, "$1");
}

/**
 * Parse a number honoring the decimal separator. Thousands grouping (the other separator, groups of 3)
 * is accepted. In `strict` mode (used for inference) values with leading zeros ("007") or more than
 * 15 significant digits (IDs, phone numbers) are rejected so they stay text.
 * With `stripUnits`, currency symbols/codes, "%" and space / NBSP / U+202F thousands separators are removed first.
 */
export function parseNumber(raw: string, decimalSeparator: "." | ",", strict = false, stripUnits = false): number | null {
	let s = raw.trim();
	if (stripUnits) s = stripNumberUnits(s);
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

/** "none": slash dates are rejected (ambiguous column). */
type SlashOrder = "dmy" | "mdy" | "auto" | "none";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YMD_SLASH_RE = /^(\d{4})\/(\d{2})\/(\d{2})$/;
const DOT_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const DASH_DMY_RE = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
const SLASH_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const NAME_DMY_RE = /^(\d{1,2})\.?\s+([A-Za-zÄäÖöÜü]+)\.?,?\s+(\d{4})$/;
const NAME_MDY_RE = /^([A-Za-zÄäÖöÜü]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/;
const DATETIME_RE = /^(.+?)[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/;

const MONTHS: Record<string, number> = {};
[
	["jan", "january", "januar", "jänner", "janner"],
	["feb", "february", "februar"],
	["mar", "march", "mär", "märz", "maerz", "marz"],
	["apr", "april"],
	["may", "mai"],
	["jun", "june", "juni"],
	["jul", "july", "juli"],
	["aug", "august"],
	["sep", "sept", "september"],
	["oct", "october", "okt", "oktober"],
	["nov", "november"],
	["dec", "december", "dez", "dezember"],
].forEach((names, i) => names.forEach((n) => (MONTHS[n] = i + 1)));

function pad(n: number | string, len = 2): string {
	return String(n).padStart(len, "0");
}

function ymd(y: number, mo: number, d: number): string | null {
	if (mo < 1 || mo > 12 || d < 1) return null;
	const dim = new Date(Date.UTC(2000, mo, 0)).getUTCDate(); // days in month for leap year 2000
	const days = mo === 2 && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 28 : dim;
	if (d > days) return null;
	return `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
}

function parseDatePart(s: string, order: SlashOrder): string | null {
	let m = ISO_RE.exec(s) ?? YMD_SLASH_RE.exec(s);
	if (m) return ymd(+grp(m, 1), +grp(m, 2), +grp(m, 3));
	m = DOT_RE.exec(s) ?? DASH_DMY_RE.exec(s);
	if (m) return ymd(+grp(m, 3), +grp(m, 2), +grp(m, 1));
	m = SLASH_RE.exec(s);
	if (m) {
		const a = +grp(m, 1);
		const b = +grp(m, 2);
		let o: SlashOrder = order;
		if (o === "auto") o = a === b || a > 12 ? "dmy" : b > 12 ? "mdy" : "none";
		if (o === "dmy") return ymd(+grp(m, 3), b, a);
		if (o === "mdy") return ymd(+grp(m, 3), a, b);
		return null;
	}
	m = NAME_DMY_RE.exec(s);
	if (m) {
		const mo = MONTHS[grp(m, 2).toLowerCase()];
		return mo ? ymd(+grp(m, 3), mo, +grp(m, 1)) : null;
	}
	m = NAME_MDY_RE.exec(s);
	if (m) {
		const mo = MONTHS[grp(m, 1).toLowerCase()];
		return mo ? ymd(+grp(m, 3), mo, +grp(m, 2)) : null;
	}
	return null;
}

/** Split off a trailing time of day; `date` is the remaining date text. */
function splitTime(s: string): { date: string; h: number; mi: number; sec: number; tz: string | undefined } | null {
	const m = DATETIME_RE.exec(s);
	if (!m) return null;
	return { date: grp(m, 1), h: +grp(m, 2), mi: +grp(m, 3), sec: m[4] === undefined ? 0 : +grp(m, 4), tz: m[5] };
}

/**
 * Decide how slash dates (`03/04/2026`) of a column are read. Explicit "dmy"/"mdy" win. "auto": day-first when a
 * value has a first part > 12, month-first when one has a second part > 12; null when both or neither
 * (ambiguous: the column should stay text).
 */
export function resolveDateOrder(values: string[], dateOrder: DateOrder = "auto"): "dmy" | "mdy" | null {
	if (dateOrder !== "auto") return dateOrder;
	let first = false;
	let second = false;
	for (const raw of values) {
		const v = raw.trim();
		if (!v.includes("/")) continue;
		const m = SLASH_RE.exec(splitTime(v)?.date ?? v);
		if (!m) continue;
		if (+grp(m, 1) > 12) first = true;
		if (+grp(m, 2) > 12) second = true;
	}
	if (first && !second) return "dmy";
	if (second && !first) return "mdy";
	return null;
}

/** Recognize a date or datetime string. Timezone and fractional seconds are dropped. */
function parseDateValue(raw: string, order: SlashOrder = "auto"): ParsedDate | null {
	const s = raw.trim();
	const date = parseDatePart(s, order);
	if (date) return { kind: "date", date };
	const t = splitTime(s);
	if (!t) return null;
	const d = parseDatePart(t.date, order);
	if (!d) return null;
	if (t.h > 23 || t.mi > 59 || t.sec > 59) return null;
	return { kind: "datetime", date: d, time: `${pad(t.h)}:${pad(t.mi)}:${pad(t.sec)}` };
}

/** True when at least one value is a datetime carrying a `Z` / UTC-offset suffix (which conversion drops). */
export function hasTimezoneOffsets(values: string[]): boolean {
	for (const v of values) {
		const t = splitTime(v.trim());
		if (t && t.tz !== undefined && parseDatePart(t.date, "auto") !== null) return true;
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

interface Inferred {
	type: PropertyType;
	stripUnits: boolean;
}

/**
 * Single pass over `count` values (via `get`) deciding the column type. Empty values are ignored.
 * Order: checkbox, number, date, datetime, else text. A column that is numeric only after stripping units
 * (currency, percent, space thousands) is a number with `stripUnits`.
 */
function inferFrom(count: number, get: (i: number) => string, opts: InferenceOptions): Inferred {
	let order: SlashOrder = "none";
	{
		const vals: string[] = [];
		for (let i = 0; i < count; i++) vals.push(get(i));
		order = resolveDateOrder(vals, opts.dateOrder ?? "auto") ?? "none";
	}
	let n = 0;
	let allBool = true;
	let anyNotNo = false;
	let allNum = true;
	let allNumU = true;
	let anyUnit = false;
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
		if (allNumU) {
			if (parseNumber(v, opts.decimalSeparator, true) !== null) {
				// plain number
			} else if (parseNumber(v, opts.decimalSeparator, true, true) !== null) {
				anyUnit = true;
				allNum = false;
			} else {
				allNumU = false;
				allNum = false;
			}
		}
		if (allDate) {
			const d = parseDateValue(v, order);
			if (d === null) allDate = false;
			else if (d.kind === "datetime") {
				anyTime = true;
				if (d.time !== "00:00:00") allMidnight = false;
			}
		}
		if (!allBool && !allNumU && !allDate) return { type: "text", stripUnits: false };
	}
	if (n === 0) return { type: "text", stripUnits: false };
	// A column of only bare "no" is far more likely a text/word column than a checkbox.
	if (allBool && anyNotNo) return { type: "checkbox", stripUnits: false };
	if (allNum) return { type: "number", stripUnits: false };
	if (allNumU && anyUnit) return { type: "number", stripUnits: true };
	if (allDate) {
		if (!anyTime) return { type: "date", stripUnits: false };
		if (opts.midnightAsDate && allMidnight) return { type: "date", stripUnits: false };
		return { type: "datetime", stripUnits: false };
	}
	return { type: "text", stripUnits: false };
}

/**
 * Infer the property type of a column from its raw (string) values. Empty values are ignored.
 * Order: checkbox (true/false/yes/no), number, date, datetime, else text. `list` is never inferred.
 * Strict: "+49..." and exponents ("1e5") are text; a column of only bare "no" is text.
 * Values with units ("12 %", "1.234,56 EUR") only count as number via the column's `stripUnits` (see buildColumnConfigs).
 */
export function inferColumnType(values: string[], opts: InferenceOptions): PropertyType {
	return inferFrom(values.length, (i) => values[i] ?? "", opts).type;
}

function inferColumn(parsed: ParsedCsv, index: number, opts: InferenceOptions): Inferred {
	const rows = parsed.rows;
	return inferFrom(rows.length, (i) => rows[i]?.[index] ?? "", opts);
}

function inferredFields(inf: Inferred): { type: PropertyType; stripUnits?: true } {
	return inf.stripUnits ? { type: inf.type, stripUnits: true } : { type: inf.type };
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
			const n = parseNumber(t, opts.decimalSeparator, false, opts.stripUnits);
			if (n === null) return t;
			const p = opts.precision;
			return p !== null && p !== undefined ? Number(formatNumber(n, p)) : n;
		}
		case "checkbox": {
			const b = parseBool(t);
			return b === null ? t : b;
		}
		case "date": {
			const d = parseDateValue(t, opts.dateOrder ?? "auto") ?? parseExcelSerial(t, opts.decimalSeparator);
			return d ? d.date : t;
		}
		case "datetime": {
			const d = parseDateValue(t, opts.dateOrder ?? "auto") ?? parseExcelSerial(t, opts.decimalSeparator);
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
		...inferredFields(inferColumn(parsed, index, opts)),
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
			...inferredFields(inferColumn(parsed, index, opts)),
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
			if (asDot && parseNumber(v, ".", true, true) === null) asDot = false;
			if (asComma && parseNumber(v, ",", true, true) === null) asComma = false;
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
