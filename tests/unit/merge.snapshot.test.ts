// Snapshot entries mergeFrontmatter records for kept values (complements merge.test.ts).
import { describe, expect, it } from "vitest";
import { mergeFrontmatter, valueHash } from "../../src/import/merge";

const base = { protectEdits: true, keepValuesOnEmpty: true };

describe("mergeFrontmatter snapshot", () => {
	it("a value kept because the CSV cell is empty records no entry when there was none", () => {
		const r = mergeFrontmatter({ ...base, existing: { a: "mine" }, planned: { a: null }, managed: ["a"], snapshot: undefined });
		expect(r.set).toEqual({});
		expect(Object.keys(r.snapshot)).toEqual([]);
	});

	it("a value kept because the CSV cell is empty keeps its previous entry", () => {
		const r = mergeFrontmatter({ ...base, existing: { a: "mine" }, planned: { a: null }, managed: ["a"], snapshot: { a: "old" } });
		expect(r.snapshot).toEqual({ a: "old" });
	});

	it("a fill-only property that stays empty records the empty value", () => {
		const r = mergeFrontmatter({ ...base, existing: { f: "" }, planned: { f: null }, managed: [], snapshot: undefined, fillOnly: ["f"] });
		expect(r.set).toEqual({});
		expect(r.snapshot).toEqual({ f: valueHash("") });
	});
});
