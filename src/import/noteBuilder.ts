/**
 * Note planning: turns a parsed CSV plus its import config into planned notes (path, frontmatter, body, key).
 * Also the public barrel for the pure helpers split into templates.ts, folders.ts and yaml.ts.
 */
import type { ColumnConfig, FileImportConfig, FrontmatterValue, ParsedCsv, PlannedNote, PropertyType, RowFilter } from "../types";
import { buildColumnConfigs, conversionOptionsOf, convertValue, inferenceOptionsOf, parseNumber, resolveDateOrder, type ConversionOptions } from "../csv/typeInference";
import { compileTemplate, formatValue, headerIndexOf, renderCompiled, type CompiledTemplate, type TemplateContext } from "./templates";
import { compileFolderSegments, hasFolderPlaceholders, renderFolderSegments, resolveTargetFolder, sanitizeFileName, type FolderSegments } from "./folders";
import { uuidV4 } from "../core/util";

export { applyValueTemplate, formatValue, renderTemplate, type TemplateContext } from "./templates";
export { resolveRowFolder, resolveTargetFolder, sanitizeFileName, staticPrefix } from "./folders";
export { serializeNote } from "./yaml";

const LIST_PROPS = ["tags", "aliases", "cssclasses"];

/** Display value of a cell for templates: file-name mode turns datetimes into `YYYY-MM-DD HH-mm[-ss]`. */
function formatCell(value: FrontmatterValue, raw: string, type: PropertyType, forFileName: boolean): string {
	if (value === null) return "";
	if (typeof value !== "string") return formatValue(value);
	const asName = type === "datetime" && forFileName ? fileNameDateTime(value) : null;
	if (asName !== null) return asName;
	return type === "text" || type === "list" ? (raw ?? "").trim() : value;
}

/** `YYYY-MM-DDTHH:mm:ss` as `YYYY-MM-DD HH-mm[-ss]` (no colons, seconds only when not 00); null for other values. */
function fileNameDateTime(value: string): string | null {
	const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
	return m ? `${m[1]} ${m[2]}-${m[3]}${m[4] !== "00" ? "-" + m[4] : ""}` : null;
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
const legacySourceLinkProperty = "source";

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
function compositeKeyProperty(config: FileImportConfig, columns: ColumnConfig[] = config.columns): string | null {
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
	opts: { now?: Date; uuid?: () => string; rows?: number[] } = {},
): PlannedNote[] {
	const run = compileRun(parsed, config, csv, opts);
	const paths = new PathAllocator();
	const notes: PlannedNote[] = [];
	parsed.rows.forEach((row, i) => {
		if (!rowMatches(config.rowFilter, parsed.headers, row, config.decimalSeparator)) return;
		notes.push(planRow(run, row, parsed.rowNumbers[i] ?? i + 1, paths));
	});
	return opts.rows ? filterNotesByRows(notes, opts.rows) : notes;
}

/** An extra property that can be written: its name, type and compiled default value. */
interface PlannedExtra {
	name: string;
	type: PropertyType;
	tpl: CompiledTemplate;
}

/** How the note key is taken from a row: from 2+ key columns (composite), from one key column, or not at all. */
interface KeyPlan {
	compositeProp: string | null;
	compositeCols: (ColumnConfig | undefined)[];
	keyCol: ColumnConfig | undefined;
}

/** What planNotes works out once per run and uses for every row. */
interface PlanRun {
	parsed: ParsedCsv;
	config: FileImportConfig;
	csv: { path: string; basename: string };
	byIndex: Map<number, ColumnConfig>;
	convByIndex: Map<number, ConversionOptions>;
	conv: ConversionOptions;
	/** Columns written to the frontmatter. */
	included: ColumnConfig[];
	valueTpls: Map<ColumnConfig, CompiledTemplate>;
	/** Compiled target folder when it has placeholders, else null and `staticFolder` is used. */
	folderSegs: FolderSegments | null;
	staticFolder: string;
	configTags: string[];
	extras: PlannedExtra[];
	newUuid: () => string;
	linkProp: string | null;
	key: KeyPlan;
	nameTpl: CompiledTemplate;
	bodyTpl: CompiledTemplate;
}

function compileRun(
	parsed: ParsedCsv,
	config: FileImportConfig,
	csv: { path: string; basename: string },
	opts: { now?: Date; uuid?: () => string },
): PlanRun {
	const dynamicFolder = hasFolderPlaceholders(config);
	const staticFolder = resolveTargetFolder(config, csv.path);
	const columns =
		config.columns.length > 0 ? config.columns : buildColumnConfigs(parsed, inferenceOptionsOf(config, true));
	const key = keyPlanOf(config, columns);
	// The key column is always written: it has to be stored in the notes to match them on later imports.
	const included = columns.filter((c) => c.include || c === key.keyCol);
	const conv = conversionOptionsOf(config);
	const headerIndex = headerIndexOf(parsed.headers);
	return {
		parsed,
		config,
		csv,
		byIndex: new Map<number, ColumnConfig>(columns.map((c) => [c.index, c])),
		convByIndex: conversionByColumn(parsed, columns, config, conv),
		conv,
		included,
		valueTpls: compileValueTemplates(included, headerIndex),
		folderSegs: dynamicFolder ? compileFolderSegments(config.targetFolder, headerIndex) : null,
		staticFolder,
		configTags: parseTags(config.tags),
		extras: compileExtras(config, headerIndex, opts.now ?? new Date()),
		newUuid: opts.uuid ?? uuidV4,
		linkProp: sourceLinkFor(config, columns),
		key,
		nameTpl: compileTemplate(config.fileNameTemplate, headerIndex),
		bodyTpl: compileTemplate(config.bodyTemplate, headerIndex),
	};
}

function keyPlanOf(config: FileImportConfig, columns: ColumnConfig[]): KeyPlan {
	const keyCols = effectiveKeyColumns(config);
	const composite = keyCols.length >= 2;
	return {
		compositeProp: composite ? compositeKeyProperty(config, columns) : null,
		compositeCols: composite ? keyCols.map((k) => columns.find((c) => c.source === k)) : [],
		keyCol: keyCols.length === 1 ? columns.find((c) => c.source === keyCols[0]) : undefined,
	};
}

/** Per column: unit stripping and the date order resolved over the whole column (ambiguous slash dates). */
function conversionByColumn(
	parsed: ParsedCsv,
	columns: ColumnConfig[],
	config: FileImportConfig,
	conv: ConversionOptions,
): Map<number, ConversionOptions> {
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
	return convByIndex;
}

function compileValueTemplates(included: ColumnConfig[], headerIndex: Map<string, number>): Map<ColumnConfig, CompiledTemplate> {
	const valueTpls = new Map<ColumnConfig, CompiledTemplate>();
	for (const col of included) {
		if (col.valueTemplate) valueTpls.set(col, compileTemplate(col.valueTemplate, headerIndex, true));
	}
	return valueTpls;
}

/** The extra properties that can be written (see extraPropertyConflicts), with `{{today}}` / `{{now}}` filled in. */
function compileExtras(config: FileImportConfig, headerIndex: Map<string, number>, now: Date): PlannedExtra[] {
	const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
	const nowStr = `${today}T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
	const conflicts = reservedExtraNames(config);
	const extras: PlannedExtra[] = [];
	const extraSeen = new Set<string>();
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
	return extras;
}

type Frontmatter = Record<string, FrontmatterValue>;
type PropertyTypes = Record<string, PropertyType>;

/** The planned note of one data row. */
function planRow(run: PlanRun, row: string[], rowNumber: number, paths: PathAllocator): PlannedNote {
	const { parsed, config, csv } = run;
	const { converted, nameCtx, bodyCtx } = buildRowContext(parsed, row, rowNumber, run.byIndex, run.convByIndex, csv.basename);
	const folder = run.folderSegs ? renderFolderSegments(run.folderSegs, nameCtx) : run.staticFolder;

	const { fm, types } = buildFrontmatter(run.included, converted, run.valueTpls, bodyCtx, config);
	normalizeListProps(fm, types, config);
	addConfigTags(fm, types, run.configTags);
	const fillOnly = addExtras(fm, types, run, bodyCtx);
	if (run.linkProp !== null) {
		fm[run.linkProp] = `[[${csv.path}]]`;
		types[run.linkProp] = "text";
	}
	const key = rowKey(fm, types, run.key, bodyCtx);

	return {
		path: paths.allocate(folder, noteName(run.nameTpl, nameCtx, csv.basename, rowNumber)),
		frontmatter: fm,
		body: renderCompiled(run.bodyTpl, bodyCtx),
		row: rowNumber,
		fillOnly,
		types,
		key,
	};
}

/** Adds the config's tags to the row's `tags` (in place). */
function addConfigTags(fm: Frontmatter, types: PropertyTypes, configTags: string[]): void {
	if (configTags.length === 0) return;
	const existing = fm["tags"];
	const colTags = Array.isArray(existing) ? existing : [];
	fm["tags"] = [...new Set([...colTags, ...configTags])];
	types["tags"] = "list";
}

/** Adds the extra properties (in place), each `{{uuid}}` a fresh UUID. Returns their names, in order. */
function addExtras(fm: Frontmatter, types: PropertyTypes, run: PlanRun, bodyCtx: TemplateContext): string[] {
	const fillOnly: string[] = [];
	for (const ex of run.extras) {
		const parts = renderCompiled(ex.tpl, bodyCtx).split(UUID_MARK);
		const withIds = parts.reduce((acc, part, k) => (k === 0 ? part : acc + run.newUuid() + part), "");
		const v = convertValue(withIds, ex.type, run.conv);
		if (v === null && run.config.emptyValues === "omit") continue;
		fm[ex.name] = v;
		types[ex.name] = ex.type;
		fillOnly.push(ex.name);
	}
	return fillOnly;
}

/** The row's key; a composite key is also written to its property (in place). Null when the row has none. */
function rowKey(fm: Frontmatter, types: PropertyTypes, plan: KeyPlan, bodyCtx: TemplateContext): PlannedNote["key"] {
	if (plan.compositeProp !== null) {
		const parts = plan.compositeCols.map((c) => (c ? (bodyCtx.formatted?.[c.index] ?? "").trim() : ""));
		if (!parts.every((p) => p !== "")) return null;
		const value = parts.join(" | ");
		fm[plan.compositeProp] = value;
		types[plan.compositeProp] = "text";
		return { property: plan.compositeProp, value };
	}
	if (!plan.keyCol) return null;
	// Must equal what was written for the property (after any value template).
	const kv = fm[plan.keyCol.property];
	if (kv === null || kv === undefined || Array.isArray(kv)) return null;
	return { property: plan.keyCol.property, value: formatValue(kv) };
}

/** File name of a row's note; an empty one falls back to `<file> <row>`, then `Note <row>`. */
function noteName(nameTpl: CompiledTemplate, nameCtx: TemplateContext, basename: string, rowNumber: number): string {
	const name = sanitizeFileName(renderCompiled(nameTpl, nameCtx));
	if (name !== "") return name;
	return sanitizeFileName(`${basename} ${rowNumber}`) || `Note ${rowNumber}`;
}

/** Keeps only the planned notes of these original 1-based data row numbers (paths were allocated over all rows, so they stay stable). */
export function filterNotesByRows(notes: PlannedNote[], rows: readonly number[]): PlannedNote[] {
	const wanted = new Set(rows);
	return notes.filter((n) => wanted.has(n.row));
}
