import { describe, expect, it } from "vitest";
import { ImportStorage, STATE_VERSION } from "../../src/storage";
import { MockApp } from "./mocks/obsidian";
import type { App } from "obsidian";

describe("ImportStorage writes", () => {
	it("concurrent renameNote calls serialize, coalesce and survive the first mkdir race", async () => {
		const app = new MockApp();
		const storage = new ImportStorage(app as unknown as App, "plugins/csv");
		await storage.saveSnapshot("a.csv", { "n/1.md": { x: "1" }, "n/2.md": { x: "2" }, "n/3.md": { x: "3" } });
		await storage.saveUndo("a.csv", null);
		app.vault.adapter.writes = 0;
		app.vault.adapter.dirs.clear(); // force the mkdir path on the next write
		await Promise.all([
			storage.renameNote("n/1.md", "m/1.md"),
			storage.renameNote("n/2.md", "m/2.md"),
			storage.renameNote("n/3.md", "m/3.md"),
		]);
		const file = [...app.vault.adapter.data.keys()].find((k) => /\/[0-9a-f]{14}\.json$/.test(k))!;
		const stored = JSON.parse(app.vault.adapter.data.get(file)!) as { snapshot: Record<string, unknown> };
		expect(Object.keys(stored.snapshot).sort()).toEqual(["m/1.md", "m/2.md", "m/3.md"]);
		expect(app.vault.adapter.writes).toBeLessThan(5); // snapshot (coalesced) + index
	});

	it("treats an already existing folder as success", async () => {
		const app = new MockApp();
		const storage = new ImportStorage(app as unknown as App, "plugins/csv");
		const real = app.vault.adapter.exists.bind(app.vault.adapter);
		let first = true;
		app.vault.adapter.exists = async (p) => {
			if (first && p === "plugins/csv/imports") {
				first = false;
				app.vault.adapter.dirs.add(p); // someone else creates it between exists() and mkdir()
				return false;
			}
			return real(p);
		};
		await expect(storage.saveUndo("b.csv", null)).resolves.toBeUndefined();
		expect(app.vault.adapter.data.size).toBeGreaterThan(0);
	});
});

describe("ImportStorage robustness", () => {
	it("a corrupt index.json is rebuilt from the state files on disk", async () => {
		const app = new MockApp();
		const first = new ImportStorage(app as unknown as App, "plugins/csv");
		await first.saveSnapshot("a.csv", { "A/1.md": { x: "1" } });
		await first.saveSnapshot("b.csv", { "B/1.md": { x: "2" } });
		app.vault.adapter.data.set("plugins/csv/imports/index.json", "{ half writt");
		const second = new ImportStorage(app as unknown as App, "plugins/csv");
		await second.saveSnapshot("b.csv", { "B/1.md": { x: "3" } });
		expect(await second.loadSnapshot("a.csv")).toEqual({ "A/1.md": { x: "1" } });
		const third = new ImportStorage(app as unknown as App, "plugins/csv");
		expect(await third.loadSnapshot("a.csv")).toEqual({ "A/1.md": { x: "1" } });
	});

	it("falls back to the deterministic file names when a CSV has no index entry", async () => {
		const app = new MockApp();
		const first = new ImportStorage(app as unknown as App, "plugins/csv");
		await first.saveSnapshot("a.csv", { "A/1.md": { x: "1" } });
		await first.saveUndo("a.csv", { csvPath: "a.csv", timestamp: 1, created: ["A/1.md"], modified: [] });
		app.vault.adapter.data.delete("plugins/csv/imports/index.json");
		const second = new ImportStorage(app as unknown as App, "plugins/csv");
		await second.init();
		// Simulate an index that lost the entry.
		(second as unknown as { index: Map<string, unknown> }).index.clear();
		expect(await second.loadSnapshot("a.csv")).toEqual({ "A/1.md": { x: "1" } });
		expect((await second.loadUndo("a.csv"))?.created).toEqual(["A/1.md"]);
	});

	it("deleteNote removes the path from every snapshot", async () => {
		const app = new MockApp();
		const storage = new ImportStorage(app as unknown as App, "plugins/csv");
		await storage.saveSnapshot("a.csv", { "N/1.md": { x: "1" }, "N/2.md": { x: "2" } });
		await storage.saveSnapshot("b.csv", { "M/1.md": { x: "1" } });
		await storage.deleteNote("N/1.md");
		expect(await storage.loadSnapshot("a.csv")).toEqual({ "N/2.md": { x: "2" } });
		const again = new ImportStorage(app as unknown as App, "plugins/csv");
		expect(await again.loadSnapshot("a.csv")).toEqual({ "N/2.md": { x: "2" } });
		expect(await again.loadSnapshot("b.csv")).toEqual({ "M/1.md": { x: "1" } });
	});
});

describe("data versioning", () => {
	it("exports the history warning text", async () => {
		const { HISTORY_NOT_SAVED_WARNING } = await import("../../src/import/importer");
		expect(HISTORY_NOT_SAVED_WARNING).toContain("import history could not be saved");
	});
});

describe("ImportStorage: damaged and newer state files", () => {
	const snapFileOf = (app: MockApp) => [...app.vault.adapter.data.keys()].find((k) => /\/[0-9a-f]{14}\.json$/.test(k))!;

	async function saved() {
		const app = new MockApp();
		const storage = new ImportStorage(app as unknown as App, "plugins/csv");
		await storage.saveSnapshot("a.csv", { "x.md": { k: "1" } });
		return { app, file: snapFileOf(app) };
	}

	it("writes the format version and leaves no temporary copy", async () => {
		const { app, file } = await saved();
		expect(JSON.parse(app.vault.adapter.data.get(file)!)).toMatchObject({ version: STATE_VERSION, csvPath: "a.csv" });
		expect([...app.vault.adapter.data.keys()].some((k) => k.endsWith(".tmp"))).toBe(false);
	});

	it("reads the temporary copy when the file itself was cut off", async () => {
		const { app, file } = await saved();
		app.vault.adapter.data.set(`${file}.tmp`, app.vault.adapter.data.get(file)!);
		app.vault.adapter.data.set(file, '{"version":1,"csvPath":"a.csv","snap');
		const fresh = new ImportStorage(app as unknown as App, "plugins/csv");
		expect(await fresh.loadSnapshot("a.csv")).toEqual({ "x.md": { k: "1" } });
		expect(fresh.unreadableState("a.csv")).toEqual([]);
	});

	it("reports a corrupt file, keeps a copy of it, and clears the report once saved again", async () => {
		const { app, file } = await saved();
		app.vault.adapter.data.set(file, '{"csvPath":"a.csv","snap');
		const fresh = new ImportStorage(app as unknown as App, "plugins/csv");
		expect(await fresh.loadSnapshot("a.csv")).toEqual({});
		expect(fresh.unreadableState("a.csv")).toEqual(["snapshot"]);
		expect(app.vault.adapter.data.get(`${file}.unreadable`)).toBe('{"csvPath":"a.csv","snap');
		await fresh.saveSnapshot("a.csv", {});
		expect(fresh.unreadableState("a.csv")).toEqual([]);
		expect(app.vault.adapter.data.get(`${file}.unreadable`)).toBe('{"csvPath":"a.csv","snap');
	});

	it("does not read a file written by a newer version", async () => {
		const { app, file } = await saved();
		app.vault.adapter.data.set(file, JSON.stringify({ version: STATE_VERSION + 1, csvPath: "a.csv", snapshot: { "x.md": {} } }));
		const fresh = new ImportStorage(app as unknown as App, "plugins/csv");
		expect(await fresh.loadSnapshot("a.csv")).toEqual({});
		expect(fresh.unreadableState("a.csv")).toEqual(["snapshot"]);
	});

	it("reads files without a version (0.4.1 and earlier) and returns undo manifests without it", async () => {
		const { app, file } = await saved();
		app.vault.adapter.data.set(file, JSON.stringify({ csvPath: "a.csv", snapshot: { "y.md": { k: "2" } } }));
		const fresh = new ImportStorage(app as unknown as App, "plugins/csv");
		expect(await fresh.loadSnapshot("a.csv")).toEqual({ "y.md": { k: "2" } });
		const manifest = { csvPath: "a.csv", timestamp: 1, created: ["y.md"], modified: [] };
		await fresh.saveUndo("a.csv", manifest);
		const again = new ImportStorage(app as unknown as App, "plugins/csv");
		expect(await again.loadUndo("a.csv")).toEqual(manifest);
	});

	it("retries a write that failed", async () => {
		const { app, file } = await saved();
		const storage = new ImportStorage(app as unknown as App, "plugins/csv");
		await storage.loadSnapshot("a.csv");
		const realWrite = app.vault.adapter.write.bind(app.vault.adapter);
		app.vault.adapter.write = async () => {
			throw new Error("disk full");
		};
		await expect(storage.saveSnapshot("a.csv", { "z.md": { k: "3" } })).rejects.toThrow("disk full");
		app.vault.adapter.write = realWrite;
		await storage.saveUndo("a.csv", null); // any later save also writes the pending snapshot
		expect(JSON.parse(app.vault.adapter.data.get(file)!).snapshot).toEqual({ "z.md": { k: "3" } });
	});
});
