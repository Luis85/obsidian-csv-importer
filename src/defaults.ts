import type { ExtraProperty, FileImportConfig, PluginSettings, RowFilter } from "./types";

export const DEFAULT_SETTINGS: PluginSettings = {
	defaultDelimiter: "auto",
	defaultHasHeader: true,
	defaultDecimalSeparator: ".",
	defaultTargetFolder: "",
	defaultFileNameTemplate: "{{file}} {{row}}",
	defaultBodyTemplate: "",
	defaultConflict: "update",
	defaultTags: "",
	defaultAddSourceLink: true,
	defaultListSeparator: ",",
	defaultEmptyValues: "empty",
	defaultEncoding: "auto",
	defaultProtectEdits: true,
	defaultKeepValuesOnEmpty: true,
	defaultCreateBase: true,
	midnightAsDate: true,
	pageSize: 200,
};

/** A fresh per-file config derived from global defaults (columns empty -> inferred on open). */
export function createDefaultFileConfig(settings: PluginSettings): FileImportConfig {
	return {
		delimiter: settings.defaultDelimiter,
		hasHeader: settings.defaultHasHeader,
		decimalSeparator: settings.defaultDecimalSeparator,
		targetFolder: settings.defaultTargetFolder,
		fileNameTemplate: settings.defaultFileNameTemplate,
		bodyTemplate: settings.defaultBodyTemplate,
		conflict: settings.defaultConflict,
		tags: settings.defaultTags,
		addSourceLink: settings.defaultAddSourceLink,
		listSeparator: settings.defaultListSeparator,
		emptyValues: settings.defaultEmptyValues,
		numberPrecision: null,
		keyColumn: "",
		encoding: settings.defaultEncoding,
		protectEdits: settings.defaultProtectEdits,
		keepValuesOnEmpty: settings.defaultKeepValuesOnEmpty,
		createBase: settings.defaultCreateBase,
		adoptExistingNotes: false,
		keyColumns: [],
		keyProperty: "import_key",
		dateOrder: "auto",
		rowFilter: null,
		extraProperties: [],
		columns: [],
		lastImport: null,
	};
}

/** Current schema version of data.json. */
export const CURRENT_DATA_VERSION = 1;

/** Allowed values of the enum settings; any other stored value falls back to the default. */
const SETTING_CHOICES: Partial<Record<keyof PluginSettings, readonly unknown[]>> = {
	defaultDelimiter: ["auto", ",", ";", "\t", "|"],
	defaultDecimalSeparator: [".", ","],
	defaultConflict: ["skip", "overwrite", "update", "rename"],
	defaultEmptyValues: ["empty", "omit"],
	defaultEncoding: ["auto", "utf-8", "utf-16le", "utf-16be", "windows-1252"],
};

/**
 * The global settings from data.json: every known setting with a value of the right type (and, for choices, a
 * known value), defaults for the rest. Unknown keys are dropped.
 */
export function sanitizeSettings(raw: unknown): PluginSettings {
	const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const out: PluginSettings = { ...DEFAULT_SETTINGS };
	const target = out as unknown as Record<string, unknown>;
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof PluginSettings)[]) {
		const v = src[key];
		const choices = SETTING_CHOICES[key];
		if (typeof v !== typeof DEFAULT_SETTINGS[key] || (choices && !choices.includes(v))) continue;
		target[key] = v;
	}
	if (!Number.isInteger(out.pageSize) || out.pageSize < 10 || out.pageSize > 100000) out.pageSize = DEFAULT_SETTINGS.pageSize;
	return out;
}

const DATE_ORDERS = ["auto", "dmy", "mdy"];
const FILTER_OPS = ["equals", "notEquals", "contains", "notContains", "empty", "notEmpty", "greaterThan", "lessThan"];
const PROP_TYPES = ["text", "number", "checkbox", "date", "datetime", "list"];

/**
 * Bring a stored per-file config up to the current shape: defaults for missing fields, legacy `keyColumn` ->
 * `keyColumns: [keyColumn]` when `keyColumns` is missing (keyColumn is kept), arrays and enums sanitized.
 * Does not mutate `raw`.
 */
export function migrateFileConfig(raw: Partial<FileImportConfig>, settings: PluginSettings): FileImportConfig {
	const src: Partial<FileImportConfig> = raw && typeof raw === "object" ? raw : {};
	const cfg: FileImportConfig = { ...createDefaultFileConfig(settings), ...src };
	cfg.keyColumns = migrateKeyColumns(src.keyColumns, cfg.keyColumn);
	if (typeof cfg.keyColumn !== "string") cfg.keyColumn = "";
	if (typeof cfg.keyProperty !== "string" || cfg.keyProperty.trim() === "") cfg.keyProperty = "import_key";
	if (!DATE_ORDERS.includes(cfg.dateOrder)) cfg.dateOrder = "auto";
	cfg.rowFilter = sanitizeRowFilter(cfg.rowFilter);
	cfg.extraProperties = sanitizeExtraProperties(cfg.extraProperties);
	if (!Array.isArray(cfg.columns)) cfg.columns = [];
	return cfg;
}

/** Stored `keyColumns` without empty entries; when missing, the legacy `keyColumn` (if set). */
function migrateKeyColumns(keyColumns: unknown, keyColumn: unknown): string[] {
	if (!Array.isArray(keyColumns)) return typeof keyColumn === "string" && keyColumn !== "" ? [keyColumn] : [];
	return keyColumns.filter((k): k is string => typeof k === "string" && k !== "");
}

/** A well-formed row filter, or null. */
function sanitizeRowFilter(f: RowFilter | null): RowFilter | null {
	if (!f || typeof f !== "object" || typeof f.column !== "string" || !FILTER_OPS.includes(f.op)) return null;
	return { column: f.column, op: f.op, value: typeof f.value === "string" ? f.value : "" };
}

/** Extra properties with a name, a known type (else text) and a string default. */
function sanitizeExtraProperties(list: ExtraProperty[]): ExtraProperty[] {
	if (!Array.isArray(list)) return [];
	return list
		.filter((e) => e && typeof e === "object" && typeof e.property === "string")
		.map((e) => ({
			property: e.property,
			type: PROP_TYPES.includes(e.type) ? e.type : "text",
			defaultValue: typeof e.defaultValue === "string" ? e.defaultValue : "",
		}));
}
