import type { ColumnConfig, FileImportConfig, FrontmatterValue, ParsedCsv, PlannedNote, PropertyType } from "../types";
import { buildColumnConfigs, convertValue, formatNumber } from "../csv/typeInference";

export interface TemplateContext {
	headers: string[];
	row: string[];
	/** 1-based data row number. */
	rowNumber: number;
	/** CSV file basename without extension. */
	fileBasename: string;
	/** Optional display values per column (same indexes as headers); used instead of the raw cell when present. */
	formatted?: string[];
}

/** String form of a converted value (date ISO, number normalized, boolean true/false). */
export function formatValue(value: FrontmatterValue): string {
	if (value === null) return "";
	if (typeof value === "number") return formatNumber(value);
	if (Array.isArray(value)) return value.join(", ");
	return String(value);
}

/** Display value of a cell for templates: file-name mode turns datetimes into `YYYY-MM-DD HH-mm[-ss]`. */
function formatCell(value: FrontmatterValue, raw: string, type: PropertyType, forFileName: boolean): string {
	const t = (raw ?? "").trim();
	if (value === null) return "";
	if (typeof value === "string") {
		if (type === "datetime" && forFileName) {
			const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
			if (m) return `${m[1]} ${m[2]}-${m[3]}${m[4] !== "00" ? "-" + m[4] : ""}`;
		}
		return type === "text" || type === "list" ? t : value;
	}
	return formatValue(value);
}

/**
 * Apply a column value template to a converted value. `{{value}}`/`$value` is the formatted value;
 * `{{Header}}`, `{{row}}`, `{{file}}` as in renderTemplate. Lists: per item. Null stays null.
 */
export function applyValueTemplate(
	template: string,
	value: FrontmatterValue,
	ctx: TemplateContext,
): FrontmatterValue {
	if (value === null || template === "") return value;
	const one = (v: string) =>
		template.replace(/\{\{([^{}]*)\}\}|\$value/g, (_m, key: string | undefined) =>
			key === undefined || key.trim() === "value" ? v : renderTemplate(`{{${key}}}`, ctx),
		);
	if (Array.isArray(value)) return value.map(one);
	return one(formatValue(value));
}

/**
 * Replace `{{Header}}`, `{{row}}`, `{{file}}` (case-sensitive headers, whitespace inside braces trimmed). Unknown -> "".
 * The reserved names `row` and `file` take precedence over headers of the same name.
 */
export function renderTemplate(template: string, ctx: TemplateContext): string {
	return template.replace(/\{\{([^{}]*)\}\}/g, (_m, key: string) => {
		const k = key.trim();
		if (k === "row") return String(ctx.rowNumber);
		if (k === "file") return ctx.fileBasename;
		const idx = ctx.headers.indexOf(k);
		if (idx < 0) return "";
		return (ctx.formatted?.[idx] ?? ctx.row[idx] ?? "").trim();
	});
}

const RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_NAME_BYTES = 240;

/** Truncate to at most `max` UTF-8 bytes without splitting a code point (surrogate pair). */
function truncateUtf8(s: string, max: number): string {
	let bytes = 0;
	let i = 0;
	while (i < s.length) {
		const cp = s.codePointAt(i) as number;
		const len = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
		if (bytes + len > max) break;
		bytes += len;
		i += cp > 0xffff ? 2 : 1;
	}
	return s.slice(0, i);
}

/**
 * Make a string safe as an Obsidian file name: strip \ / : * ? " < > | # ^ [ ] and control chars, collapse whitespace,
 * trim dots/spaces, normalize to NFC, truncate to 240 UTF-8 bytes (callers add the suffix and ".md"), and prefix
 * Windows reserved names (CON, NUL, COM1...) with "_". Empty -> "".
 */
export function sanitizeFileName(name: string): string {
	const clean = (s: string) =>
		s
			// eslint-disable-next-line no-control-regex -- stripping control characters is intended
			.replace(/[\u0000-\u001f\u007f]/g, " ")
			.replace(/[\\/:*?"<>|#^[\]]/g, "")
			.replace(/\s+/g, " ")
			.replace(/^[\s.]+|[\s.]+$/g, "");
	let s = clean(name).normalize("NFC");
	if (s.length > MAX_NAME_BYTES / 3) s = clean(truncateUtf8(s, MAX_NAME_BYTES));
	if (RESERVED_NAME_RE.test(s)) s = "_" + s;
	return s;
}

// ---------------------------------------------------------------- compiled templates

type Seg = string | { col: number } | { row: true } | { file: true } | { value: true };
type Compiled = Seg[];

/** Parse a template once into literal strings and placeholders (column indexes resolved against `headers`). */
function compileTemplate(template: string, headerIndex: Map<string, number>, withValue = false): Compiled {
	const re = withValue ? /\{\{([^{}]*)\}\}|\$value/g : /\{\{([^{}]*)\}\}/g;
	const out: Compiled = [];
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(template)) !== null) {
		if (m.index > last) out.push(template.slice(last, m.index));
		const key = m[1]?.trim();
		if (key === undefined || (withValue && key === "value")) out.push({ value: true });
		else if (key === "row") out.push({ row: true });
		else if (key === "file") out.push({ file: true });
		else {
			const idx = headerIndex.get(key);
			if (idx !== undefined) out.push({ col: idx });
		}
		last = m.index + m[0].length;
	}
	if (last < template.length) out.push(template.slice(last));
	return out;
}

function renderCompiled(c: Compiled, ctx: TemplateContext, value = ""): string {
	if (c.length === 1 && typeof c[0] === "string") return c[0];
	let out = "";
	for (const seg of c) {
		if (typeof seg === "string") out += seg;
		else if ("col" in seg) out += (ctx.formatted?.[seg.col] ?? ctx.row[seg.col] ?? "").trim();
		else if ("row" in seg) out += String(ctx.rowNumber);
		else if ("file" in seg) out += ctx.fileBasename;
		else out += value;
	}
	return out;
}

const LIST_PROPS = new Set(["tags", "aliases", "cssclasses"]);

/** True when the configured target folder contains `{{...}}` placeholders. */
export function hasFolderPlaceholders(config: FileImportConfig): boolean {
	return /\{\{[^{}]*\}\}/.test(config.targetFolder);
}

function splitPath(p: string): string[] {
	return p.replace(/\\/g, "/").split("/").filter((x) => x !== "");
}

/** Split a configured static folder and reject anything that could leave the vault ("..", "C:\\"). */
function splitTargetFolder(raw: string): string[] {
	const t = raw.trim();
	const segs = splitPath(t);
	if (/^[a-zA-Z]:/.test(t) || segs.some((seg) => seg === "..")) {
		throw new Error(`The target folder must be inside the vault: ${raw.trim()}`);
	}
	return segs;
}

/**
 * Resolve the target folder: config.targetFolder (normalized, no leading/trailing slash; "/" means vault root)
 * or, when blank, `<csv dir>/<csv basename>`.
 */
export function resolveTargetFolder(config: FileImportConfig, csvPath: string): string {
	if (config.targetFolder.trim() !== "") return splitTargetFolder(config.targetFolder).join("/");
	return defaultFolder(csvPath);
}

/**
 * Like resolveTargetFolder but renders `{{Column}}`, `{{row}}`, `{{file}}` placeholders per row.
 * Each path segment is rendered separately and sanitized with sanitizeFileName; empty segments are dropped.
 */
export function resolveRowFolder(config: FileImportConfig, csvPath: string, ctx: TemplateContext): string {
	const t = config.targetFolder.trim();
	if (t === "") return defaultFolder(csvPath);
	return splitTargetFolder(t)
		.map((seg) => (/\{\{[^{}]*\}\}/.test(seg) ? sanitizeFileName(renderTemplate(seg, ctx)) : seg))
		.filter((seg) => seg !== "")
		.join("/");
}

function defaultFolder(csvPath: string): string {
	const parts = splitPath(csvPath);
	const file = parts.pop() ?? "";
	const dot = file.lastIndexOf(".");
	const base = dot > 0 ? file.slice(0, dot) : file;
	return [...parts, base].join("/");
}

/** Normalize a tag: strip leading #, spaces -> "-". Returns "" when nothing is left. */
function normalizeTag(t: string): string {
	return t.trim().replace(/^#+/, "").trim().replace(/\s+/g, "-");
}

function parseTags(s: string): string[] {
	return s.split(",").map(normalizeTag).filter((t) => t !== "");
}

/** Normalize a value of `tags` / `aliases` / `cssclasses` into a deduplicated list. */
function normalizeListProp(name: string, v: FrontmatterValue): string[] {
	const isTags = name === "tags";
	const items: string[] = [];
	if (v === null) return [];
	if (Array.isArray(v)) {
		for (const x of v) items.push(isTags ? normalizeTag(x) : x.trim());
	} else if (typeof v === "string") {
		if (isTags) items.push(...v.split(/[,\s]+/).map(normalizeTag));
		else items.push(...v.split(",").map((x) => x.trim()));
	} else items.push(String(v));
	return [...new Set(items.filter((x) => x !== ""))];
}

/**
 * Property that receives the source link, or null when `addSourceLink` is off. Normally "source"; when a column's
 * property is already "source" (case-insensitive) it is "source_csv" (then "source_csv 2"...) so the column survives.
 */
export function sourceLinkProperty(config: FileImportConfig): string | null {
	return sourceLinkFor(config, config.columns);
}

function sourceLinkFor(config: FileImportConfig, columns: ColumnConfig[]): string | null {
	if (!config.addSourceLink) return null;
	const taken = new Set(columns.map((c) => c.property.toLowerCase()));
	let name = "source";
	let n = 1;
	while (taken.has(name.toLowerCase())) {
		name = n === 1 ? "source_csv" : `source_csv ${n}`;
		n++;
	}
	return name;
}

/**
 * Plan one note per data row. Frontmatter contains included columns (typed via convertValue),
 * `tags` (when config.tags non-empty, merged with a `tags` column if present), and
 * `source: "[[path/to/file.csv]]"` when addSourceLink (property name: see sourceLinkProperty). Null values are kept (empty property).
 * Empty file names fall back to `<file> <row>`. Duplicate paths within one run (case-insensitive)
 * get " 2", " 3" suffixes. If config.columns is empty, columns are inferred on the fly
 * (midnightAsDate = true).
 */
export function planNotes(
	parsed: ParsedCsv,
	config: FileImportConfig,
	csv: { path: string; basename: string },
): PlannedNote[] {
	const dynamicFolder = hasFolderPlaceholders(config);
	const staticFolder = resolveTargetFolder(config, csv.path);
	const columns =
		config.columns.length > 0
			? config.columns
			: buildColumnConfigs(parsed, {
					decimalSeparator: config.decimalSeparator,
					midnightAsDate: true,
					listSeparator: config.listSeparator,
				});
	const keyCol = config.keyColumn ? columns.find((c) => c.source === config.keyColumn) : undefined;
	// The key column is always written: it has to be stored in the notes to match them on later imports.
	const included = columns.filter((c) => c.include || c === keyCol);
	const conv = {
		decimalSeparator: config.decimalSeparator,
		listSeparator: config.listSeparator,
		precision: config.numberPrecision,
	};
	const configTags = parseTags(config.tags);
	const linkProp = sourceLinkFor(config, columns);
	const taken = new Set<string>(); // lower-cased paths already planned
	const nextSuffix = new Map<string, number>(); // lower-cased path -> next " N" suffix to try
	const notes: PlannedNote[] = [];
	const byIndex = new Map<number, ColumnConfig>(columns.map((c) => [c.index, c]));

	const headerIndex = new Map<string, number>();
	parsed.headers.forEach((h, i) => {
		if (!headerIndex.has(h)) headerIndex.set(h, i);
	});
	const nameTpl = compileTemplate(config.fileNameTemplate, headerIndex);
	const bodyTpl = compileTemplate(config.bodyTemplate, headerIndex);
	const valueTpls = new Map<ColumnConfig, Compiled>();
	for (const col of included) {
		if (col.valueTemplate) valueTpls.set(col, compileTemplate(col.valueTemplate, headerIndex, true));
	}
	const folderSegs = dynamicFolder
		? splitTargetFolder(config.targetFolder).map((seg) =>
				/\{\{[^{}]*\}\}/.test(seg) ? compileTemplate(seg, headerIndex) : seg,
			)
		: [];

	parsed.rows.forEach((row, i) => {
		const rowNumber = i + 1;
		const converted = new Map<number, FrontmatterValue>();
		const nameVals: string[] = [];
		const bodyVals: string[] = [];
		parsed.headers.forEach((_h, idx) => {
			const col = byIndex.get(idx);
			const raw = row[idx] ?? "";
			if (!col) {
				nameVals.push(raw.trim());
				bodyVals.push(raw.trim());
				return;
			}
			const v = convertValue(raw, col.type, conv);
			converted.set(idx, v);
			nameVals.push(formatCell(v, raw, col.type, true));
			bodyVals.push(formatCell(v, raw, col.type, false));
		});
		const base = { headers: parsed.headers, row, rowNumber, fileBasename: csv.basename };
		const nameCtx: TemplateContext = { ...base, formatted: nameVals };
		const bodyCtx: TemplateContext = { ...base, formatted: bodyVals };

		let folder = staticFolder;
		if (dynamicFolder) {
			const parts: string[] = [];
			for (const seg of folderSegs) {
				const v = typeof seg === "string" ? seg : sanitizeFileName(renderCompiled(seg, nameCtx));
				if (v !== "") parts.push(v);
			}
			folder = parts.join("/");
		}
		const fm: Record<string, FrontmatterValue> = {};
		const types: Record<string, PropertyType> = {};
		for (const col of included) {
			let v = converted.get(col.index) ?? null;
			let type = col.type;
			const vt = valueTpls.get(col);
			if (vt && v !== null) {
				v = Array.isArray(v)
					? v.map((x) => renderCompiled(vt, bodyCtx, x))
					: renderCompiled(vt, bodyCtx, formatValue(v));
				if (type !== "list") type = "text";
			}
			if (v === null && config.emptyValues === "omit") continue;
			fm[col.property] = v;
			types[col.property] = type;
		}
		for (const name of LIST_PROPS) {
			if (name in fm) {
				const list = normalizeListProp(name, fm[name]);
				if (list.length > 0) fm[name] = list;
				else if (config.emptyValues === "omit") delete fm[name];
				else fm[name] = null;
				if (name in fm) types[name] = "list";
			}
		}
		if (configTags.length > 0) {
			const existing = fm["tags"];
			const colTags = Array.isArray(existing) ? existing : [];
			fm["tags"] = [...new Set([...colTags, ...configTags])];
			types["tags"] = "list";
		}
		if (linkProp !== null) {
			fm[linkProp] = `[[${csv.path}]]`;
			types[linkProp] = "text";
		}

		let key: PlannedNote["key"] = null;
		if (keyCol) {
			// Must equal what was written for the property (after any value template).
			const kv = fm[keyCol.property];
			if (kv !== null && kv !== undefined && !Array.isArray(kv)) key = { property: keyCol.property, value: formatValue(kv) };
		}

		let name = sanitizeFileName(renderCompiled(nameTpl, nameCtx));
		if (name === "") name = sanitizeFileName(`${csv.basename} ${rowNumber}`) || `Note ${rowNumber}`;
		const make = (n: string) => (folder ? `${folder}/${n}.md` : `${n}.md`);
		let path = make(name);
		const lower = path.toLowerCase();
		if (taken.has(lower)) {
			// Amortized O(1): remember where the suffix search for this path stopped.
			let suffix = nextSuffix.get(lower) ?? 2;
			path = make(`${name} ${suffix}`);
			while (taken.has(path.toLowerCase())) path = make(`${name} ${++suffix}`);
			nextSuffix.set(lower, suffix + 1);
		}
		taken.add(path.toLowerCase());

		notes.push({
			path,
			frontmatter: fm,
			body: renderCompiled(bodyTpl, bodyCtx),
			row: rowNumber,
			types,
			key,
		});
	});
	return notes;
}

// ---------------------------------------------------------------- YAML

const PLAIN_KEY_RE = /^[\p{L}_][\p{L}\p{N} _.()/&+-]*$/u;
const RESERVED_KEY_RE = /^(?:true|false|yes|no|y|n|on|off|null)$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
// eslint-disable-next-line no-control-regex -- detecting control characters is intended
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/;
const AMBIGUOUS_RES: RegExp[] = [
	/^[-+]?(?:\.\d+|\d[\d_]*(?:\.[\d_]*)?)(?:[eE][-+]?\d+)?$/,
	/^0(?:x[0-9a-f_]+|o[0-7_]+|b[01_]+)$/i,
	/^[-+]?\.(?:inf|nan)$/i,
	/^[-+]?\d+(?::[0-5]?\d)+(?:\.\d*)?$/,
	/^(?:true|false|yes|no|on|off|y|n|null|~|<<|=)$/i,
	/^\d{4}-\d{1,2}-\d{1,2}(?:$|[Tt\s])/,
];

function quote(s: string): string {
	return JSON.stringify(s.replace(/\r\n?/g, "\n")).replace(
		/[\u007f-\u009f\u2028\u2029\ufeff]/g,
		(c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
	);
}

function yamlString(s: string, dateLike: boolean): string {
	if (dateLike && (ISO_DATE_RE.test(s) || ISO_DATETIME_RE.test(s))) return s;
	if (
		s === "" ||
		s !== s.trim() ||
		/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
		s.includes(": ") ||
		s.includes(" #") ||
		s.endsWith(":") ||
		CONTROL_RE.test(s) ||
		AMBIGUOUS_RES.some((re) => re.test(s))
	)
		return quote(s);
	return s;
}

function yamlKey(k: string): string {
	if (PLAIN_KEY_RE.test(k) && k === k.trim() && !RESERVED_KEY_RE.test(k)) return k;
	return quote(k);
}

/**
 * Serialize frontmatter as YAML (`---` fenced, LF only) followed by body. Typed scalars (numbers, booleans)
 * are plain; strings are quoted only when YAML would otherwise misread them. With `types`, ISO date/datetime
 * strings stay unquoted for date/datetime keys and are quoted for all other keys.
 */
export function serializeNote(
	frontmatter: Record<string, FrontmatterValue>,
	body: string,
	types?: Record<string, PropertyType>,
): string {
	const lines: string[] = [];
	for (const [key, value] of Object.entries(frontmatter)) {
		const k = yamlKey(key);
		const t = types?.[key];
		const dateLike = t === "date" || t === "datetime";
		if (value === null || value === undefined) lines.push(`${k}:`);
		else if (typeof value === "number") lines.push(Number.isFinite(value) ? `${k}: ${formatNumber(value)}` : `${k}:`);
		else if (typeof value === "boolean") lines.push(`${k}: ${value}`);
		else if (Array.isArray(value)) {
			if (value.length === 0) lines.push(`${k}: []`);
			else {
				lines.push(`${k}:`);
				for (const item of value) lines.push(`  - ${yamlString(String(item), false)}`);
			}
		} else lines.push(`${k}: ${yamlString(value, dateLike)}`);
	}
	const head = lines.length > 0 ? `---\n${lines.join("\n")}\n---\n` : "---\n---\n";
	if (body === "") return head;
	const b = body.replace(/\r\n?/g, "\n");
	return head + (b.endsWith("\n") ? b : b + "\n");
}
