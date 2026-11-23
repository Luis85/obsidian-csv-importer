import type { FrontmatterValue, PlannedNote } from "../types";
import { formatValue } from "./noteBuilder";

/** Same normalization as Obsidian's `normalizePath` (kept local so this module stays pure). */
function normalizeVaultPath(path: string): string {
	let p = path.replace(/([\\/])+/g, "/").replace(/(^\/+|\/+$)/g, "");
	if (p === "") p = "/";
	return p.replace(/[\u00A0\u202F]/g, " ").normalize("NFC");
}

/** "[[Data/x.csv|alias]]" / "Data/X" -> "data/x" for comparing links to the CSV. Null for non-strings. */
export function normalizeLink(v: unknown): string | null {
	if (typeof v !== "string") return null;
	let s = v.trim();
	if (s.startsWith("[[") && s.endsWith("]]")) s = s.slice(2, -2);
	const bar = s.indexOf("|");
	if (bar >= 0) s = s.slice(0, bar);
	const hash = s.indexOf("#");
	if (hash >= 0) s = s.slice(0, hash);
	s = normalizeVaultPath(s.trim()).toLowerCase();
	return s.endsWith(".csv") ? s.slice(0, -4) : s;
}

function isEmptyValue(v: unknown): boolean {
	return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

export interface OwnershipInput {
	/** The note's path has an entry in the import snapshot. */
	hasSnapshotEntry: boolean;
	/** Frontmatter of the existing note. */
	frontmatter: Record<string, unknown> | undefined;
	/** Value the planned note has for the source-link property (undefined when there is none). */
	plannedLink: unknown;
	/** Property names under which a note may link to this CSV (current and legacy). */
	ownedLinkProps: readonly string[];
	/** config.adoptExistingNotes. */
	adopt: boolean;
}

/**
 * Whether an import may change an existing note: it is adopted, has a snapshot entry from a previous run, or
 * links to this CSV through one of the source-link properties.
 */
export function isOwned(input: OwnershipInput): boolean {
	if (input.adopt) return true;
	if (input.hasSnapshotEntry) return true;
	const planned = normalizeLink(input.plannedLink);
	if (planned === null) return false;
	return input.ownedLinkProps.some((p) => normalizeLink(input.frontmatter?.[p]) === planned);
}

/** True when the existing note has a scalar key value that differs from the planned note's key. */
export function hasOtherKey(frontmatter: Record<string, unknown> | undefined, key: PlannedNote["key"]): boolean {
	if (!key) return false;
	const v: unknown = frontmatter?.[key.property];
	if (isEmptyValue(v) || Array.isArray(v) || typeof v === "object") return false;
	return formatValue(v as FrontmatterValue) !== key.value;
}
