import type { FileImportConfig, PluginSettings } from "../types";
import type { InferenceOptions, ConversionOptions } from "../csv/typeInference";
import { conversionOptionsOf, inferenceOptionsOf } from "../csv/typeInference";

/** Column value template that turns a value into a wiki link. */
export const LINK_TEMPLATE = "[[{{value}}]]";

/** Inference options for a file config (UI wrapper around the core builder). */
export function inferenceOptions(cfg: FileImportConfig, settings: PluginSettings): InferenceOptions {
	return inferenceOptionsOf(cfg, settings.midnightAsDate);
}

/** Conversion options for a file config (UI wrapper around the core builder). */
export function conversionOptions(cfg: FileImportConfig): ConversionOptions {
	return conversionOptionsOf(cfg);
}
