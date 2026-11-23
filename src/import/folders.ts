import type { FileImportConfig } from "../types";
import { compileTemplate, headerIndexOf, renderCompiled, type CompiledTemplate, type TemplateContext } from "./templates";

const RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_NAME_BYTES = 240;
const PLACEHOLDER_RE = /\{\{[^{}]*\}\}/;

/** Truncate to at most `max` UTF-8 bytes without splitting a code point (surrogate pair). */
function truncateUtf8(s: string, max: number): string {
	let bytes = 0;
	let i = 0;
	while (i < s.length) {
		const cp = s.codePointAt(i) as number;
		const len = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
		if (bytes + len > max) break;
		bytes += len;
		i += cp > 0xffff ? 2 : 1;
	}
	return s.slice(0, i);
}

/**
 * Make a string safe as an Obsidian file name: strip \ / : * ? " < > | # ^ [ ] and control chars, collapse whitespace,
 * trim dots/spaces, normalize to NFC, truncate to 240 UTF-8 bytes (callers add the suffix and ".md"), and prefix
 * Windows reserved names (CON, NUL, COM1...) with "_". Empty -> "".
 */
export function sanitizeFileName(name: string): string {
	const clean = (s: string) =>
		s
			// eslint-disable-next-line no-control-regex -- stripping control characters is intended
			.replace(/[\u0000-\u001f\u007f]/g, " ")
			.replace(/[\\/:*?"<>|#^[\]]/g, "")
			.replace(/\s+/g, " ")
			.replace(/^[\s.]+|[\s.]+$/g, "");
	let s = clean(name).normalize("NFC");
	if (s.length > MAX_NAME_BYTES / 3) s = clean(truncateUtf8(s, MAX_NAME_BYTES));
	if (RESERVED_NAME_RE.test(s)) s = "_" + s;
	return s;
}

/** True when the configured target folder contains `{{...}}` placeholders. */
export function hasFolderPlaceholders(config: FileImportConfig): boolean {
	return PLACEHOLDER_RE.test(config.targetFolder);
}

/** Static part of a folder template: everything before the first placeholder, cut back to a whole path segment, no trailing slash. */
export function staticPrefix(folder: string): string {
	const i = folder.indexOf("{{");
	const head = i < 0 ? folder : folder.slice(0, i);
	return i < 0 ? head : head.replace(/\/[^/]*$/, "");
}

function splitPath(p: string): string[] {
	return p.replace(/\\/g, "/").split("/").filter((x) => x !== "");
}

/** Split a configured static folder and reject anything that could leave the vault ("..", "C:\\"). */
function splitTargetFolder(raw: string): string[] {
	const t = raw.trim();
	const segs = splitPath(t);
	if (/^[a-zA-Z]:/.test(t) || segs.some((seg) => seg === "..")) {
		throw new Error(`The target folder must be inside the vault: ${raw.trim()}`);
	}
	return segs;
}

function defaultFolder(csvPath: string): string {
	const parts = splitPath(csvPath);
	const file = parts.pop() ?? "";
	const dot = file.lastIndexOf(".");
	const base = dot > 0 ? file.slice(0, dot) : file;
	return [...parts, base].join("/");
}

/**
 * Resolve the target folder: config.targetFolder (normalized, no leading/trailing slash; "/" means vault root)
 * or, when blank, `<csv dir>/<csv basename>`. Placeholders are left as written (see resolveRowFolder).
 */
export function resolveTargetFolder(config: FileImportConfig, csvPath: string): string {
	if (config.targetFolder.trim() !== "") return splitTargetFolder(config.targetFolder).join("/");
	return defaultFolder(csvPath);
}

/** Target folder split into path segments; segments with placeholders are compiled, others stay literal. */
export type FolderSegments = (string | CompiledTemplate)[];

export function compileFolderSegments(targetFolder: string, headerIndex: Map<string, number>): FolderSegments {
	return splitTargetFolder(targetFolder).map((seg) => (PLACEHOLDER_RE.test(seg) ? compileTemplate(seg, headerIndex) : seg));
}

/** Render pre-compiled folder segments for one row: each rendered segment is sanitized, empty segments are dropped. */
export function renderFolderSegments(segs: FolderSegments, ctx: TemplateContext): string {
	const parts: string[] = [];
	for (const seg of segs) {
		const v = typeof seg === "string" ? seg : sanitizeFileName(renderCompiled(seg, ctx));
		if (v !== "") parts.push(v);
	}
	return parts.join("/");
}

/**
 * Like resolveTargetFolder but renders `{{Column}}`, `{{row}}`, `{{file}}` placeholders per row.
 * Each path segment is rendered separately and sanitized with sanitizeFileName; empty segments are dropped.
 */
export function resolveRowFolder(config: FileImportConfig, csvPath: string, ctx: TemplateContext): string {
	const t = config.targetFolder.trim();
	if (t === "") return defaultFolder(csvPath);
	return renderFolderSegments(compileFolderSegments(t, headerIndexOf(ctx.headers)), ctx);
}
