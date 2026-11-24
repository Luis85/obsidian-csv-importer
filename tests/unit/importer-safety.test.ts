import { describe, expect, it, vi } from "vitest";
import { parseCsv } from "../../src/csv/parser";
import { prepareConfig } from "../../src/csv/typeInference";
import { createDefaultFileConfig, DEFAULT_SETTINGS } from "../../src/defaults";
import { applyUndo, applyUndoToSnapshot, KEY_WARNING, UNDO_TRUNCATED_WARNING, writeNotes } from "../../src/import/importer";
import { planNotes } from "../../src/import/noteBuilder";
import type { FileImportConfig, UndoManifest } from "../../src/types";
import { setup } from "./helpers/harness";
import { MockApp } from "./mocks/obsidian";
import type { App } from "obsidian";

const CSV = "id,role\n1,Dev\n2,Tester\n";
const CSV_V2 = "id,role\n1,Lead\n2,Tester\n3,New\n";

const FOREIGN = "---\nid: 1\nrole: Mine\n---\nmy own note\n";

describe("S1 ownership", () => {
	it("an unrelated note at the same path is skipped, not overwritten (update, overwrite, dry run)", async () => {
		for (const conflict of ["update", "overwrite"] as const) {
			const t = setup({ conflict, keyColumn: "" });
			await t.put("Data/hours/Entry 1.md", "---\nrole: Mine\n---\nprecious\n");
			const dry = await t.run(CSV, { dryRun: true });
			expect(dry.result.rows.find((r) => r.row === 1)).toMatchObject({ outcome: "skipped", reason: "not created by this import" });
			const { result } = await t.run(CSV);
			expect(result.rows.find((r) => r.path === "Data/hours/Entry 1.md")).toMatchObject({ outcome: "skipped", reason: "not created by this import" });
			expect(t.read("Data/hours/Entry 1.md")).toBe("---\nrole: Mine\n---\nprecious\n");
		}
	});

	it("with conflict rename an unrelated note gets a copy next to it", async () => {
		const t = setup({ conflict: "rename", keyColumn: "" });
		await t.put("Data/hours/Entry 1.md", "mine");
		const { result } = await t.run(CSV);
		expect(t.read("Data/hours/Entry 1.md")).toBe("mine");
		expect(t.app.vault.files.has("Data/hours/Entry 1 1.md")).toBe(true);
		expect(result.created).toBe(2);
	});

	it("a foreign note with the same key in a subfolder is not merged", async () => {
		const t = setup();
		await t.put("Data/hours/Archive/old.md", FOREIGN);
		const { result } = await t.run(CSV);
		expect(t.read("Data/hours/Archive/old.md")).toBe(FOREIGN);
		// The foreign note is left alone and never blocks creation of the CSV's own note.
		expect(result.skipped).toBe(0);
		expect(result.created).toBe(2);
		expect(t.app.vault.files.has("Data/hours/Entry 1.md")).toBe(true);
	});

	it("notes this import created are still updated, also after being moved (snapshot entry)", async () => {
		const t = setup();
		await t.run(CSV);
		t.app.vault.rename("Data/hours/Entry 1.md", "Data/hours/Moved.md");
		t.setSnapshot({ ...t.getSnapshot(), "Data/hours/Moved.md": t.getSnapshot()["Data/hours/Entry 1.md"]! });
		const { result } = await t.run(CSV_V2);
		expect(t.fm("Data/hours/Moved.md").role).toBe("Lead");
		expect(result.skipped).toBe(0);
	});

	it("a note with the source link to this CSV is owned without a snapshot, link compared loosely", async () => {
		for (const link of ["[[Data/hours.csv]]", "[[data/hours]]", "[[Data/hours.CSV|my data]]"]) {
			const t = setup();
			await t.put("Data/hours/Entry 1.md", `---\nid: 1\nrole: Dev\nsource: "${link}"\n---\n`);
			const { result } = await t.run(CSV_V2);
			expect(result.rows.find((r) => r.row === 1)?.outcome, link).toBe("updated");
			expect(t.fm("Data/hours/Entry 1.md").role).toBe("Lead");
		}
	});

	it("a source link to another CSV does not count", async () => {
		const t = setup();
		await t.put("Data/hours/Entry 1.md", `---\nid: 1\nsource: "[[Other/file.csv]]"\n---\n`);
		const { result } = await t.run(CSV_V2);
		expect(result.rows.find((r) => r.row === 1)?.outcome).toBe("skipped");
	});

	it("adoptExistingNotes lets the import update notes it did not create", async () => {
		const t = setup({ adoptExistingNotes: true });
		await t.put("Data/hours/Archive/old.md", FOREIGN);
		const { result } = await t.run(CSV);
		expect(t.fm("Data/hours/Archive/old.md").role).toBe("Dev");
		expect(t.read("Data/hours/Archive/old.md")).toContain("my own note");
		expect(result.updated).toBe(1);
	});

	it("a note at the path with another key is another record: skipped, or copied with rename", async () => {
		const t = setup();
		await t.run(CSV);
		await t.app.fileManager.processFrontMatter(t.app.vault.getAbstractFileByPath("Data/hours/Entry 1.md") as never, (fm) => {
			fm.id = 99;
		});
		const { result } = await t.run(CSV);
		expect(result.rows.find((r) => r.row === 1)).toMatchObject({ outcome: "skipped", reason: "file name taken by another record" });
		expect(t.fm("Data/hours/Entry 1.md").id).toBe(99);

		const r = setup({ conflict: "rename" });
		await r.run(CSV);
		await r.app.fileManager.processFrontMatter(r.app.vault.getAbstractFileByPath("Data/hours/Entry 1.md") as never, (fm) => {
			fm.id = 99;
		});
		await r.run(CSV);
		expect(r.fm("Data/hours/Entry 1.md").id).toBe(99);
		expect([...r.app.vault.files.keys()].filter((k) => k.includes("Entry 1"))).toHaveLength(2);
	});
});

describe("S3 warnings", () => {
	it("warns without key column when a previous import exists, update/overwrite only", async () => {
		const t = setup({ keyColumn: "" });
		const first = await t.run(CSV);
		expect(first.result.warnings).not.toContain(KEY_WARNING);
		const second = await t.run(CSV);
		expect(second.result.warnings).toContain(KEY_WARNING);
		const dry = await t.run(CSV, { dryRun: true });
		expect(dry.result.warnings).toContain(KEY_WARNING);
		t.cfg.conflict = "skip";
		expect((await t.run(CSV)).result.warnings).not.toContain(KEY_WARNING);
		const keyed = setup();
		await keyed.run(CSV);
		expect((await keyed.run(CSV)).result.warnings).toEqual([]);
	});

	it("passes parser warnings through", async () => {
		const t = setup();
		const { result } = await t.run(CSV, { warnings: ["Unterminated quote starting in row 2."] });
		expect(result.warnings).toEqual(["Unterminated quote starting in row 2."]);
	});
});

describe("S4 case-insensitive paths", () => {
	it("dry run and real run agree when a note exists with different casing", async () => {
		const t = setup({ keyColumn: "" });
		await t.put("Data/hours/entry 1.md", "mine");
		t.setSnapshot({ "Data/hours/entry 1.md": {} });
		const dry = await t.run(CSV, { dryRun: true });
		const real = await t.run(CSV);
		expect(dry.result.rows.map((r) => [r.path, r.outcome])).toEqual(real.result.rows.map((r) => [r.path, r.outcome]));
		expect(dry.result.rows[0]!.path).toBe("Data/hours/entry 1.md");
		expect([...t.app.vault.files.keys()].filter((k) => k.toLowerCase() === "data/hours/entry 1.md")).toHaveLength(1);
	});

	it("an unowned note with different casing is protected and the copy gets a free name", async () => {
		const t = setup({ keyColumn: "", conflict: "rename" });
		await t.put("Data/hours/ENTRY 1.md", "mine");
		const dry = await t.run(CSV, { dryRun: true });
		const real = await t.run(CSV);
		expect(real.result.rows[0]!.path).toBe("Data/hours/Entry 1 1.md");
		expect(dry.result.rows[0]!.path).toBe(real.result.rows[0]!.path);
		expect(t.read("Data/hours/ENTRY 1.md")).toBe("mine");
	});

	it("reuses an existing folder with different casing", async () => {
		const t = setup();
		await t.put("data/hours/other.md", "x");
		await t.run(CSV);
		expect(t.app.vault.files.has("data/hours/Entry 1.md")).toBe(true);
		expect(t.app.vault.files.has("Data/hours/Entry 1.md")).toBe(false);
	});

	it("two rows with the same name get distinct paths in dry and real runs", async () => {
		const t = setup({ keyColumn: "", fileNameTemplate: "same" });
		const dry = await t.run(CSV, { dryRun: true });
		const real = await t.run(CSV);
		expect(new Set(dry.result.rows.map((r) => r.path)).size).toBe(2);
		expect(real.result.rows.map((r) => r.path)).toEqual(dry.result.rows.map((r) => r.path));
	});
});

describe("S7 undo safety", () => {
	it("records hashes and skips notes changed after the import", async () => {
		const t = setup();
		await t.run(CSV);
		await t.app.fileManager.processFrontMatter(t.app.vault.getAbstractFileByPath("Data/hours/Entry 2.md") as never, (fm) => {
			fm.role = "Senior";
		});
		t.setSnapshot(t.getSnapshot());
		const second = await t.run(CSV_V2);
		const undo: UndoManifest = { ...second.undo, csvPath: "Data/hours.csv" };
		expect(Object.keys(undo.writtenHashes ?? {}).sort()).toEqual(["Data/hours/Entry 1.md", "Data/hours/Entry 3.md"]);
		// User edits a created and a modified note after the import.
		t.app.vault.files.set("Data/hours/Entry 3.md", t.read("Data/hours/Entry 3.md") + "\nmy text\n");
		t.app.vault.files.set("Data/hours/Entry 1.md", t.read("Data/hours/Entry 1.md") + "\nmy text\n");
		const outcome = await applyUndo(t.app as unknown as App, undo);
		expect(outcome.changed.sort()).toEqual(["Data/hours/Entry 1.md", "Data/hours/Entry 3.md"]);
		expect(outcome.trashed + outcome.restored).toBe(0);
		expect(t.app.vault.files.has("Data/hours/Entry 3.md")).toBe(true);
		const snap = applyUndoToSnapshot(t.getSnapshot(), undo, new Set(outcome.changed));
		expect(snap["Data/hours/Entry 3.md"]).toBeDefined();
	});

	it("undoes untouched notes", async () => {
		const t = setup();
		await t.run(CSV);
		const before = t.read("Data/hours/Entry 1.md");
		const { undo } = await t.run(CSV_V2);
		const outcome = await applyUndo(t.app as unknown as App, undo);
		expect(outcome).toMatchObject({ trashed: 1, restored: 1, failed: 0, changed: [] });
		expect(t.read("Data/hours/Entry 1.md")).toBe(before);
		expect(t.app.vault.files.has("Data/hours/Entry 3.md")).toBe(false);
	});

	it("checkpoints state during the run and when stopped", async () => {
		const t = setup({ fileNameTemplate: "N {{id}}" });
		const csv = "id,role\n" + Array.from({ length: 450 }, (_, i) => `${i + 1},x`).join("\n");
		const calls: number[] = [];
		const parsed = parseCsv(csv, t.cfg);
		prepareConfig(t.cfg, parsed, true);
		const notes = planNotes(parsed, t.cfg, { path: "Data/hours.csv", basename: "hours" });
		let checks = 0;
		const out = await writeNotes(t.app as unknown as App, notes, t.cfg, {
			shouldStop: () => ++checks > 300,
			onCheckpoint: (_s, u) => {
				calls.push(u.created.length);
			},
		});
		// Stopped runs always checkpoint; the count is what had been written then.
		expect(calls[calls.length - 1]).toBe(out.undo.created.length);
	});

	it("stops recording previous contents beyond the cap and warns", async () => {
		const t = setup();
		await t.run(CSV);
		const { result, undo } = await t.run(CSV_V2, { undoCap: 10 });
		expect(result.warnings).toContain(UNDO_TRUNCATED_WARNING);
		expect(undo.modified).toHaveLength(0);
		expect((undo as { truncated?: boolean }).truncated).toBe(true);
		expect(result.updated).toBe(1); // still imported
	});
});

describe("P1 progress", () => {
	it("throttles progress and ends with the final count", async () => {
		const t = setup({ keyColumn: "" });
		const csv = "id,role\n" + Array.from({ length: 3000 }, (_, i) => `${i + 1},x`).join("\n");
		const parsed = parseCsv(csv, t.cfg);
		prepareConfig(t.cfg, parsed, true);
		const notes = planNotes(parsed, t.cfg, { path: "Data/hours.csv", basename: "hours" });
		const seen: number[] = [];
		await writeNotes(t.app as unknown as App, notes, t.cfg, { dryRun: true, onProgress: (d) => seen.push(d) });
		expect(seen[seen.length - 1]).toBe(3000);
		expect(seen.length).toBeLessThan(500);
	});
});

describe("shared key property across CSVs", () => {
	const plan = (csv: string, cfg: FileImportConfig, csvPath: string) => {
		const parsed = parseCsv(csv, cfg);
		prepareConfig(cfg, parsed, true);
		return planNotes(parsed, cfg, { path: csvPath, basename: csvPath.replace(/^.*\//, "").replace(/\.csv$/, "") });
	};
	const mk = (template: string): FileImportConfig => ({
		...createDefaultFileConfig(DEFAULT_SETTINGS),
		fileNameTemplate: template,
		keyColumn: "id",
		targetFolder: "People",
	});

	it("two CSVs with the same key in one folder do not shadow each other", async () => {
		const app = new MockApp();
		const a = mk("A {{id}}");
		const b = mk("B {{id}}");
		const csv = "id,role\n1,Dev\n";
		const outA = await writeNotes(app as unknown as App, plan(csv, a, "a.csv"), a);
		expect(outA.result.created).toBe(1);
		const first = await writeNotes(app as unknown as App, plan(csv, b, "b.csv"), b);
		expect(first.result.created).toBe(1);
		expect(app.vault.files.has("People/B 1.md")).toBe(true);
		const again = await writeNotes(app as unknown as App, plan("id,role\n1,Lead\n", b, "b.csv"), b, { snapshot: first.snapshot });
		expect(again.result.updated).toBe(1);
		expect(app.vault.files.get("People/B 1.md")).toContain("Lead");
		expect(app.vault.files.get("People/A 1.md")).toContain("Dev");
	});

	it("a foreign note with the same key never blocks the CSV's own note", async () => {
		const app = new MockApp();
		const b = mk("B {{id}}");
		await app.vault.createFolder("People");
		await app.vault.create("People/Aaa hand made.md", "---\nid: 1\n---\nmine\n");
		const first = await writeNotes(app as unknown as App, plan("id,role\n1,Dev\n", b, "b.csv"), b);
		expect(first.result.created).toBe(1);
		const second = await writeNotes(app as unknown as App, plan("id,role\n1,Lead\n", b, "b.csv"), b, { snapshot: first.snapshot });
		expect(second.result.updated).toBe(1);
		expect(app.vault.files.get("People/Aaa hand made.md")).toBe("---\nid: 1\n---\nmine\n");
	});

	it("warns when every existing match was skipped as not created by this import", async () => {
		const app = new MockApp();
		const b = mk("B {{id}}");
		await app.vault.createFolder("People");
		await app.vault.create("People/B 1.md", "---\nid: 1\n---\nold\n");
		const { result } = await writeNotes(app as unknown as App, plan("id,role\n1,Dev\n", b, "b.csv"), b);
		expect(result.skipped).toBe(1);
		expect(result.warnings.some((w) => w.includes("Update notes not created by this import"))).toBe(true);
	});

	it("recognises the legacy `source` link as owned", async () => {
		const app = new MockApp();
		const b = mk("B {{id}}");
		b.addSourceLink = true;
		await app.vault.createFolder("People");
		await app.vault.create("People/B 1.md", '---\nid: 1\nsource: "[[b.csv]]"\n---\nold\n');
		// A "source" column pushes the current link property to source_csv; the legacy name must still count.
		const { result } = await writeNotes(app as unknown as App, plan("id,source\n1,Dev\n", b, "b.csv"), b);
		expect(result.skipped).toBe(0);
		expect(result.updated).toBe(1);
	});
});

describe("checkpoints", () => {
	it("checkpoints after the first written note", async () => {
		const t = setup({ fileNameTemplate: "N {{id}}" });
		const parsed = parseCsv("id,role\n1,x\n2,y\n3,z\n", t.cfg);
		prepareConfig(t.cfg, parsed, true);
		const notes = planNotes(parsed, t.cfg, { path: "Data/hours.csv", basename: "hours" });
		const seen: number[] = [];
		await writeNotes(t.app as unknown as App, notes, t.cfg, { onCheckpoint: (_s, u) => void seen.push(u.created.length) });
		expect(seen.length).toBeGreaterThanOrEqual(1);
		expect(seen[0]).toBe(1);
	});

	it("does not return before a pending checkpoint has finished", async () => {
		const t = setup({ fileNameTemplate: "N {{id}}" });
		const parsed = parseCsv("id,role\n1,x\n2,y\n", t.cfg);
		prepareConfig(t.cfg, parsed, true);
		const notes = planNotes(parsed, t.cfg, { path: "Data/hours.csv", basename: "hours" });
		let finished = false;
		vi.useFakeTimers();
		try {
			const run = writeNotes(t.app as unknown as App, notes, t.cfg, {
				onCheckpoint: async () => {
					await new Promise((r) => setTimeout(r, 30));
					finished = true;
				},
			});
			await vi.advanceTimersByTimeAsync(100);
			await run;
		} finally {
			vi.useRealTimers();
		}
		expect(finished).toBe(true);
	});
});
