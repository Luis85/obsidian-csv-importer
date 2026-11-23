import type { FileImportConfig, PluginSettings } from "./types";

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
	if (!Array.isArray(src.keyColumns)) cfg.keyColumns = typeof cfg.keyColumn === "string" && cfg.keyColumn !== "" ? [cfg.keyColumn] : [];
	else cfg.keyColumns = src.keyColumns.filter((k): k is string => typeof k === "string" && k !== "");
	if (typeof cfg.keyColumn !== "string") cfg.keyColumn = "";
	if (typeof cfg.keyProperty !== "string" || cfg.keyProperty.trim() === "") cfg.keyProperty = "import_key";
	if (!DATE_ORDERS.includes(cfg.dateOrder)) cfg.dateOrder = "auto";
	const f = cfg.rowFilter;
	if (!f || typeof f !== "object" || typeof f.column !== "string" || !FILTER_OPS.includes(f.op)) cfg.rowFilter = null;
	else cfg.rowFilter = { column: f.column, op: f.op, value: typeof f.value === "string" ? f.value : "" };
	cfg.extraProperties = Array.isArray(cfg.extraProperties)
		? cfg.extraProperties
				.filter((e) => e && typeof e === "object" && typeof e.property === "string")
				.map((e) => ({
					property: e.property,
					type: PROP_TYPES.includes(e.type) ? e.type : "text",
					defaultValue: typeof e.defaultValue === "string" ? e.defaultValue : "",
				}))
		: [];
	if (!Array.isArray(cfg.columns)) cfg.columns = [];
	return cfg;
}
