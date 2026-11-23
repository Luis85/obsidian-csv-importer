import { describe, expect, it } from "vitest";
import { ImportStorage } from "../src/storage";
import type { UndoManifest } from "../src/types";
import { MockApp } from "./mocks/obsidian";
import type { App } from "obsidian";

const DIR = "plugins/csv/imports";
const manifest = (csvPath: string, created: string[] = ["n/1.md"]): UndoManifest => ({
	csvPath,
	timestamp: 1,
	created,
	modified: [{ path: "n/2.md", content: "old" }],
	writtenHashes: { "n/1.md": "h" },
});

function make() {
	const app = new MockApp();
	const mk = () => new ImportStorage(app as unknown as App, "plugins/csv");
	return { app, mk };
}

describe("ImportStorage layout and lazy loading", () => {
	it("stores snapshot, undo and index in separate files", async () => {
		const { app, mk } = make();
		const s = mk();
		await s.saveSnapshot("a.csv", { "n/1.md": { x: "1" } });
		await s.saveUndo("a.csv", manifest("a.csv"));
		const keys = [...app.vault.adapter.data.keys()].map((k) => k.slice(DIR.length + 1));
		expect(keys.filter((k) => k === "index.json")).toHaveLength(1);
		expect(keys.filter((k) => k.endsWith(".undo.json"))).toHaveLength(1);
		expect(keys.filter((k) => /^[0-9a-f]{14}\.json$/.test(k))).toHaveLength(1);
		const index = JSON.parse(app.vault.adapter.data.get(`${DIR}/index.json`)!) as Record<string, { hasUndo: boolean; file: string }>;
		expect(index["a.csv"]!.hasUndo).toBe(true);
	});

	it("init reads only the index; state files are loaded per CSV on demand", async () => {
		const { app, mk } = make();
		const s = mk();
		await s.saveSnapshot("a.csv", { "n/1.md": { x: "1" } });
		await s.saveSnapshot("b.csv", { "m/1.md": { x: "1" } });
		await s.saveUndo("b.csv", manifest("b.csv"));
		const fresh = mk();
		const reads: string[] = [];
		const read = app.vault.adapter.read.bind(app.vault.adapter);
		app.vault.adapter.read = async (p) => (reads.push(p), read(p));
		await fresh.init();
		expect(reads).toEqual([`${DIR}/index.json`]);
		expect(fresh.hasUndo("b.csv")).toBe(true);
		expect(fresh.hasUndo("a.csv")).toBe(false);
		expect((await fresh.loadSnapshot("a.csv"))["n/1.md"]).toEqual({ x: "1" });
		expect(reads).toHaveLength(2);
		expect((await fresh.loadUndo("b.csv"))?.modified[0]!.content).toBe("old");
		expect(reads).toHaveLength(3);
	});

	it("saving a snapshot does not rewrite the undo file", async () => {
		const { app, mk } = make();
		const s = mk();
		await s.saveUndo("a.csv", manifest("a.csv"));
		const undoFile = [...app.vault.adapter.data.keys()].find((k) => k.endsWith(".undo.json"))!;
		const before = app.vault.adapter.data.get(undoFile);
		let undoWrites = 0;
		const write = app.vault.adapter.write.bind(app.vault.adapter);
		app.vault.adapter.write = async (p, d) => {
			if (p === undoFile) undoWrites++;
			return write(p, d);
		};
		await s.saveSnapshot("a.csv", { "n/9.md": { x: "1" } });
		expect(undoWrites).toBe(0);
		expect(app.vault.adapter.data.get(undoFile)).toBe(before);
	});

	it("clearing the undo removes its file and flips the index", async () => {
		const { app, mk } = make();
		const s = mk();
		await s.saveUndo("a.csv", manifest("a.csv"));
		await s.saveUndo("a.csv", null);
		expect([...app.vault.adapter.data.keys()].some((k) => k.endsWith(".undo.json"))).toBe(false);
		expect(mk().hasUndo("a.csv")).toBe(false);
		const fresh = mk();
		await fresh.init();
		expect(fresh.hasUndo("a.csv")).toBe(false);
	});

	it("rename moves state, delete removes files and index entry", async () => {
		const { app, mk } = make();
		const s = mk();
		await s.saveSnapshot("a.csv", { "n/1.md": { x: "1" } });
		await s.saveUndo("a.csv", manifest("a.csv"));
		await s.rename("a.csv", "b.csv");
		const fresh = mk();
		await fresh.init();
		expect(fresh.hasUndo("a.csv")).toBe(false);
		expect(fresh.hasUndo("b.csv")).toBe(true);
		expect((await fresh.loadSnapshot("b.csv"))["n/1.md"]).toBeDefined();
		expect((await fresh.loadUndo("b.csv"))?.csvPath).toBe("b.csv");
		await fresh.delete("b.csv");
		expect([...app.vault.adapter.data.keys()]).toEqual([`${DIR}/index.json`]);
		const again = mk();
		await again.init();
		expect(again.hasUndo("b.csv")).toBe(false);
	});

	it("renameNote finds the owning CSV through the index without loading all of them", async () => {
		const { app, mk } = make();
		const s = mk();
		await s.saveSnapshot("a.csv", { "n/1.md": { x: "1" } });
		await s.saveUndo("a.csv", manifest("a.csv"));
		await s.saveSnapshot("b.csv", { "other/1.md": { x: "1" } });
		const fresh = mk();
		const reads: string[] = [];
		const read = app.vault.adapter.read.bind(app.vault.adapter);
		app.vault.adapter.read = async (p) => (reads.push(p), read(p));
		await fresh.renameNote("n/1.md", "m/1.md");
		expect(reads).toHaveLength(3); // index, a.csv snapshot, a.csv undo; b.csv untouched
		const check = mk();
		expect((await check.loadSnapshot("a.csv"))["m/1.md"]).toBeDefined();
		const undo = await check.loadUndo("a.csv");
		expect(undo?.created).toEqual(["m/1.md"]);
		expect(undo?.writtenHashes).toEqual({ "m/1.md": "h" });
	});

	it("migrates the old one-file-per-CSV layout", async () => {
		const { app, mk } = make();
		await app.vault.adapter.mkdir(DIR);
		app.vault.adapter.data.set(
			`${DIR}/0123456789abcd.json`,
			JSON.stringify({ csvPath: "old.csv", snapshot: { "n/1.md": { x: "1" } }, undo: manifest("old.csv") }),
		);
		const s = mk();
		await s.init();
		expect(s.hasUndo("old.csv")).toBe(true);
		expect((await s.loadSnapshot("old.csv"))["n/1.md"]).toBeDefined();
		await s.saveSnapshot("old.csv", { "n/2.md": { x: "2" } }); // flush migration writes
		const again = mk();
		await again.init();
		expect(again.hasUndo("old.csv")).toBe(true);
		expect((await again.loadUndo("old.csv"))?.created).toEqual(["n/1.md"]);
	});
});
