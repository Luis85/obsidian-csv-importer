import type { FrontmatterValue, PropertyType } from "../types";
import { formatNumber } from "../csv/typeInference";

const PLAIN_KEY_RE = /^[\p{L}_][\p{L}\p{N} _.()/&+-]*$/u;
const RESERVED_KEY_RE = /^(?:true|false|yes|no|y|n|on|off|null)$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
// eslint-disable-next-line no-control-regex -- detecting control characters is intended
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/;
const AMBIGUOUS_RES: RegExp[] = [
	/^[-+]?(?:\.\d+|\d[\d_]*(?:\.[\d_]*)?)(?:[eE][-+]?\d+)?$/,
	/^0(?:x[0-9a-f_]+|o[0-7_]+|b[01_]+)$/i,
	/^[-+]?\.(?:inf|nan)$/i,
	/^[-+]?\d+(?::[0-5]?\d)+(?:\.\d*)?$/,
	/^(?:true|false|yes|no|on|off|y|n|null|~|<<|=)$/i,
	/^\d{4}-\d{1,2}-\d{1,2}(?:$|[Tt\s])/,
];

function quote(s: string): string {
	return JSON.stringify(s.replace(/\r\n?/g, "\n")).replace(
		/[\u007f-\u009f\u2028\u2029\ufeff]/g,
		(c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
	);
}

function yamlString(s: string, dateLike: boolean): string {
	if (dateLike && (ISO_DATE_RE.test(s) || ISO_DATETIME_RE.test(s))) return s;
	return needsQuotes(s) ? quote(s) : s;
}

/** Whether YAML would misread `s` as a plain scalar (empty, padded, indicator first, `: `, ` #`, or a non-string). */
function needsQuotes(s: string): boolean {
	if (s === "" || s !== s.trim() || s.endsWith(":")) return true;
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) || s.includes(": ") || s.includes(" #")) return true;
	return CONTROL_RE.test(s) || AMBIGUOUS_RES.some((re) => re.test(s));
}

function yamlKey(k: string): string {
	if (PLAIN_KEY_RE.test(k) && k === k.trim() && !RESERVED_KEY_RE.test(k)) return k;
	return quote(k);
}

/** Appends the YAML lines of one property (key `k` already quoted as needed) to `lines`. */
function propertyLines(lines: string[], k: string, value: FrontmatterValue | undefined, dateLike: boolean): void {
	if (value === null || value === undefined) lines.push(`${k}:`);
	else if (typeof value === "number") lines.push(Number.isFinite(value) ? `${k}: ${formatNumber(value)}` : `${k}:`);
	else if (typeof value === "boolean") lines.push(`${k}: ${value}`);
	else if (!Array.isArray(value)) lines.push(`${k}: ${yamlString(value, dateLike)}`);
	else if (value.length === 0) lines.push(`${k}: []`);
	else {
		lines.push(`${k}:`);
		for (const item of value) lines.push(`  - ${yamlString(String(item), false)}`);
	}
}

/**
 * Serialize frontmatter as YAML (`---` fenced, LF only) followed by body. Typed scalars (numbers, booleans)
 * are plain; strings are quoted only when YAML would otherwise misread them. With `types`, ISO date/datetime
 * strings stay unquoted for date/datetime keys and are quoted for all other keys.
 */
export function serializeNote(
	frontmatter: Record<string, FrontmatterValue>,
	body: string,
	types?: Record<string, PropertyType>,
): string {
	const lines: string[] = [];
	for (const [key, value] of Object.entries(frontmatter)) {
		const t = types?.[key];
		propertyLines(lines, yamlKey(key), value, t === "date" || t === "datetime");
	}
	const head = lines.length > 0 ? `---\n${lines.join("\n")}\n---\n` : "---\n---\n";
	if (body === "") return head;
	const b = body.replace(/\r\n?/g, "\n");
	return head + (b.endsWith("\n") ? b : b + "\n");
}
