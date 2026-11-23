import { App, PluginSettingTab } from "obsidian";
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
	midnightAsDate: true,
	registerPropertyTypes: true,
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
		columns: [],
		lastImport: null,
	};
}
