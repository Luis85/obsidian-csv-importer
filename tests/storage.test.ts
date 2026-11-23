import { describe, expect, it } from "vitest";
import { ImportStorage } from "../src/storage";
import { MockApp } from "./mocks/obsidian";
import type { App } from "obsidian";

describe("ImportStorage writes", () => {
	it("concurrent renameNote calls serialize, coalesce and survive the first mkdir race", async () => {
		const app = new MockApp();
		const storage = new ImportStorage(app as unknown as App, "plugins/csv");
		await storage.saveSnapshot("a.csv", { "n/1.md": { x: "1" }, "n/2.md": { x: "2" }, "n/3.md": { x: "3" } });
		app.vault.adapter.writes = 0;
		app.vault.adapter.dirs.clear(); // force the mkdir path on the next write
		await Promise.all([
			storage.renameNote("n/1.md", "m/1.md"),
			storage.renameNote("n/2.md", "m/2.md"),
			storage.renameNote("n/3.md", "m/3.md"),
		]);
		const [file] = [...app.vault.adapter.data.keys()];
		const stored = JSON.parse(app.vault.adapter.data.get(file)!) as { snapshot: Record<string, unknown> };
		expect(Object.keys(stored.snapshot).sort()).toEqual(["m/1.md", "m/2.md", "m/3.md"]);
		expect(app.vault.adapter.writes).toBeLessThan(3);
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
		expect(app.vault.adapter.data.size).toBe(1);
	});
});
