import type { FileImportConfig, PluginSettings, PropertyType } from "../types";
import type { InferenceOptions, ConversionOptions } from "../csv/typeInference";

export const TYPE_LABELS: Record<PropertyType, string> = {
	text: "Text",
	number: "Number",
	checkbox: "Checkbox",
	date: "Date",
	datetime: "Date & time",
	list: "List",
};

/** Short labels used on the type badges in the table header. */
export const TYPE_BADGES: Record<PropertyType, string> = {
	text: "Text",
	number: "Number",
	checkbox: "Yes/no",
	date: "Date",
	datetime: "Date & time",
	list: "List",
};

export function inferenceOptions(cfg: FileImportConfig, settings: PluginSettings): InferenceOptions {
	return {
		decimalSeparator: cfg.decimalSeparator,
		listSeparator: cfg.listSeparator,
		midnightAsDate: settings.midnightAsDate,
	};
}

export function conversionOptions(cfg: FileImportConfig): ConversionOptions {
	return { decimalSeparator: cfg.decimalSeparator, listSeparator: cfg.listSeparator, precision: cfg.numberPrecision };
}

export function delimiterLabel(d: string): string {
	switch (d) {
		case ",": return "comma";
		case ";": return "semicolon";
		case "\t": return "tab";
		case "|": return "pipe";
		default: return d;
	}
}

/** Preview of a column value template (simple `{{value}}` / `$value` substitution). */
export const LINK_TEMPLATE = "[[{{value}}]]";
