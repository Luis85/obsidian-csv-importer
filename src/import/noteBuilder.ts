import type { FileImportConfig, FrontmatterValue, ParsedCsv, PlannedNote } from "../types";
import { buildColumnConfigs, convertValue } from "../csv/typeInference";

export interface TemplateContext {
	headers: string[];
	row: string[];
	/** 1-based data row number. */
	rowNumber: number;
	/** CSV file basename without extension. */
	fileBasename: string;
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
		return (ctx.row[idx] ?? "").trim();
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
	const conv = { decimalSeparator: config.decimalSeparator, listSeparator: config.listSeparator };
	const configTags = parseTags(config.tags);
	const used = new Set<string>();
	const notes: PlannedNote[] = [];

	parsed.rows.forEach((row, i) => {
		const rowNumber = i + 1;
		const ctx: TemplateContext = { headers: parsed.headers, row, rowNumber, fileBasename: csv.basename };

		const fm: Record<string, FrontmatterValue> = {};
		for (const col of included) {
			fm[col.property] = convertValue(row[col.index] ?? "", col.type, conv);
		}
		if (configTags.length > 0) {
			const existing = fm["tags"];
			let colTags: string[] = [];
			if (Array.isArray(existing)) colTags = existing.map(normalizeTag).filter((t) => t !== "");
			else if (typeof existing === "string") colTags = parseTags(existing);
			fm["tags"] = [...new Set([...colTags, ...configTags])];
		}
		if (config.addSourceLink) fm["source"] = `[[${csv.path}]]`;

		let name = sanitizeFileName(renderTemplate(config.fileNameTemplate, ctx));
		if (name === "") name = sanitizeFileName(`${csv.basename} ${rowNumber}`) || `Note ${rowNumber}`;
		const make = (n: string) => (folder ? `${folder}/${n}.md` : `${n}.md`);
		let path = make(name);
		let suffix = 2;
		while (used.has(path.toLowerCase())) path = make(`${name} ${suffix++}`);
		used.add(path.toLowerCase());

		notes.push({ path, frontmatter: fm, body: renderTemplate(config.bodyTemplate, ctx), row: rowNumber });
	});
	return notes;
}

// ---------------------------------------------------------------- YAML

const RESERVED_WORDS = new Set(["true", "false", "yes", "no", "y", "n", "on", "off", "null", "nan", "inf"]);
const PLAIN_STRING_RE = /^\p{L}[\p{L}\p{N} _.()/&+-]*$/u;
const PLAIN_KEY_RE = /^[\p{L}_][\p{L}\p{N} _.()/&+-]*$/u;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_ONLY_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

function quote(s: string): string {
	return JSON.stringify(s).replace(
		/[\u0085\u2028\u2029]/g,
		(c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
	);
}

function yamlString(s: string): string {
	if (DATE_ONLY_RE.test(s) || DATETIME_ONLY_RE.test(s)) return s; // written natural for date/datetime properties
	if (PLAIN_STRING_RE.test(s) && s === s.trim() && !RESERVED_WORDS.has(s.toLowerCase())) return s;
	return quote(s);
}

function yamlKey(k: string): string {
	if (PLAIN_KEY_RE.test(k) && k === k.trim() && !RESERVED_WORDS.has(k.toLowerCase())) return k;
	return quote(k);
}

/** Serialize frontmatter as YAML (`---` fenced) followed by body. Strings are quoted when needed so they are never re-interpreted as numbers/booleans/null. ISO date/datetime strings are left unquoted. */
export function serializeNote(frontmatter: Record<string, FrontmatterValue>, body: string): string {
	const lines: string[] = [];
	for (const [key, value] of Object.entries(frontmatter)) {
		const k = yamlKey(key);
		if (value === null || value === undefined) lines.push(`${k}:`);
		else if (typeof value === "number") lines.push(Number.isFinite(value) ? `${k}: ${value}` : `${k}:`);
		else if (typeof value === "boolean") lines.push(`${k}: ${value}`);
		else if (Array.isArray(value)) {
			if (value.length === 0) lines.push(`${k}: []`);
			else {
				lines.push(`${k}:`);
				for (const item of value) lines.push(`  - ${yamlString(String(item))}`);
			}
		} else lines.push(`${k}: ${yamlString(value)}`);
	}
	const head = lines.length > 0 ? `---\n${lines.join("\n")}\n---\n` : "---\n---\n";
	if (body === "") return head;
	return head + (body.endsWith("\n") ? body : body + "\n");
}
