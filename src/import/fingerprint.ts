import type { CsvFingerprint, ImportResult, LastRunCounts } from "../types";

/** FNV-1a over bytes, base 36. Fast enough for large CSV files; not a security hash. */
export function hashBytes(bytes: Uint8Array): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < bytes.length; i++) {
		h ^= bytes[i] as number;
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}

/** Fingerprint of a file's current bytes and stat. */
export function makeFingerprint(data: ArrayBuffer, stat: { size: number; mtime: number }): CsvFingerprint {
	return { size: stat.size, mtime: stat.mtime, hash: hashBytes(new Uint8Array(data)) };
}

/** Accepts what is stored on disk and drops anything malformed (a missing fingerprint means "changed"). */
export function sanitizeFingerprint(raw: unknown): CsvFingerprint | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Partial<CsvFingerprint>;
	if (typeof r.size !== "number" || typeof r.mtime !== "number" || typeof r.hash !== "string") return undefined;
	return { size: r.size, mtime: r.mtime, hash: r.hash };
}

export interface ChangeCheck {
	changed: boolean;
	/** Set when only the modification time differed (content equal): the stored fingerprint can be refreshed. */
	touched?: CsvFingerprint;
}

/**
 * Whether a CSV differs from what was imported. Size and mtime are compared first; the file is only read and
 * hashed when one of them differs. A missing fingerprint (import from before this feature) counts as changed.
 */
export async function checkChanged(
	fp: CsvFingerprint | undefined,
	stat: { size: number; mtime: number },
	readHash: () => Promise<string>,
): Promise<ChangeCheck> {
	if (!fp) return { changed: true };
	if (fp.size === stat.size && fp.mtime === stat.mtime) return { changed: false };
	if (fp.size !== stat.size) return { changed: true };
	const hash = await readHash();
	if (hash === fp.hash) return { changed: false, touched: { size: stat.size, mtime: stat.mtime, hash } };
	return { changed: true };
}

/** Counts of a finished import for the index. */
export function lastRunOf(result: ImportResult): LastRunCounts {
	return { created: result.created, updated: result.updated, unchanged: result.unchanged, skipped: result.skipped, failed: result.failed };
}

/** "12 new · 5 updated · 120 unchanged · 2 skipped"; zero parts are left out, "nothing imported" when all are zero. */
export function lastRunText(c: LastRunCounts): string {
	const parts: string[] = [];
	if (c.created) parts.push(`${c.created} new`);
	if (c.updated) parts.push(`${c.updated} updated`);
	if (c.unchanged) parts.push(`${c.unchanged} unchanged`);
	if (c.skipped) parts.push(`${c.skipped} skipped`);
	if (c.failed) parts.push(`${c.failed} failed`);
	return parts.length > 0 ? parts.join(" · ") : "Nothing imported";
}

/** Sanitizes stored counts. */
export function sanitizeLastRun(raw: unknown): LastRunCounts | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	const n = (k: string): number => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k]) : 0);
	return { created: n("created"), updated: n("updated"), unchanged: n("unchanged"), skipped: n("skipped"), failed: n("failed") };
}
