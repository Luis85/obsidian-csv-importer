/**
 * Note planning: turns a parsed CSV plus its import config into planned notes (path, frontmatter, body, key).
 * Also the public barrel for the pure helpers split into templates.ts, folders.ts and yaml.ts.
 */
import type { ColumnConfig, FileImportConfig, FrontmatterValue, ParsedCsv, PlannedNote, PropertyType } from "../types";
import { buildColumnConfigs, conversionOptionsOf, convertValue, inferenceOptionsOf, type ConversionOptions } from "../csv/typeInference";
import { compileTemplate, formatValue, headerIndexOf, renderCompiled, type CompiledTemplate, type TemplateContext } from "./templates";
import { compileFolderSegments, hasFolderPlaceholders, renderFolderSegments, resolveTargetFolder, sanitizeFileName } from "./folders";

export { applyValueTemplate, formatValue, renderTemplate, type TemplateContext } from "./templates";
export { hasFolderPlaceholders, resolveRowFolder, resolveTargetFolder, sanitizeFileName, staticPrefix } from "./folders";
export { serializeNote } from "./yaml";

const LIST_PROPS = ["tags", "aliases", "cssclasses"];

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

/** Older versions always wrote the source link to this property. */
export const legacySourceLinkProperty = "source";

/** Property names that may hold this CSV's source link: the current one (if any) plus the legacy "source". */
export function ownedLinkProperties(config: FileImportConfig): string[] {
	const cur = sourceLinkProperty(config);
	return cur !== null && cur !== legacySourceLinkProperty ? [cur, legacySourceLinkProperty] : [legacySourceLinkProperty];
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

/** Hands out unique note paths within one run (case-insensitive): duplicates get " 2", " 3" suffixes. */
class PathAllocator {
	private readonly taken = new Set<string>(); // lower-cased paths already planned
	private readonly nextSuffix = new Map<string, number>(); // lower-cased path -> next " N" suffix to try

	allocate(folder: string, name: string): string {
		const make = (n: string) => (folder ? `${folder}/${n}.md` : `${n}.md`);
		let path = make(name);
		const lower = path.toLowerCase();
		if (this.taken.has(lower)) {
			// Amortized O(1): remember where the suffix search for this path stopped.
			let suffix = this.nextSuffix.get(lower) ?? 2;
			path = make(`${name} ${suffix}`);
			while (this.taken.has(path.toLowerCase())) path = make(`${name} ${++suffix}`);
			this.nextSuffix.set(lower, suffix + 1);
		}
		this.taken.add(path.toLowerCase());
		return path;
	}
}

interface RowContexts {
	converted: Map<number, FrontmatterValue>;
	/** Template context for file names and folders (datetimes shown as `YYYY-MM-DD HH-mm`). */
	nameCtx: TemplateContext;
	/** Template context for bodies and value templates. */
	bodyCtx: TemplateContext;
}

/** Convert every configured cell of a row and build the two display contexts used by templates. */
function buildRowContext(
	parsed: ParsedCsv,
	row: string[],
	rowNumber: number,
	byIndex: Map<number, ColumnConfig>,
	conv: ConversionOptions,
	fileBasename: string,
): RowContexts {
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
	const base = { headers: parsed.headers, row, rowNumber, fileBasename };
	return { converted, nameCtx: { ...base, formatted: nameVals }, bodyCtx: { ...base, formatted: bodyVals } };
}

/** Typed frontmatter of included columns: value templates applied, empty values omitted per config. */
function buildFrontmatter(
	included: ColumnConfig[],
	converted: Map<number, FrontmatterValue>,
	valueTpls: Map<ColumnConfig, CompiledTemplate>,
	bodyCtx: TemplateContext,
	config: FileImportConfig,
): { fm: Record<string, FrontmatterValue>; types: Record<string, PropertyType> } {
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
	return { fm, types };
}

/** Normalize `tags` / `aliases` / `cssclasses` into deduplicated lists (in place). */
function normalizeListProps(
	fm: Record<string, FrontmatterValue>,
	types: Record<string, PropertyType>,
	config: FileImportConfig,
): void {
	for (const name of LIST_PROPS) {
		if (name in fm) {
			const list = normalizeListProp(name, fm[name]);
			if (list.length > 0) fm[name] = list;
			else if (config.emptyValues === "omit") delete fm[name];
			else fm[name] = null;
			if (name in fm) types[name] = "list";
		}
	}
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
		config.columns.length > 0 ? config.columns : buildColumnConfigs(parsed, inferenceOptionsOf(config, true));
	const keyCol = config.keyColumn ? columns.find((c) => c.source === config.keyColumn) : undefined;
	// The key column is always written: it has to be stored in the notes to match them on later imports.
	const included = columns.filter((c) => c.include || c === keyCol);
	const conv = conversionOptionsOf(config);
	const configTags = parseTags(config.tags);
	const linkProp = sourceLinkFor(config, columns);
	const paths = new PathAllocator();
	const notes: PlannedNote[] = [];
	const byIndex = new Map<number, ColumnConfig>(columns.map((c) => [c.index, c]));

	const headerIndex = headerIndexOf(parsed.headers);
	const nameTpl = compileTemplate(config.fileNameTemplate, headerIndex);
	const bodyTpl = compileTemplate(config.bodyTemplate, headerIndex);
	const valueTpls = new Map<ColumnConfig, CompiledTemplate>();
	for (const col of included) {
		if (col.valueTemplate) valueTpls.set(col, compileTemplate(col.valueTemplate, headerIndex, true));
	}
	const folderSegs = dynamicFolder ? compileFolderSegments(config.targetFolder, headerIndex) : [];

	parsed.rows.forEach((row, i) => {
		const rowNumber = parsed.rowNumbers[i] ?? i + 1;
		const { converted, nameCtx, bodyCtx } = buildRowContext(parsed, row, rowNumber, byIndex, conv, csv.basename);
		const folder = dynamicFolder ? renderFolderSegments(folderSegs, nameCtx) : staticFolder;

		const { fm, types } = buildFrontmatter(included, converted, valueTpls, bodyCtx, config);
		normalizeListProps(fm, types, config);
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

		notes.push({
			path: paths.allocate(folder, name),
			frontmatter: fm,
			body: renderCompiled(bodyTpl, bodyCtx),
			row: rowNumber,
			types,
			key,
		});
	});
	return notes;
}
