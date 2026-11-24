// Stored CSV fingerprints and last-run counts: sanitizing what comes back from disk, and the summary text.
import { describe, expect, it } from "vitest";
import { lastRunText, sanitizeFingerprint, sanitizeLastRun } from "../../src/import/fingerprint";

describe("sanitizeFingerprint", () => {
	it("keeps a complete fingerprint and drops extra fields", () => {
		expect(sanitizeFingerprint({ size: 1, mtime: 2, hash: "h", extra: true })).toEqual({ size: 1, mtime: 2, hash: "h" });
	});

	it("drops a fingerprint with any field missing or of the wrong type", () => {
		expect(sanitizeFingerprint(null)).toBeUndefined();
		expect(sanitizeFingerprint("x")).toBeUndefined();
		expect(sanitizeFingerprint({ mtime: 2, hash: "h" })).toBeUndefined();
		expect(sanitizeFingerprint({ size: 1, hash: "h" })).toBeUndefined();
		expect(sanitizeFingerprint({ size: 1, mtime: 2 })).toBeUndefined();
		expect(sanitizeFingerprint({ size: "1", mtime: 2, hash: "h" })).toBeUndefined();
		expect(sanitizeFingerprint({ size: 1, mtime: "2", hash: "h" })).toBeUndefined();
		expect(sanitizeFingerprint({ size: 1, mtime: 2, hash: 3 })).toBeUndefined();
	});
});

describe("sanitizeLastRun", () => {
	it("keeps finite counts and zeroes anything else", () => {
		expect(sanitizeLastRun({ created: 1, updated: 2, unchanged: 3, skipped: 4, failed: 5 })).toEqual({
			created: 1,
			updated: 2,
			unchanged: 3,
			skipped: 4,
			failed: 5,
		});
		expect(sanitizeLastRun({ created: "1", updated: Number.NaN, unchanged: Number.POSITIVE_INFINITY, skipped: null })).toEqual({
			created: 0,
			updated: 0,
			unchanged: 0,
			skipped: 0,
			failed: 0,
		});
	});

	it("drops counts that are not an object", () => {
		expect(sanitizeLastRun(undefined)).toBeUndefined();
		expect(sanitizeLastRun(null)).toBeUndefined();
		expect(sanitizeLastRun(7)).toBeUndefined();
	});
});

describe("lastRunText", () => {
	it("lists failed rows", () => {
		expect(lastRunText({ created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 2 })).toBe("2 failed");
		expect(lastRunText({ created: 1, updated: 0, unchanged: 0, skipped: 1, failed: 1 })).toBe("1 new · 1 skipped · 1 failed");
	});
});
