/**
 * Note planning: turns a parsed CSV plus its import config into planned notes (path, frontmatter, body, key).
 * Also the public barrel for the pure helpers split into templates.ts, folders.ts and yaml.ts.
 */
import type { ColumnConfig, FileImportConfig, FrontmatterValue, ParsedCsv, PlannedNote, PropertyType, RowFilter } from "../types";
import { buildColumnConfigs, conversionOptionsOf, convertValue, inferenceOptionsOf, parseNumber, resolveDateOrder, type ConversionOptions } from "../csv/typeInference";
import { compileTemplate, formatValue, headerIndexOf, renderCompiled, type CompiledTemplate, type TemplateContext } from "./templates";
import { compileFolderSegments, hasFolderPlaceholders, renderFolderSegments, resolveTargetFolder, sanitizeFileName } from "./folders";
import { uuidV4 } from "../core/util";

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
	convByIndex: Map<number, ConversionOptions>,
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
		const v = convertValue(raw, col.type, convByIndex.get(idx) as ConversionOptions);
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
			const list = normalizeListProp(name, fm[name] ?? null);
			if (list.length > 0) fm[name] = list;
			else if (config.emptyValues === "omit") delete fm[name];
			else fm[name] = null;
			if (name in fm) types[name] = "list";
		}
	}
}

/** Source headers that identify a row: `keyColumns` if non-empty, else `[keyColumn]` if set, else none. */
export function effectiveKeyColumns(config: FileImportConfig): string[] {
	const multi = (config.keyColumns ?? []).filter((k) => k !== "");
	if (multi.length > 0) return multi;
	return config.keyColumn ? [config.keyColumn] : [];
}

/** Property that stores a composite key (2+ key columns): `config.keyProperty`, suffixed " 2".. when a column uses it. Null otherwise. */
export function compositeKeyProperty(config: FileImportConfig, columns: ColumnConfig[] = config.columns): string | null {
	if (effectiveKeyColumns(config).length < 2) return null;
	const taken = new Set(columns.map((c) => c.property.toLowerCase()));
	const base = (config.keyProperty ?? "").trim() || "import_key";
	let name = base;
	let n = 2;
	while (taken.has(name.toLowerCase())) name = `${base} ${n++}`;
	return name;
}

/**
 * Names of extra properties that cannot be written: they collide (case-insensitive) with a column property, the
 * composite key property, `tags` (when config.tags is set), the source link property, or an earlier extra property.
 * The column wins; the extra property is skipped.
 */
export function extraPropertyConflicts(config: FileImportConfig): string[] {
	const reserved = reservedExtraNames(config);
	const out: string[] = [];
	for (const e of config.extraProperties ?? []) {
		const name = e.property.trim();
		if (name === "") continue;
		if (reserved.has(name.toLowerCase())) out.push(e.property);
		else reserved.add(name.toLowerCase());
	}
	return out;
}

function reservedExtraNames(config: FileImportConfig): Set<string> {
	const reserved = new Set(config.columns.map((c) => c.property.toLowerCase()));
	const key = compositeKeyProperty(config);
	if (key !== null) reserved.add(key.toLowerCase());
	const link = sourceLinkProperty(config);
	if (link !== null) reserved.add(link.toLowerCase());
	if (parseTags(config.tags).length > 0) reserved.add("tags");
	return reserved;
}

/**
 * Does a row pass the filter? null filter matches everything. Cells are trimmed; text comparisons are
 * case-insensitive; equals / greaterThan / lessThan compare numerically when both sides parse (decimal-aware),
 * else as lower-cased strings. An unknown column matches nothing.
 */
export function rowMatches(filter: RowFilter | null, headers: string[], row: string[], decimalSeparator: "." | ","): boolean {
	if (!filter) return true;
	const idx = headers.indexOf(filter.column);
	if (idx < 0) return false;
	const cell = (row[idx] ?? "").trim();
	const want = (filter.value ?? "").trim();
	const a = cell.toLowerCase();
	const b = want.toLowerCase();
	const cmp = (): number => {
		const na = parseNumber(cell, decimalSeparator);
		const nb = parseNumber(want, decimalSeparator);
		if (na !== null && nb !== null) return na - nb;
		return a < b ? -1 : a > b ? 1 : 0;
	};
	switch (filter.op) {
		case "empty":
			return cell === "";
		case "notEmpty":
			return cell !== "";
		case "equals":
			return cmp() === 0;
		case "notEquals":
			return cmp() !== 0;
		case "contains":
			return a.includes(b);
		case "notContains":
			return !a.includes(b);
		case "greaterThan":
			return cell !== "" && cmp() > 0;
		case "lessThan":
			return cell !== "" && cmp() < 0;
		default:
			return false;
	}
}

/** Number of data rows that pass config.rowFilter (all rows when there is none). */
export function countMatching(parsed: ParsedCsv, config: FileImportConfig): number {
	if (!config.rowFilter) return parsed.rows.length;
	let n = 0;
	for (const row of parsed.rows) if (rowMatches(config.rowFilter, parsed.headers, row, config.decimalSeparator)) n++;
	return n;
}

/** Key values that occur on more than one planned note (in order of first repetition). */
export function findDuplicateKeys(notes: PlannedNote[]): string[] {
	const seen = new Set<string>();
	const dup = new Set<string>();
	for (const n of notes) {
		if (!n.key) continue;
		if (seen.has(n.key.value)) dup.add(n.key.value);
		else seen.add(n.key.value);
	}
	return [...dup];
}

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

/** Stands in for `{{uuid}}` while templates are rendered; replaced by a fresh UUID per note. */
const UUID_MARK = "\u0001uuid\u0001";

/**
 * Plan one note per data row. Frontmatter contains included columns (typed via convertValue),
 * `tags` (when config.tags non-empty, merged with a `tags` column if present), and
 * `source: "[[path/to/file.csv]]"` when addSourceLink (property name: see sourceLinkProperty). Null values are kept (empty property).
 * Empty file names fall back to `<file> <row>`. Duplicate paths within one run (case-insensitive)
 * get " 2", " 3" suffixes. If config.columns is empty, columns are inferred on the fly
 * (midnightAsDate = true). Rows rejected by config.rowFilter produce no note (row numbers of the rest are kept).
 * Composite keys (2+ key columns) are written to compositeKeyProperty(config). Extra properties are added after
 * the columns and listed in `fillOnly`. `opts.now` fixes `{{today}}` / `{{now}}` for tests;
 * `{{uuid}}` gives each note its own random UUID (`opts.uuid` replaces the generator in tests).
 */
export function planNotes(
	parsed: ParsedCsv,
	config: FileImportConfig,
	csv: { path: string; basename: string },
	opts: { now?: Date; uuid?: () => string } = {},
): PlannedNote[] {
	const dynamicFolder = hasFolderPlaceholders(config);
	const staticFolder = resolveTargetFolder(config, csv.path);
	const columns =
		config.columns.length > 0 ? config.columns : buildColumnConfigs(parsed, inferenceOptionsOf(config, true));
	const keyCols = effectiveKeyColumns(config);
	const keyCol = keyCols.length === 1 ? columns.find((c) => c.source === keyCols[0]) : undefined;
	const compositeCols =
		keyCols.length >= 2 ? keyCols.map((k) => columns.find((c) => c.source === k)) : [];
	const compositeProp = keyCols.length >= 2 ? compositeKeyProperty(config, columns) : null;
	// The key column is always written: it has to be stored in the notes to match them on later imports.
	const included = columns.filter((c) => c.include || c === keyCol);
	const conv = conversionOptionsOf(config);
	// Per column: unit stripping and the date order resolved over the whole column (ambiguous slash dates).
	const convByIndex = new Map<number, ConversionOptions>();
	for (const col of columns) {
		const o: ConversionOptions = { ...conv };
		if (col.type === "number" && col.stripUnits) o.stripUnits = true;
		if (col.type === "date" || col.type === "datetime") {
			const order = resolveDateOrder(
				parsed.rows.map((r) => r[col.index] ?? ""),
				config.dateOrder ?? "auto",
			);
			if (order) o.dateOrder = order;
		}
		convByIndex.set(col.index, o);
	}
	const now = opts.now ?? new Date();
	const newUuid = opts.uuid ?? uuidV4;
	const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
	const nowStr = `${today}T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
	const conflicts = reservedExtraNames(config);
	const extras: { name: string; type: PropertyType; tpl: CompiledTemplate }[] = [];
	const extraSeen = new Set<string>();
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
	for (const e of config.extraProperties ?? []) {
		const name = e.property.trim();
		if (name === "" || conflicts.has(name.toLowerCase()) || extraSeen.has(name.toLowerCase())) continue;
		extraSeen.add(name.toLowerCase());
		const text = (e.defaultValue ?? "")
			.replace(/\{\{\s*today\s*\}\}/g, today)
			.replace(/\{\{\s*now\s*\}\}/g, nowStr)
			.replace(/\{\{\s*uuid\s*\}\}/g, UUID_MARK);
		extras.push({ name, type: e.type, tpl: compileTemplate(text, headerIndex) });
	}
	const folderSegs = dynamicFolder ? compileFolderSegments(config.targetFolder, headerIndex) : [];

	parsed.rows.forEach((row, i) => {
		if (!rowMatches(config.rowFilter, parsed.headers, row, config.decimalSeparator)) return;
		const rowNumber = parsed.rowNumbers[i] ?? i + 1;
		const { converted, nameCtx, bodyCtx } = buildRowContext(parsed, row, rowNumber, byIndex, convByIndex, csv.basename);
		const folder = dynamicFolder ? renderFolderSegments(folderSegs, nameCtx) : staticFolder;

		const { fm, types } = buildFrontmatter(included, converted, valueTpls, bodyCtx, config);
		normalizeListProps(fm, types, config);
		if (configTags.length > 0) {
			const existing = fm["tags"];
			const colTags = Array.isArray(existing) ? existing : [];
			fm["tags"] = [...new Set([...colTags, ...configTags])];
			types["tags"] = "list";
		}
		const fillOnly: string[] = [];
		for (const ex of extras) {
			const parts = renderCompiled(ex.tpl, bodyCtx).split(UUID_MARK);
			const withIds = parts.reduce((acc, part, k) => (k === 0 ? part : acc + newUuid() + part), "");
			const v = convertValue(withIds, ex.type, conv);
			if (v === null && config.emptyValues === "omit") continue;
			fm[ex.name] = v;
			types[ex.name] = ex.type;
			fillOnly.push(ex.name);
		}
		if (linkProp !== null) {
			fm[linkProp] = `[[${csv.path}]]`;
			types[linkProp] = "text";
		}

		let key: PlannedNote["key"] = null;
		if (compositeProp !== null) {
			const parts = compositeCols.map((c) => (c ? (bodyCtx.formatted?.[c.index] ?? "").trim() : ""));
			if (parts.every((p) => p !== "")) {
				const value = parts.join(" | ");
				fm[compositeProp] = value;
				types[compositeProp] = "text";
				key = { property: compositeProp, value };
			}
		} else if (keyCol) {
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
			fillOnly,
			types,
			key,
		});
	});
	return notes;
}
