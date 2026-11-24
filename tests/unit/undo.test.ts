// Undo: what a run records (created paths, previous contents up to a cap, snapshot entries) and how it is reverted.
import type { App, TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyUndo, applyUndoToSnapshot, applyUndoWith, UndoRecorder } from "../../src/import/undo";
import { valueHash } from "../../src/import/merge";
import { ObsidianVaultGateway } from "../../src/import/vaultGateway";
import type { UndoManifest } from "../../src/types";
import { MockApp, TFile as MockFile } from "./mocks/obsidian";

const file = (path: string) => new MockFile(path) as unknown as TFile;
const reads = (text: string) => () => Promise.resolve(text);

function manifest(over: Partial<UndoManifest> = {}): UndoManifest {
	return { csvPath: "d.csv", timestamp: 0, created: [], modified: [], snapshotBefore: {}, writtenHashes: {}, ...over };
}

describe("UndoRecorder", () => {
	it("starts with an empty manifest", () => {
		const m = new UndoRecorder({}).manifest;
		expect(m).toMatchObject({ csvPath: "", created: [], modified: [], snapshotBefore: {}, writtenHashes: {} });
		expect(m.truncated).toBeUndefined();
	});

	it("keeps the previous content once per note, and never for notes it created", async () => {
		const r = new UndoRecorder({});
		r.created("new.md", "fresh");
		await r.remember(file("new.md"), reads("fresh"));
		await r.remember(file("a.md"), reads("first"));
		await r.remember(file("a.md"), reads("second"));
		expect(r.manifest.created).toEqual(["new.md"]);
		expect(r.manifest.modified).toEqual([{ path: "a.md", content: "first" }]);
		expect(r.manifest.writtenHashes).toEqual({ "new.md": valueHash("fresh") });
	});

	it("keeps contents up to the cap in total, then marks undo partial", async () => {
		const r = new UndoRecorder({}, 6);
		await r.remember(file("a.md"), reads("abc"));
		await r.remember(file("b.md"), reads("abc"));
		await r.remember(file("c.md"), reads("x"));
		expect(r.manifest.modified.map((m) => m.path)).toEqual(["a.md", "b.md"]);
		expect(r.finish()).toBe(true);
		expect(r.manifest.truncated).toBe(true);
	});

	it("does not mark a complete undo as partial", async () => {
		const r = new UndoRecorder({}, 3);
		await r.remember(file("a.md"), reads("abc"));
		expect(r.finish()).toBe(false);
		expect(r.manifest.truncated).toBeUndefined();
	});

	it("keeps the snapshot entry a note had before the run, if any", async () => {
		const r = new UndoRecorder({ "a.md": { v: "h1" } });
		await r.remember(file("a.md"), reads("A"));
		await r.remember(file("b.md"), reads("B"));
		expect(r.manifest.snapshotBefore).toEqual({ "a.md": { v: "h1" } });
	});
});

describe("applyUndoToSnapshot", () => {
	it("keeps unrelated entries, drops created ones and restores modified ones", () => {
		const out = applyUndoToSnapshot(
			{ "keep.md": { v: "k" }, "new.md": { v: "n" }, "mod.md": { v: "after" }, "nobefore.md": { v: "x" } },
			manifest({
				created: ["new.md"],
				modified: [
					{ path: "mod.md", content: "" },
					{ path: "nobefore.md", content: "" },
				],
				snapshotBefore: { "mod.md": { v: "before" } },
			}),
		);
		expect(out).toEqual({ "keep.md": { v: "k" }, "mod.md": { v: "before" } });
	});

	it("leaves skipped paths as they are", () => {
		const snapshot = { "new.md": { v: "n" }, "mod.md": { v: "after" } };
		const m = manifest({ created: ["new.md"], modified: [{ path: "mod.md", content: "" }], snapshotBefore: { "mod.md": { v: "before" } } });
		expect(applyUndoToSnapshot(snapshot, m, new Set(["new.md", "mod.md"]))).toEqual(snapshot);
	});
});

describe("applyUndoWith", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function vaultWith(files: Record<string, string>) {
		const app = new MockApp();
		for (const [p, t] of Object.entries(files)) await app.vault.create(p, t);
		return app;
	}

	it("ignores notes that no longer exist", async () => {
		const app = await vaultWith({});
		const out = await applyUndo(app as unknown as App, manifest({ created: ["gone.md"], modified: [{ path: "gone2.md", content: "x" }] }));
		expect(out).toEqual({ trashed: 0, restored: 0, failed: 0, changed: [] });
	});

	it("treats notes without a recorded hash as unchanged (older manifests)", async () => {
		const app = await vaultWith({ "new.md": "edited", "mod.md": "edited" });
		const m = manifest({ created: ["new.md"], modified: [{ path: "mod.md", content: "old" }] });
		expect(await applyUndo(app as unknown as App, { ...m, writtenHashes: {} })).toEqual({ trashed: 1, restored: 1, failed: 0, changed: [] });
		expect(app.vault.files.get("mod.md")).toBe("old");
		const app2 = await vaultWith({ "mod.md": "edited" });
		const noHashes = { ...manifest({ modified: [{ path: "mod.md", content: "old" }] }), writtenHashes: undefined } as unknown as UndoManifest;
		expect(await applyUndo(app2 as unknown as App, noHashes)).toMatchObject({ restored: 1 });
	});

	it("counts and logs notes it could not trash or restore, and goes on", async () => {
		const app = await vaultWith({ "a.md": "A", "b.md": "B", "c.md": "C" });
		const gateway = new ObsidianVaultGateway(app as unknown as App);
		gateway.trash = () => Promise.reject(new Error("locked"));
		const process = gateway.process.bind(gateway);
		gateway.process = (f, fn) => (f.path === "b.md" ? Promise.reject(new Error("locked")) : process(f, fn));
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const out = await applyUndoWith(
			gateway,
			manifest({ created: ["a.md"], modified: [{ path: "b.md", content: "old b" }, { path: "c.md", content: "old c" }] }),
		);
		expect(out).toEqual({ trashed: 0, restored: 1, failed: 2, changed: [] });
		expect(app.vault.files.get("c.md")).toBe("old c");
		expect(error).toHaveBeenCalledWith("CSV Importer: could not trash note", "a.md", expect.any(Error));
		expect(error).toHaveBeenCalledWith("CSV Importer: could not restore note", "b.md", expect.any(Error));
	});
});
