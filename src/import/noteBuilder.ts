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

/** Make a string safe as an Obsidian file name: strip \ / : * ? " < > | # ^ [ ] and control chars, collapse whitespace, trim dots/spaces, max 200 chars. Empty -> "". */
export function sanitizeFileName(name: string): string {
	const clean = (s: string) =>
		s
			// eslint-disable-next-line no-control-regex -- stripping control characters is intended
			.replace(/[\u0000-\u001f\u007f]/g, " ")
			.replace(/[\\/:*?"<>|#^[\]]/g, "")
			.replace(/\s+/g, " ")
			.replace(/^[\s.]+|[\s.]+$/g, "");
	let s = clean(name);
	if (s.length > 200) s = clean(s.slice(0, 200));
	return s;
}

function splitPath(p: string): string[] {
	return p.replace(/\\/g, "/").split("/").filter((x) => x !== "");
}

/**
 * Resolve the target folder: config.targetFolder (normalized, no leading/trailing slash; "/" means vault root)
 * or, when blank, `<csv dir>/<csv basename>`.
 */
export function resolveTargetFolder(config: FileImportConfig, csvPath: string): string {
	if (config.targetFolder.trim() !== "") return splitPath(config.targetFolder.trim()).join("/");
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

/**
 * Plan one note per data row. Frontmatter contains included columns (typed via convertValue),
 * `tags` (when config.tags non-empty, merged with a `tags` column if present), and
 * `source: "[[path/to/file.csv]]"` when addSourceLink. Null values are kept (empty property).
 * Empty file names fall back to `<file> <row>`. Duplicate paths within one run (case-insensitive)
 * get " 2", " 3" suffixes. If config.columns is empty, columns are inferred on the fly
 * (midnightAsDate = true).
 */
export function planNotes(
	parsed: ParsedCsv,
	config: FileImportConfig,
	csv: { path: string; basename: string },
): PlannedNote[] {
	const folder = resolveTargetFolder(config, csv.path);
	const columns =
		config.columns.length > 0
			? config.columns
			: buildColumnConfigs(parsed, {
					decimalSeparator: config.decimalSeparator,
					midnightAsDate: true,
					listSeparator: config.listSeparator,
				});
	const included = columns.filter((c) => c.include);
	const conv = {
		decimalSeparator: config.decimalSeparator,
		listSeparator: config.listSeparator,
		precision: config.numberPrecision,
	};
	const configTags = parseTags(config.tags);
	const keyCol = config.keyColumn ? columns.find((c) => c.source === config.keyColumn) : undefined;
	const used = new Set<string>();
	const notes: PlannedNote[] = [];
	const byIndex = new Map<number, ColumnConfig>(columns.map((c) => [c.index, c]));

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

		const fm: Record<string, FrontmatterValue> = {};
		const types: Record<string, PropertyType> = {};
		for (const col of included) {
			let v = converted.get(col.index) ?? null;
			let type = col.type;
			if (col.valueTemplate && v !== null) {
				v = applyValueTemplate(col.valueTemplate, v, bodyCtx);
				if (type !== "list") type = "text";
			}
			if (v === null && config.emptyValues === "omit") continue;
			fm[col.property] = v;
			types[col.property] = type;
		}
		if (configTags.length > 0) {
			const existing = fm["tags"];
			let colTags: string[] = [];
			if (Array.isArray(existing)) colTags = existing.map(normalizeTag).filter((t) => t !== "");
			else if (typeof existing === "string") colTags = parseTags(existing);
			fm["tags"] = [...new Set([...colTags, ...configTags])];
		}
		if ("tags" in fm) types["tags"] = "list";
		if (config.addSourceLink) {
			fm["source"] = `[[${csv.path}]]`;
			types["source"] = "text";
		}

		let key: PlannedNote["key"] = null;
		if (keyCol) {
			const kv = converted.get(keyCol.index) ?? null;
			if (kv !== null) key = { property: keyCol.property, value: formatValue(kv) };
		}

		let name = sanitizeFileName(renderTemplate(config.fileNameTemplate, nameCtx));
		if (name === "") name = sanitizeFileName(`${csv.basename} ${rowNumber}`) || `Note ${rowNumber}`;
		const make = (n: string) => (folder ? `${folder}/${n}.md` : `${n}.md`);
		let path = make(name);
		let suffix = 2;
		while (used.has(path.toLowerCase())) path = make(`${name} ${suffix++}`);
		used.add(path.toLowerCase());

		notes.push({
			path,
			frontmatter: fm,
			body: renderTemplate(config.bodyTemplate, bodyCtx),
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
