import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseCsv } from "../src/csv/parser";
import { prepareConfig } from "../src/csv/typeInference";
import { createDefaultFileConfig, DEFAULT_SETTINGS } from "../src/defaults";
import { applyUndoToSnapshot, writeNotes } from "../src/import/importer";
import { planNotes } from "../src/import/noteBuilder";
import type { FileImportConfig, ImportSnapshot } from "../src/types";
import { MockApp, TFile } from "./mocks/obsidian";
import type { App } from "obsidian";

const CSV_V1 = "id,date,role,hours\n1,2026-10-20,Dev,4\n2,2026-10-21,Tester,2,5\n";
const CSV_V2 = "id,date,role,hours\n1,2026-10-20,Dev,6\n2,2026-10-21,Lead,\n3,2026-10-22,Dev,1\n";

function setup(overrides: Partial<FileImportConfig> = {}) {
	const app = new MockApp();
	const cfg: FileImportConfig = {
		...createDefaultFileConfig(DEFAULT_SETTINGS),
		fileNameTemplate: "Entry {{id}}",
		keyColumn: "id",
		...overrides,
	};
	let snapshot: ImportSnapshot = {};
	const setSnapshot = (s: ImportSnapshot) => (snapshot = s);
	const getSnapshot = () => snapshot;
	const run = async (csv: string, dryRun = false) => {
		const parsed = parseCsv(csv, cfg);
		prepareConfig(cfg, parsed, true);
		const notes = planNotes(parsed, cfg, { path: "Data/hours.csv", basename: "hours" });
		const out = await writeNotes(app as unknown as App, notes, cfg, { dryRun, snapshot });
		if (!dryRun) snapshot = out.snapshot;
		return out;
	};
	const read = (path: string) => app.vault.files.get(path) ?? "";
	const fm = (path: string) => parse(/^---\n([\s\S]*?)---/.exec(read(path))![1]) as Record<string, unknown>;
	const editInBases = (path: string, fn: (fm: Record<string, unknown>) => void) =>
		app.fileManager.processFrontMatter(app.vault.getAbstractFileByPath(path) as TFile, fn);
	return { app, cfg, run, read, fm, editInBases, setSnapshot, getSnapshot };
}

describe("re-import keeps work done in Obsidian", () => {
	it("first import creates typed notes", async () => {
		const t = setup();
		const { result } = await t.run(CSV_V1);
		expect(result.created).toBe(2);
		expect(t.read("Data/hours/Entry 1.md")).toMatch(/^hours: 4$/m);
	});

	it("keeps added properties, the body and edited values; updates the rest", async () => {
		const t = setup();
		await t.run(CSV_V1);
		const p = "Data/hours/Entry 1.md";
		// User works in Bases: adds a property, edits a CSV property, writes in the body.
		await t.editInBases(p, (fm) => {
			fm.status = "reviewed";
			fm.role = "Senior Dev";
		});
		t.app.vault.files.set(p, t.read(p) + "\nMy notes\n");

		const { result } = await t.run(CSV_V2);
		const fm = t.fm(p);
		expect(fm.status).toBe("reviewed"); // added in Obsidian: kept
		expect(fm.role).toBe("Senior Dev"); // edited in Obsidian: protected
		expect(fm.hours).toBe(6); // changed in CSV, not edited: updated, still a number
		expect(t.read(p)).toContain("My notes"); // body kept
		const row1 = result.rows.find((r) => r.row === 1)!;
		expect(row1.outcome).toBe("updated");
		expect(row1.preserved).toContain("role");
		expect(result.created).toBe(1); // id 3
	});

	it("empty CSV cell does not clear a value", async () => {
		const t = setup();
		await t.run(CSV_V1);
		await t.run(CSV_V2);
		const fm = t.fm("Data/hours/Entry 2.md");
		expect(fm.role).toBe("Lead");
		expect(fm.hours).toBe(2);
	});

	it("unchanged rows are not rewritten", async () => {
		const t = setup();
		await t.run(CSV_V1);
		const before = t.read("Data/hours/Entry 1.md");
		const { result } = await t.run(CSV_V1);
		expect(result.unchanged).toBe(2);
		expect(result.updated).toBe(0);
		expect(t.read("Data/hours/Entry 1.md")).toBe(before);
	});

	it("finds renamed notes by key column instead of creating duplicates", async () => {
		const t = setup();
		await t.run(CSV_V1);
		t.app.vault.rename("Data/hours/Entry 1.md", "Data/hours/My renamed note.md");
		const { result } = await t.run(CSV_V2);
		expect(t.app.vault.files.has("Data/hours/Entry 1.md")).toBe(false);
		expect(t.fm("Data/hours/My renamed note.md").hours).toBe(6);
		expect(result.created).toBe(1);
	});

	it("protectEdits off: CSV wins for edited values, added properties still kept", async () => {
		const t = setup({ protectEdits: false });
		await t.run(CSV_V1);
		await t.editInBases("Data/hours/Entry 1.md", (fm) => {
			fm.role = "Senior Dev";
			fm.status = "reviewed";
		});
		await t.run(CSV_V2);
		const fm = t.fm("Data/hours/Entry 1.md");
		expect(fm.role).toBe("Dev");
		expect(fm.status).toBe("reviewed");
	});

	it("skip mode leaves existing notes alone", async () => {
		const t = setup({ conflict: "skip" });
		await t.run(CSV_V1);
		const { result } = await t.run(CSV_V2);
		expect(result.skipped).toBe(2);
		expect(t.fm("Data/hours/Entry 1.md").hours).toBe(4);
	});

	it("dry run reports outcomes but writes nothing", async () => {
		const t = setup();
		await t.run(CSV_V1);
		const before = new Map(t.app.vault.files);
		const { result } = await t.run(CSV_V2, true);
		expect(result.dryRun).toBe(true);
		expect(result.created).toBe(1);
		expect(result.updated).toBe(2);
		expect(t.app.vault.files).toEqual(before);
	});

	it("undo manifest holds created paths and previous content", async () => {
		const t = setup();
		await t.run(CSV_V1);
		const before = t.read("Data/hours/Entry 1.md");
		const { undo } = await t.run(CSV_V2);
		expect(undo.created).toEqual(["Data/hours/Entry 3.md"]);
		expect(undo.modified.find((m) => m.path === "Data/hours/Entry 1.md")?.content).toBe(before);
	});
});

describe("undo keeps the protectEdits baseline", () => {
	it("import V1, edit role, import V2, undo, import V2 again: edited role survives", async () => {
		const t = setup();
		await t.run(CSV_V1);
		const p = "Data/hours/Entry 1.md";
		await t.editInBases(p, (fm) => {
			fm.role = "Senior Dev";
		});
		const { undo } = await t.run(CSV_V2);
		expect(t.fm(p).role).toBe("Senior Dev");
		// Undo like the plugin does: restore contents, trash created notes, fix the snapshot.
		for (const m of undo.modified) t.app.vault.files.set(m.path, m.content);
		t.setSnapshot(applyUndoToSnapshot(t.getSnapshot(), undo));
		expect(t.getSnapshot()[p]?.role).toBeDefined();
		await t.run(CSV_V2);
		expect(t.fm(p).role).toBe("Senior Dev");
		expect(t.fm(p).hours).toBe(6);
	});

	it("drops snapshot entries of created notes and of modified notes that had none", () => {
		const snap = { a: { x: "1" }, b: { x: "2" }, c: { x: "3" } };
		const out = applyUndoToSnapshot(snap, {
			csvPath: "f.csv",
			timestamp: 0,
			created: ["a"],
			modified: [
				{ path: "b", content: "" },
				{ path: "c", content: "" },
			],
			snapshotBefore: { b: { x: "old" } },
		});
		expect(out).toEqual({ b: { x: "old" } });
		expect(snap.a).toBeDefined(); // input not mutated
	});
});

describe("key matching uses the value actually written", () => {
	it("key column with a value template", async () => {
		const t = setup();
		prepareConfig(t.cfg, parseCsv(CSV_V1, t.cfg), true);
		t.cfg.columns.find((c) => c.source === "id")!.valueTemplate = "[[{{value}}]]";
		await t.run(CSV_V1);
		expect(t.fm("Data/hours/Entry 1.md").id).toBe("[[1]]");
		t.app.vault.rename("Data/hours/Entry 1.md", "Data/hours/Renamed.md");
		const { result } = await t.run(CSV_V2);
		expect(t.app.vault.files.has("Data/hours/Entry 1.md")).toBe(false);
		expect(t.fm("Data/hours/Renamed.md").hours).toBe(6);
		expect(result.created).toBe(1);
	});

	it("excluded key column is still written and matched", async () => {
		const t = setup();
		prepareConfig(t.cfg, parseCsv(CSV_V1, t.cfg), true);
		t.cfg.columns.find((c) => c.source === "id")!.include = false;
		await t.run(CSV_V1);
		expect(t.fm("Data/hours/Entry 1.md").id).toBe(1);
		t.app.vault.rename("Data/hours/Entry 1.md", "Data/hours/Renamed.md");
		const { result } = await t.run(CSV_V2);
		expect(t.app.vault.files.has("Data/hours/Entry 1.md")).toBe(false);
		expect(t.fm("Data/hours/Renamed.md").hours).toBe(6);
		expect(result.created).toBe(1);
	});
});
