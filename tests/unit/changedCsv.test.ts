import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { ConfigStore } from "../../src/configStore";
import { DEFAULT_SETTINGS } from "../../src/defaults";
import { checkChanged, hashBytes, lastRunOf, lastRunText, makeFingerprint, sanitizeFingerprint } from "../../src/import/fingerprint";
import { filterNotesByRows, planNotes } from "../../src/import/noteBuilder";
import { parseCsv } from "../../src/csv/parser";
import { valueHash } from "../../src/import/merge";
import { CSV_CHANGED_EVENT } from "../../src/obsidian/events";
import { ImportService } from "../../src/obsidian/importService";
import { ImportStorage } from "../../src/storage";
import type { FileImportConfig } from "../../src/types";
import { emptyResult } from "../../src/core/result";
import { cfg } from "./helpers/harness";
import { MockApp, Notice } from "./mocks/obsidian";

vi.mock("../../src/view/CsvView", () => ({ CsvView: class {} }));
const run = vi.hoisted(() => ({ ctl: null as null | { preview(): Promise<{ rows: unknown[] }>; execute(o: Record<string, unknown>): Promise<{ result: { created: number } }> } }));
vi.mock("../../src/view/ImportRunModal", () => ({
	ImportRunModal: class {
		closed = Promise.resolve({});
		constructor(_app: unknown, ctl: typeof run.ctl) {
			run.ctl = ctl;
		}
		open(): void {}
	},
}));
vi.mock("../../src/view/ConfirmModal", () => ({ confirmDialog: async () => true, confirmDialogWithOption: async () => ({ ok: true, checked: false }) }));

const bytes = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer;

describe("fingerprint", () => {
	it("hashes equal bytes equally and different bytes differently", () => {
		expect(hashBytes(new Uint8Array([1, 2, 3]))).toBe(hashBytes(new Uint8Array([1, 2, 3])));
		expect(hashBytes(new Uint8Array([1, 2, 3]))).not.toBe(hashBytes(new Uint8Array([1, 2, 4])));
	});

	it("treats a missing fingerprint as changed", async () => {
		expect((await checkChanged(undefined, { size: 1, mtime: 1 }, async () => "x")).changed).toBe(true);
	});

	it("does not hash when size and mtime are equal", async () => {
		const fp = makeFingerprint(bytes("a,b\n1,2\n"), { size: 8, mtime: 5 });
		const read = vi.fn(async () => "never");
		expect((await checkChanged(fp, { size: 8, mtime: 5 }, read)).changed).toBe(false);
		expect(read).not.toHaveBeenCalled();
	});

	it("is changed without hashing when the size differs", async () => {
		const fp = makeFingerprint(bytes("a"), { size: 1, mtime: 5 });
		const read = vi.fn(async () => fp.hash);
		expect((await checkChanged(fp, { size: 2, mtime: 5 }, read)).changed).toBe(true);
		expect(read).not.toHaveBeenCalled();
	});

	it("is not changed when only the mtime differs and the content hash matches (touched)", async () => {
		const fp = makeFingerprint(bytes("a,b\n"), { size: 4, mtime: 5 });
		const r = await checkChanged(fp, { size: 4, mtime: 9 }, async () => fp.hash);
		expect(r.changed).toBe(false);
		expect(r.touched).toEqual({ size: 4, mtime: 9, hash: fp.hash });
	});

	it("is changed when the same-size content differs", async () => {
		const fp = makeFingerprint(bytes("a,b\n"), { size: 4, mtime: 5 });
		expect((await checkChanged(fp, { size: 4, mtime: 9 }, async () => "other")).changed).toBe(true);
	});

	it("drops malformed stored fingerprints", () => {
		expect(sanitizeFingerprint({ size: "1" })).toBeUndefined();
		expect(sanitizeFingerprint(null)).toBeUndefined();
		expect(sanitizeFingerprint({ size: 1, mtime: 2, hash: "z" })).toEqual({ size: 1, mtime: 2, hash: "z" });
	});
});

describe("last run counts", () => {
	it("formats the counts and leaves out zero parts", () => {
		const r = { ...emptyResult(false), created: 12, updated: 5, unchanged: 120, skipped: 2 };
		expect(lastRunText(lastRunOf(r))).toBe("12 new · 5 updated · 120 unchanged · 2 skipped");
		expect(lastRunText(lastRunOf({ ...emptyResult(false), created: 1 }))).toBe("1 new");
		expect(lastRunText(lastRunOf(emptyResult(false)))).toBe("Nothing imported");
	});
});

describe("rows filter in planning", () => {
	const parsed = parseCsv("id,name\n1,A\n,\n3,C\n4,D\n", { delimiter: ",", hasHeader: true });

	it("keeps only the notes of the given original row numbers", () => {
		const notes = planNotes(parsed, cfg(), { path: "d.csv", basename: "d" }, { rows: [1, 4] });
		expect(notes.map((n) => n.row)).toEqual([1, 4]);
	});

	it("keeps the paths the full plan allocated", () => {
		const all = planNotes(parsed, cfg({ fileNameTemplate: "x" }), { path: "d.csv", basename: "d" });
		const some = planNotes(parsed, cfg({ fileNameTemplate: "x" }), { path: "d.csv", basename: "d" }, { rows: [4] });
		expect(some[0]?.path).toBe(all.find((n) => n.row === 4)?.path);
		expect(filterNotesByRows(all, [])).toEqual([]);
	});
});

describe("ImportStorage meta", () => {
	it("persists the fingerprint and counts, and migrates entries without them", async () => {
		const app = new MockApp();
		const a = new ImportStorage(app as unknown as App, "plugins/csv");
		await a.saveSnapshot("a.csv", {});
		expect(a.getMeta("a.csv")).toBeUndefined();
		await a.setMeta("a.csv", { fingerprint: { size: 1, mtime: 2, hash: "h" } });
		await a.setMeta("a.csv", { lastRun: { created: 1, updated: 0, unchanged: 0, skipped: 0, failed: 0 } });
		const b = new ImportStorage(app as unknown as App, "plugins/csv");
		await b.init();
		expect(b.getMeta("a.csv")).toEqual({
			fingerprint: { size: 1, mtime: 2, hash: "h" },
			lastRun: { created: 1, updated: 0, unchanged: 0, skipped: 0, failed: 0 },
		});
		await b.clearImportState("a.csv");
		expect(b.getMeta("a.csv")).toBeUndefined();
	});
});

function make() {
	const app = new MockApp();
	const configs: Record<string, FileImportConfig> = {};
	const store = new ConfigStore(configs, async () => undefined);
	const storage = new ImportStorage(app as unknown as App, "plugins/csv");
	const service = new ImportService(app as unknown as App, storage, store, () => DEFAULT_SETTINGS);
	return { app, store, storage, service };
}

beforeEach(() => {
	Notice.messages = [];
});

describe("ImportService status and index", () => {
	it("reports changed only for imported CSVs whose content differs from the recorded fingerprint", async () => {
		const t = make();
		const f = (await t.app.vault.create("d.csv", "a\n1\n"));
		const file = f as never;
		expect((await t.service.csvStatus(file)).changed).toBe(false); // never imported
		await t.store.set("d.csv", cfg({ lastImport: 100 }));
		expect((await t.service.csvStatus(file)).changed).toBe(true); // no fingerprint recorded
		await t.storage.setMeta("d.csv", { fingerprint: makeFingerprint(await t.app.vault.readBinary(f), f.stat) });
		expect((await t.service.csvStatus(file)).changed).toBe(false);
		await t.app.vault.modify(f, "a\n2\n");
		const s = await t.service.csvStatus(file);
		expect(s).toMatchObject({ changed: true, imported: true, lastImport: 100 });
	});

	it("lists changed state and last run counts", async () => {
		const t = make();
		const f = (await t.app.vault.create("d.csv", "a\n1\n"));
		await t.store.set("d.csv", cfg({ lastImport: 100 }));
		await t.storage.setMeta("d.csv", { fingerprint: makeFingerprint(await t.app.vault.readBinary(f), f.stat), lastRun: { created: 2, updated: 0, unchanged: 0, skipped: 0, failed: 0 } });
		await t.app.vault.modify(f, "a\n1\n2\n");
		const [row] = await t.service.listImports();
		expect(row).toMatchObject({ changed: true, lastRun: { created: 2 } });
	});

	it("counts notes whose managed properties differ from the snapshot", async () => {
		const t = make();
		await t.app.vault.createFolder("n");
		await t.app.vault.create("n/1.md", "---\nname: A\nqty: 3\n---\n");
		await t.app.vault.create("n/2.md", "---\nname: B\nqty: 9\n---\n");
		await t.app.vault.create("n/3.md", "---\nname: C\nqty: 1\n---\n");
		await t.storage.saveSnapshot("d.csv", {
			"n/1.md": { name: valueHash("A"), qty: valueHash(3) },
			"n/2.md": { name: valueHash("B"), qty: valueHash(2) },
			"n/3.md": { name: valueHash("X"), qty: valueHash(2) },
			"n/gone.md": { name: valueHash("Z") },
		});
		const r = await t.service.countEditedNotes("d.csv");
		expect(r).toEqual({ count: 2, checked: 3, properties: ["name", "qty"] });
	});

	it("lists only CSVs without settings and adds them with default settings, no import", async () => {
		const t = make();
		await t.app.vault.create("a.csv", "x");
		await t.app.vault.create("b.csv", "x");
		await t.app.vault.create("c.md", "x");
		await t.store.set("a.csv", cfg());
		expect(t.service.listUnindexedCsvs().map((f) => f.path)).toEqual(["b.csv"]);
		expect(await t.service.addToIndex(["b.csv", "a.csv", "nope.csv"])).toBe(1);
		expect(t.store.has("b.csv")).toBe(true);
		expect(t.store.get("b.csv")?.lastImport).toBeNull();
		expect(t.service.listUnindexedCsvs()).toEqual([]);
		expect(t.app.triggered.some((a) => a[0] === CSV_CHANGED_EVENT && a[1] === "b.csv")).toBe(true);
	});

	it("copies an outside file into the vault: keep both uses a free name, replace overwrites the bytes", async () => {
		const t = make();
		await t.app.vault.createFolder("Inbox");
		await t.app.vault.create("Inbox/x.csv", "old");
		const first = await t.service.addExternalCsv(bytes("a,b\n1,2\n"), "Inbox", "x.csv", "keep");
		expect(first.path).toBe("Inbox/x 1.csv");
		expect(t.app.vault.files.get("Inbox/x 1.csv")).toBe("a,b\n1,2\n");
		const second = await t.service.addExternalCsv(bytes("new"), "Inbox", "x", "keep");
		expect(second.path).toBe("Inbox/x 2.csv");
		const replaced = await t.service.addExternalCsv(bytes("replaced"), "Inbox", "x.csv", "replace");
		expect(replaced.path).toBe("Inbox/x.csv");
		expect(t.app.vault.files.get("Inbox/x.csv")).toBe("replaced");
		expect(t.store.has("Inbox/x.csv")).toBe(true);
		const made = await t.service.addExternalCsv(bytes("q"), "New/Sub", "y.csv", "keep");
		expect(made.path).toBe("New/Sub/y.csv");
	});
});

describe("import dialog row selection", () => {
	async function setup() {
		const t = make();
		const f = await t.app.vault.create("d.csv", "id,name\n1,A\n2,B\n3,C\n");
		await t.app.vault.createFolder("d");
		await t.store.set("d.csv", cfg({ conflict: "skip", fileNameTemplate: "{{file}} {{row}}" }));
		return { t, f };
	}

	it("importFile rows limits preview and write to those rows", async () => {
		const { t, f } = await setup();
		await t.service.runImportDialog(f as never, "id,name\n1,A\n2,B\n3,C\n", { rows: [1, 3] });
		expect((await run.ctl!.preview()).rows).toHaveLength(2);
		const out = await run.ctl!.execute({ onProgress: () => undefined, shouldStop: () => false });
		expect(out.result.created).toBe(2);
		expect(t.app.vault.getAbstractFileByPath("d/d 2.md")).toBeNull();
		expect(t.app.vault.getAbstractFileByPath("d/d 3.md")).not.toBeNull();
		// A partial run records the counts but not the fingerprint: the CSV still counts as changed.
		expect(t.storage.getMeta("d.csv")?.lastRun?.created).toBe(2);
		expect(t.storage.getMeta("d.csv")?.fingerprint).toBeUndefined();
	});

	it("rows passed to execute (kept checked in the preview) win over importFile rows", async () => {
		const { t, f } = await setup();
		await t.service.runImportDialog(f as never, "id,name\n1,A\n2,B\n3,C\n", { rows: [1, 2, 3] });
		const out = await run.ctl!.execute({ onProgress: () => undefined, shouldStop: () => false, rows: [2] });
		expect(out.result.created).toBe(1);
		expect(t.app.vault.getAbstractFileByPath("d/d 2.md")).not.toBeNull();
		expect(t.app.vault.getAbstractFileByPath("d/d 1.md")).toBeNull();
	});

	it("a full import records the fingerprint and counts, then the CSV is unchanged until it is modified", async () => {
		const { t, f } = await setup();
		await t.service.runImportDialog(f as never, "id,name\n1,A\n2,B\n3,C\n");
		await run.ctl!.execute({ onProgress: () => undefined, shouldStop: () => false });
		expect(t.storage.getMeta("d.csv")?.fingerprint?.size).toBe(f.stat.size);
		expect((await t.service.csvStatus(f as never)).changed).toBe(false);
		await t.app.vault.modify(f, "id,name\n1,A\n");
		expect((await t.service.csvStatus(f as never)).changed).toBe(true);
		expect(t.app.triggered.some((a) => a[0] === CSV_CHANGED_EVENT && a[1] === "d.csv")).toBe(true);
	});
});
