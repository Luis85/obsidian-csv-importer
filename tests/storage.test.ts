import { describe, expect, it } from "vitest";
import { ImportStorage } from "../src/storage";
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
