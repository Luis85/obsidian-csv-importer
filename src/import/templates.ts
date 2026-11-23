import type { FrontmatterValue } from "../types";
import { formatNumber } from "../csv/typeInference";

export interface TemplateContext {
	headers: string[];
	row: string[];
	/** 1-based data row number. */
	rowNumber: number;
	/** CSV file basename without extension. */
	fileBasename: string;
	/** Optional display values per column (same indexes as headers); used instead of the raw cell when present. */
	formatted?: string[];
}

/** String form of a converted value (date ISO, number normalized, boolean true/false). */
export function formatValue(value: FrontmatterValue): string {
	if (value === null) return "";
	if (typeof value === "number") return formatNumber(value);
	if (Array.isArray(value)) return value.join(", ");
	return String(value);
}

type Seg = string | { col: number } | { row: true } | { file: true } | { value: true };
export type CompiledTemplate = Seg[];

/** First-occurrence index of each header (duplicate headers resolve to the leftmost column). */
export function headerIndexOf(headers: string[]): Map<string, number> {
	const map = new Map<string, number>();
	headers.forEach((h, i) => {
		if (!map.has(h)) map.set(h, i);
	});
	return map;
}

/**
 * Parse a template once into literal strings and placeholders (column indexes resolved via `headerIndex`).
 * Placeholders are `{{Header}}`, `{{row}}`, `{{file}}` (whitespace inside braces trimmed; `row` and `file` take
 * precedence over headers of the same name); unknown names render as "". With `withValue`, `{{value}}` and `$value`
 * become the value slot.
 */
export function compileTemplate(template: string, headerIndex: Map<string, number>, withValue = false): CompiledTemplate {
	const re = withValue ? /\{\{([^{}]*)\}\}|\$value/g : /\{\{([^{}]*)\}\}/g;
	const out: CompiledTemplate = [];
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(template)) !== null) {
		if (m.index > last) out.push(template.slice(last, m.index));
		const key = m[1]?.trim();
		if (key === undefined || (withValue && key === "value")) out.push({ value: true });
		else if (key === "row") out.push({ row: true });
		else if (key === "file") out.push({ file: true });
		else {
			const idx = headerIndex.get(key);
			if (idx !== undefined) out.push({ col: idx });
		}
		last = m.index + m[0].length;
	}
	if (last < template.length) out.push(template.slice(last));
	return out;
}

/** Render a compiled template for one row; `value` fills the value slot. */
export function renderCompiled(c: CompiledTemplate, ctx: TemplateContext, value = ""): string {
	if (c.length === 1 && typeof c[0] === "string") return c[0];
	let out = "";
	for (const seg of c) {
		if (typeof seg === "string") out += seg;
		else if ("col" in seg) out += (ctx.formatted?.[seg.col] ?? ctx.row[seg.col] ?? "").trim();
		else if ("row" in seg) out += String(ctx.rowNumber);
		else if ("file" in seg) out += ctx.fileBasename;
		else out += value;
	}
	return out;
}

/**
 * Replace `{{Header}}`, `{{row}}`, `{{file}}` (case-sensitive headers, whitespace inside braces trimmed). Unknown -> "".
 * The reserved names `row` and `file` take precedence over headers of the same name.
 */
export function renderTemplate(template: string, ctx: TemplateContext): string {
	return renderCompiled(compileTemplate(template, headerIndexOf(ctx.headers)), ctx);
}

/**
 * Apply a column value template to a converted value. `{{value}}`/`$value` is the formatted value;
 * `{{Header}}`, `{{row}}`, `{{file}}` as in renderTemplate. Lists: per item. Null stays null.
 */
export function applyValueTemplate(template: string, value: FrontmatterValue, ctx: TemplateContext): FrontmatterValue {
	if (value === null || template === "") return value;
	const compiled = compileTemplate(template, headerIndexOf(ctx.headers), true);
	if (Array.isArray(value)) return value.map((v) => renderCompiled(compiled, ctx, v));
	return renderCompiled(compiled, ctx, formatValue(value));
}
