import { describe, expect, it, vi } from "vitest";
import { ConfigStore } from "../src/configStore";
import type { FileImportConfig } from "../src/types";
import { cfg } from "./helpers/harness";

function make(initial?: Record<string, FileImportConfig>) {
	const persist = vi.fn(() => Promise.resolve());
	return { store: new ConfigStore(initial, persist), persist };
}

describe("ConfigStore", () => {
	it("starts empty without initial data", () => {
		const { store } = make();
		expect(store.paths()).toEqual([]);
		expect(store.paths().length).toBe(0);
		expect(store.has("a.csv")).toBe(false);
		expect(store.get("a.csv")).toBeUndefined();
		expect(store.toRecord()).toEqual({});
	});

	it("clones the initial record on the way in", () => {
		const initial = { "a.csv": cfg({ tags: "x" }) };
		const { store } = make(initial);
		initial["a.csv"].tags = "changed";
		expect(store.get("a.csv")?.tags).toBe("x");
	});

	it("set stores a clone and persists", async () => {
		const { store, persist } = make();
		const c = cfg({ tags: "one", columns: [{ source: "A", index: 0, property: "A", type: "text", include: true }] });
		await store.set("a.csv", c);
		expect(persist).toHaveBeenCalledTimes(1);
		c.tags = "mutated";
		c.columns[0]!.property = "mutated";
		expect(store.get("a.csv")?.tags).toBe("one");
		expect(store.get("a.csv")?.columns[0]!.property).toBe("A");
		expect(store.paths().length).toBe(1);
		expect(store.has("a.csv")).toBe(true);
	});

	it("get returns an independent clone each time", async () => {
		const { store } = make();
		await store.set("a.csv", cfg({ tags: "one" }));
		const first = store.get("a.csv")!;
		first.tags = "mutated";
		first.columns.push({ source: "Z", index: 0, property: "Z", type: "text", include: true });
		const second = store.get("a.csv")!;
		expect(second.tags).toBe("one");
		expect(second.columns).toEqual([]);
		expect(second).not.toBe(store.get("a.csv"));
	});

	it("set overwrites an existing path", async () => {
		const { store } = make();
		await store.set("a.csv", cfg({ tags: "one" }));
		await store.set("a.csv", cfg({ tags: "two" }));
		expect(store.get("a.csv")?.tags).toBe("two");
		expect(store.paths().length).toBe(1);
	});

	it("has ignores inherited object properties", () => {
		const { store } = make();
		expect(store.has("toString")).toBe(false);
		expect(store.get("constructor")).toBeUndefined();
	});

	it("toRecord returns a deep snapshot", async () => {
		const { store } = make({ "a.csv": cfg({ tags: "x" }) });
		const rec = store.toRecord();
		rec["a.csv"]!.tags = "mutated";
		delete rec["a.csv"];
		expect(store.get("a.csv")?.tags).toBe("x");
		expect(store.paths()).toEqual(["a.csv"]);
	});

	describe("rename", () => {
		it("moves a config and persists", async () => {
			const { store, persist } = make({ "a.csv": cfg({ tags: "x" }) });
			expect(await store.rename("a.csv", "b.csv")).toBe(true);
			expect(persist).toHaveBeenCalledTimes(1);
			expect(store.has("a.csv")).toBe(false);
			expect(store.get("b.csv")?.tags).toBe("x");
		});

		it("returns false and does not persist for same path or unknown source", async () => {
			const { store, persist } = make({ "a.csv": cfg() });
			expect(await store.rename("a.csv", "a.csv")).toBe(false);
			expect(await store.rename("missing.csv", "b.csv")).toBe(false);
			expect(persist).not.toHaveBeenCalled();
			expect(store.paths()).toEqual(["a.csv"]);
		});

		it("replaces an existing config at the target path", async () => {
			const { store } = make({ "a.csv": cfg({ tags: "from-a" }), "b.csv": cfg({ tags: "from-b" }) });
			expect(await store.rename("a.csv", "b.csv")).toBe(true);
			expect(store.get("b.csv")?.tags).toBe("from-a");
			expect(store.paths()).toEqual(["b.csv"]);
		});
	});

	describe("renameFolder", () => {
		it("moves every config below the folder, including nested ones", async () => {
			const { store, persist } = make({
				"Old/a.csv": cfg({ tags: "a" }),
				"Old/sub/b.csv": cfg({ tags: "b" }),
				"Other/c.csv": cfg({ tags: "c" }),
			});
			expect(await store.renameFolder("Old", "New")).toBe(true);
			expect(persist).toHaveBeenCalledTimes(1);
			expect(store.paths().sort()).toEqual(["New/a.csv", "New/sub/b.csv", "Other/c.csv"]);
			expect(store.get("New/sub/b.csv")?.tags).toBe("b");
		});

		it("does not match folders that merely share a name prefix", async () => {
			const { store, persist } = make({ "Older/a.csv": cfg(), "Old.csv": cfg() });
			expect(await store.renameFolder("Old", "New")).toBe(false);
			expect(persist).not.toHaveBeenCalled();
			expect(store.paths().sort()).toEqual(["Old.csv", "Older/a.csv"]);
		});

		it("returns false when nothing is below the folder", async () => {
			const { store, persist } = make();
			expect(await store.renameFolder("Old", "New")).toBe(false);
			expect(persist).not.toHaveBeenCalled();
		});
	});

	describe("delete and clear", () => {
		it("delete removes and persists, or returns false for unknown paths", async () => {
			const { store, persist } = make({ "a.csv": cfg(), "b.csv": cfg() });
			expect(await store.delete("nope.csv")).toBe(false);
			expect(persist).not.toHaveBeenCalled();
			expect(await store.delete("a.csv")).toBe(true);
			expect(persist).toHaveBeenCalledTimes(1);
			expect(store.paths()).toEqual(["b.csv"]);
		});

		it("clear empties the store and persists", async () => {
			const { store, persist } = make({ "a.csv": cfg(), "b.csv": cfg() });
			await store.clear();
			expect(persist).toHaveBeenCalledTimes(1);
			expect(store.paths().length).toBe(0);
			expect(store.toRecord()).toEqual({});
		});
	});

	it("propagates persist failures", async () => {
		const store = new ConfigStore(undefined, () => Promise.reject(new Error("disk full")));
		await expect(store.set("a.csv", cfg())).rejects.toThrow("disk full");
	});
});
