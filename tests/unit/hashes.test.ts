// Hashes that are persisted in data.json must not change between versions: snapshot hashes drive edit protection
// on re-import, CSV fingerprints drive "changed since the last import". A different hash for the same input would
// make every note look edited (or every CSV changed) after an update, so the exact values are pinned here.
import { describe, expect, it } from "vitest";
import { hashBytes } from "../../src/import/fingerprint";
import { valueHash } from "../../src/import/merge";

describe("persisted hashes are stable", () => {
	it("hashBytes (CSV fingerprints)", () => {
		expect(hashBytes(new Uint8Array([]))).toBe("ztntfp");
		expect(hashBytes(new TextEncoder().encode("a,b\n1,2\n"))).toBe("1huqn6p");
	});

	it("valueHash (import snapshots)", () => {
		expect(valueHash("x")).toBe("t84u72");
		expect(valueHash(5)).toBe("2a0fv0");
		expect(valueHash(Number.NaN)).toBe("1q5y3fk");
		expect(valueHash(true)).toBe("jrcbut");
		expect(valueHash(["a", 1])).toBe("fz08gv");
		expect(valueHash(new Date(0))).toBe("1vxuvxd");
		expect(valueHash({ a: 1 })).toBe("1w30m7m");
	});

	it("valueHash treats all empty values alike and ignores surrounding whitespace", () => {
		for (const v of [null, undefined, "", "   ", []]) expect(valueHash(v)).toBe("6u9vqm");
		expect(valueHash(" x ")).toBe(valueHash("x"));
	});

	it("valueHash keeps types apart", () => {
		expect(valueHash("5")).not.toBe(valueHash(5));
		expect(valueHash("true")).not.toBe(valueHash(true));
		expect(valueHash(["a"])).not.toBe(valueHash("a"));
		expect(valueHash(["a,b"])).not.toBe(valueHash(["a", "b"]));
	});
});
