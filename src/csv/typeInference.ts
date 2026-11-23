import type { ColumnConfig, FrontmatterValue, ParsedCsv, PropertyType } from "../types";

export interface InferenceOptions {
	decimalSeparator: "." | ",";
	/** Infer `date` instead of `datetime` when all times are 00:00(:00). */
	midnightAsDate: boolean;
	listSeparator: string;
}

export interface ConversionOptions {
	decimalSeparator: "." | ",";
	listSeparator: string;
}

/** Infer the property type of a column from its raw (string) values. Empty values are ignored. */
export function inferColumnType(values: string[], opts: InferenceOptions): PropertyType {
	throw new Error("not implemented");
}

/** Convert a raw cell to a typed frontmatter value. Empty / unparseable -> null (never throws). */
export function convertValue(raw: string, type: PropertyType, opts: ConversionOptions): FrontmatterValue {
	throw new Error("not implemented");
}

/** Turn a header into a safe property name (trimmed, no YAML-hostile chars, non-empty). */
export function toPropertyName(header: string): string {
	throw new Error("not implemented");
}

/** Build fresh column configs (inferred types, all included) for a parsed CSV. */
export function buildColumnConfigs(parsed: ParsedCsv, opts: InferenceOptions): ColumnConfig[] {
	throw new Error("not implemented");
}

/**
 * Merge previously saved column configs with the current file structure:
 * columns matched by `source` header keep user choices (property/type/include) and get the new index;
 * new columns are inferred; columns no longer present are dropped. Result is ordered by index.
 */
export function reconcileColumns(existing: ColumnConfig[], parsed: ParsedCsv, opts: InferenceOptions): ColumnConfig[] {
	throw new Error("not implemented");
}
