import type { FileImportConfig, FrontmatterValue, ParsedCsv, PlannedNote } from "../types";

export interface TemplateContext {
	headers: string[];
	row: string[];
	/** 1-based data row number. */
	rowNumber: number;
	/** CSV file basename without extension. */
	fileBasename: string;
}

/** Replace `{{Header}}`, `{{row}}`, `{{file}}` (case-sensitive headers, whitespace inside braces trimmed). Unknown -> "". */
export function renderTemplate(template: string, ctx: TemplateContext): string {
	throw new Error("not implemented");
}

/** Make a string safe as an Obsidian file name: strip \ / : * ? " < > | # ^ [ ] and control chars, collapse whitespace, trim dots/spaces, max 200 chars. Empty -> "". */
export function sanitizeFileName(name: string): string {
	throw new Error("not implemented");
}

/** Resolve the target folder: config.targetFolder (normalized, no leading/trailing slash) or `<csv dir>/<csv basename>`. */
export function resolveTargetFolder(config: FileImportConfig, csvPath: string): string {
	throw new Error("not implemented");
}

/**
 * Plan one note per data row. Frontmatter contains included columns (typed via convertValue),
 * `tags` (when config.tags non-empty, merged with a `tags` column if present), and
 * `source: "[[path/to/file.csv]]"` when addSourceLink. Null values are kept (empty property).
 * Empty file names fall back to `<file> <row>`. Duplicate paths within one run get " 2", " 3" suffixes.
 */
export function planNotes(
	parsed: ParsedCsv,
	config: FileImportConfig,
	csv: { path: string; basename: string },
): PlannedNote[] {
	throw new Error("not implemented");
}

/** Serialize frontmatter as YAML (`---` fenced) followed by body. Strings are quoted when needed so they are never re-interpreted as numbers/booleans/dates. */
export function serializeNote(frontmatter: Record<string, FrontmatterValue>, body: string): string {
	throw new Error("not implemented");
}
