import type { DelimiterOption, ParsedCsv } from "../types";

/** Guess the delimiter by consistency of field counts across the first lines (quote-aware). */
export function detectDelimiter(text: string): Exclude<DelimiterOption, "auto"> {
	throw new Error("not implemented");
}

/**
 * RFC 4180 parser: quoted fields, escaped quotes (""), embedded delimiters/newlines,
 * CRLF/LF/CR line endings, UTF-8 BOM stripped, trailing empty lines ignored.
 * Headers are trimmed, made non-empty ("Column N") and unique ("Name", "Name 2").
 */
export function parseCsv(text: string, opts: { delimiter: DelimiterOption; hasHeader: boolean }): ParsedCsv {
	throw new Error("not implemented");
}
