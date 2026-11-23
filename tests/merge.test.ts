import { describe, expect, it } from "vitest";
import { mergeFrontmatter, valueHash } from "../src/import/merge";

type In = Parameters<typeof mergeFrontmatter>[0];
function run(over: Partial<In>) {
	return mergeFrontmatter({
		existing: {},
		planned: {},
		managed: [],
		snapshot: undefined,
		protectEdits: true,
		keepValuesOnEmpty: true,
		...over,
	});
}

describe("valueHash", () => {
	it("treats null/undefined/''/[] as empty", () => {
		const h = valueHash(null);
		expect(valueHash(undefined)).toBe(h);
		expect(valueHash("")).toBe(h);
		expect(valueHash("  ")).toBe(h);
		expect(valueHash([])).toBe(h);
	});
	it("keeps types distinct", () => {
		expect(valueHash(5)).not.toBe(valueHash("5"));
		expect(valueHash(true)).not.toBe(valueHash("true"));
		expect(valueHash(0)).not.toBe(valueHash(null));
		expect(valueHash(false)).not.toBe(valueHash(null));
	});
	it("trims strings, compares arrays in order", () => {
		expect(valueHash(" a ")).toBe(valueHash("a"));
		expect(valueHash(["a", "b"])).toBe(valueHash(["a", "b"]));
		expect(valueHash(["a", "b"])).not.toBe(valueHash(["b", "a"]));
		expect(valueHash(["a,b"])).not.toBe(valueHash(["a", "b"]));
	});
	it("dates hash as ISO strings", () => {
		const d = new Date("2024-01-02T03:04:05.000Z");
		expect(valueHash(d)).toBe(valueHash("2024-01-02T03:04:05.000Z"));
	});
});

describe("mergeFrontmatter", () => {
	it("never touches properties added in Obsidian", () => {
		const r = run({ existing: { a: 1, extra: "x" }, planned: { a: 2 }, managed: ["a"], snapshot: { a: valueHash(1) } });
		expect(r.set).toEqual({ a: 2 });
		expect(Object.keys(r.snapshot)).toEqual(["a"]);
	});
	it("sets changed CSV value when not edited", () => {
		const r = run({ existing: { a: "old" }, planned: { a: "new" }, managed: ["a"], snapshot: { a: valueHash("old") } });
		expect(r.set).toEqual({ a: "new" });
		expect(r.preserved).toEqual([]);
		expect(r.snapshot.a).toBe(valueHash("new"));
	});
	it("preserves user edits with protectEdits", () => {
		const r = run({ existing: { a: "mine" }, planned: { a: "new" }, managed: ["a"], snapshot: { a: valueHash("old") } });
		expect(r.set).toEqual({});
		expect(r.preserved).toEqual(["a"]);
		expect(r.snapshot.a).toBe(valueHash("old"));
	});
	it("CSV wins when protectEdits is off", () => {
		const r = run({ protectEdits: false, existing: { a: "mine" }, planned: { a: "new" }, managed: ["a"], snapshot: { a: valueHash("old") } });
		expect(r.set).toEqual({ a: "new" });
		expect(r.preserved).toEqual([]);
	});
	it("CSV wins without snapshot", () => {
		const r = run({ existing: { a: "mine" }, planned: { a: "new" }, managed: ["a"] });
		expect(r.set).toEqual({ a: "new" });
		expect(r.preserved).toEqual([]);
	});
	it("empty CSV cell keeps existing value with keepValuesOnEmpty", () => {
		const r = run({ existing: { a: "v" }, planned: { a: null }, managed: ["a"], snapshot: { a: valueHash("v") } });
		expect(r.set).toEqual({});
		expect(r.snapshot.a).toBe(valueHash("v"));
	});
	it("empty CSV cell clears value without keepValuesOnEmpty", () => {
		const r = run({ keepValuesOnEmpty: false, existing: { a: "v" }, planned: { a: null }, managed: ["a"], snapshot: { a: valueHash("v") } });
		expect(r.set).toEqual({ a: null });
	});
	it("omitted key never deletes", () => {
		const r = run({ keepValuesOnEmpty: false, existing: { a: "v" }, planned: {}, managed: ["a"] });
		expect(r.set).toEqual({});
	});
	it("omitted key and missing property: nothing", () => {
		const r = run({ existing: {}, planned: {}, managed: ["a"] });
		expect(r.set).toEqual({});
		expect(r.preserved).toEqual([]);
	});
	it("equal values are unchanged", () => {
		const r = run({ existing: { a: 5, b: ["x", "y"], c: "t" }, planned: { a: 5, b: ["x", "y"], c: " t" }, managed: ["a", "b", "c"], snapshot: {} });
		expect(r.set).toEqual({});
		expect(r.snapshot.a).toBe(valueHash(5));
	});
	it("fills an empty existing property from CSV", () => {
		const r = run({ existing: { a: null }, planned: { a: "v" }, managed: ["a"], snapshot: { a: valueHash(null) } });
		expect(r.set).toEqual({ a: "v" });
	});
	it("snapshot stays consistent across consecutive re-imports (edit detection on 3rd import)", () => {
		const managed = ["a", "b"];
		// import 1: first import wrote CSV values
		let note: Record<string, unknown> = { a: "A1", b: "B1" };
		let snap: Record<string, string> | undefined = { a: valueHash("A1"), b: valueHash("B1") };
		// user edits b; import 2: CSV changes a only
		note = { ...note, b: "mine" };
		const r2 = run({ existing: note, planned: { a: "A2", b: "B1" }, managed, snapshot: snap });
		expect(r2.set).toEqual({ a: "A2" });
		expect(r2.preserved).toEqual(["b"]);
		note = { ...note, ...r2.set };
		snap = r2.snapshot;
		// import 3: CSV changes both; user edit of b still detected, a updated
		const r3 = run({ existing: note, planned: { a: "A3", b: "B3" }, managed, snapshot: snap });
		expect(r3.set).toEqual({ a: "A3" });
		expect(r3.preserved).toEqual(["b"]);
		note = { ...note, ...r3.set };
		// import 4: user edit of a (a then differs from snapshot)
		note = { ...note, a: "edited" };
		const r4 = run({ existing: note, planned: { a: "A4", b: "B3" }, managed, snapshot: r3.snapshot });
		expect(r4.preserved.sort()).toEqual(["a", "b"]);
	});
});
