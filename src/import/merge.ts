import type { FrontmatterValue } from "../types";

function fnv1a(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}

function isEmpty(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	if (typeof value === "string") return value.trim() === "";
	if (Array.isArray(value)) return value.length === 0;
	return false;
}

function canon(value: unknown): string {
	if (value instanceof Date) return "s" + JSON.stringify(value.toISOString());
	if (Array.isArray(value)) return "a[" + value.map(canon).join(",") + "]";
	switch (typeof value) {
		case "number":
			return Number.isFinite(value) ? "n" + String(value) : "e";
		case "boolean":
			return "b" + String(value);
		case "string":
			return "s" + JSON.stringify(value.trim());
		default:
			return "s" + JSON.stringify(String(value));
	}
}

/** Stable short hash of a frontmatter value (normalized: numbers/booleans/strings/arrays, null/""/undefined/[] all equal "empty"). */
export function valueHash(value: unknown): string {
	return fnv1a(isEmpty(value) ? "empty" : canon(value));
}

export interface MergeInput {
	/** Current frontmatter of the existing note (as parsed by Obsidian). */
	existing: Record<string, unknown>;
	/** Values planned from the CSV row. Keys omitted because of emptyValues "omit" are absent. */
	planned: Record<string, FrontmatterValue>;
	/** All CSV-managed property names for this note (included columns + tags + source), incl. omitted ones. */
	managed: string[];
	/** Hashes of the values last imported into this note, or undefined for the first import / unknown. */
	snapshot: Record<string, string> | undefined;
	protectEdits: boolean;
	keepValuesOnEmpty: boolean;
	/**
	 * Fill-only keys (extra properties): written only when the existing value is empty or the key is missing;
	 * otherwise left alone, regardless of protectEdits / keepValuesOnEmpty. Their snapshot entry is the hash of
	 * the value written, or of the existing value.
	 */
	fillOnly?: string[];
}

export interface MergeResult {
	/** Properties to write (subset of managed). Values may be null (= empty property). */
	set: Record<string, FrontmatterValue>;
	/** Managed properties kept because the value was edited in Obsidian since the last import. */
	preserved: string[];
	/** New snapshot for this note: hash of the CSV value now considered imported, per managed property. */
	snapshot: Record<string, string>;
}

/**
 * Decide which managed properties to update. Never touches non-managed properties.
 * Rules per managed key k (planned value p = planned[k] ?? null, current c = existing[k]):
 * 1. keepValuesOnEmpty && p is empty && c is non-empty  -> keep c (no set); snapshot[k] keeps its previous entry if any.
 * 2. protectEdits && snapshot?.[k] !== undefined && valueHash(c) !== snapshot[k] -> preserved (user edited); snapshot keeps old entry.
 * 3. valueHash(c) !== valueHash(p) -> set[k] = p (when p is absent due to "omit" and c exists: do not delete; treat like rule 1).
 * Otherwise unchanged. snapshot[k] = valueHash(p) for keys set or already equal.
 */
export function mergeFrontmatter(input: MergeInput): MergeResult {
	const fill = new Set(input.fillOnly ?? []);
	const res: MergeResult = { set: {}, preserved: [], snapshot: {} };
	for (const k of fill) mergeFillOnly(k, input, res);
	for (const k of input.managed) if (!fill.has(k)) mergeManaged(k, input, res);
	return res;
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The planned value of `k`; null when it is absent (omitted empty value). */
function plannedValue(planned: Record<string, FrontmatterValue>, k: string): FrontmatterValue {
	return hasOwn(planned, k) ? (planned[k] ?? null) : null;
}

/** Fill-only key: written only when the existing value is empty, or missing while the plan has the key. */
function mergeFillOnly(k: string, input: MergeInput, res: MergeResult): void {
	const c = input.existing[k];
	const p = plannedValue(input.planned, k);
	if (isEmpty(c) && (!isEmpty(p) || (hasOwn(input.planned, k) && !hasOwn(input.existing, k)))) {
		res.set[k] = p;
		res.snapshot[k] = valueHash(p);
	} else {
		res.snapshot[k] = valueHash(c);
	}
}

/** Rule 1: an empty planned value leaves a non-empty current one alone (keepValuesOnEmpty, or the value was omitted). */
function keepsCurrentOnEmpty(k: string, p: FrontmatterValue, c: unknown, input: MergeInput): boolean {
	return isEmpty(p) && !isEmpty(c) && (input.keepValuesOnEmpty || !hasOwn(input.planned, k));
}

/** Managed key: the rules 1 to 3 of mergeFrontmatter. */
function mergeManaged(k: string, input: MergeInput, res: MergeResult): void {
	const p = plannedValue(input.planned, k);
	const c = input.existing[k];
	const prev = input.snapshot?.[k];
	if (keepsCurrentOnEmpty(k, p, c, input)) {
		if (prev !== undefined) res.snapshot[k] = prev;
		return;
	}
	const ph = valueHash(p);
	const ch = valueHash(c);
	if (ch === ph) {
		res.snapshot[k] = ph;
	} else if (input.protectEdits && prev !== undefined && ch !== prev) {
		res.preserved.push(k);
		res.snapshot[k] = prev;
	} else {
		res.set[k] = p;
		res.snapshot[k] = ph;
	}
}
