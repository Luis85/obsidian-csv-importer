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
	const { existing, planned, managed, snapshot, protectEdits, keepValuesOnEmpty } = input;
	const fill = new Set(input.fillOnly ?? []);
	const set: Record<string, FrontmatterValue> = {};
	const preserved: string[] = [];
	const out: Record<string, string> = {};
	const keepOld = (k: string) => {
		const prev = snapshot?.[k];
		if (prev !== undefined) out[k] = prev;
	};
	for (const k of fill) {
		const c = existing[k];
		const p: FrontmatterValue = Object.prototype.hasOwnProperty.call(planned, k) ? planned[k] : null;
		if (!isEmpty(c)) {
			out[k] = valueHash(c);
		} else if (!isEmpty(p) || (Object.prototype.hasOwnProperty.call(planned, k) && !Object.prototype.hasOwnProperty.call(existing, k))) {
			set[k] = p;
			out[k] = valueHash(p);
		} else {
			out[k] = valueHash(c);
		}
	}
	for (const k of managed) {
		if (fill.has(k)) continue;
		const has = Object.prototype.hasOwnProperty.call(planned, k);
		const p: FrontmatterValue = has ? planned[k] : null;
		const c = existing[k];
		const pEmpty = isEmpty(p);
		const cEmpty = isEmpty(c);
		if (pEmpty && !cEmpty && (keepValuesOnEmpty || !has)) {
			keepOld(k);
			continue;
		}
		const ph = valueHash(p);
		const ch = valueHash(c);
		if (ch === ph) {
			out[k] = ph;
			continue;
		}
		const prev = snapshot?.[k];
		if (protectEdits && prev !== undefined && ch !== prev) {
			preserved.push(k);
			out[k] = prev;
			continue;
		}
		set[k] = p;
		out[k] = ph;
	}
	return { set, preserved, snapshot: out };
}
