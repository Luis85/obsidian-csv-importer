// writeNotesWith on hand-made planned notes: key index, conflict strategies, outcomes, warnings, checkpoints.
import type { App, TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	applyUndo,
	DUPLICATE_KEYS_IN_CSV_WARNING,
	DUPLICATE_NOTES_IN_VAULT_WARNING,
	EXTRA_PROPERTY_CONFLICT_WARNING,
	KEY_WARNING,
	LARGE_IMPORT_WARNING,
	NOT_OWNED_WARNING,
	ObsidianVaultGateway,
	ROW_FILTER_WARNING,
	writeNotesWith,
} from "../../src/import/importer";
import type { FileImportConfig, FrontmatterValue, ImportSnapshot, PlannedNote } from "../../src/types";
import { cfg } from "./helpers/harness";
import { MockApp } from "./mocks/obsidian";

/** Like Obsidian: notes without a frontmatter block have no cached frontmatter. */
class ObsidianLikeGateway extends ObsidianVaultGateway {
	constructor(private readonly mock: MockApp) {
		super(mock as unknown as App);
	}
	override frontmatter(file: TFile): Record<string, unknown> | undefined {
		return (this.mock.vault.files.get(file.path) ?? "").startsWith("---\n") ? super.frontmatter(file) : undefined;
	}
}

function note(path: string, row: number, fm: Record<string, FrontmatterValue>, key?: string): PlannedNote {
	const types = Object.fromEntries(Object.keys(fm).map((k) => [k, "text" as const]));
	return { path, frontmatter: fm, body: "", row, fillOnly: [], types, key: key === undefined ? null : { property: "id", value: key } };
}

async function put(app: MockApp, path: string, text: string): Promise<void> {
	let cur = "";
	for (const part of path.split("/").slice(0, -1)) {
		cur = cur ? `${cur}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur);
	}
	await app.vault.create(path, text);
}

const update = (over: Partial<FileImportConfig> = {}) => cfg({ conflict: "update", protectEdits: false, ...over });
/** Snapshot entries make the notes at these paths "created by this import". */
const owned = (...paths: string[]): ImportSnapshot => Object.fromEntries(paths.map((p) => [p, {}]));

function run(app: MockApp, notes: PlannedNote[], config: FileImportConfig, opts: Parameters<typeof writeNotesWith>[3] = {}) {
	return writeNotesWith(new ObsidianLikeGateway(app), notes, config, opts);
}

const hasDuplicateWarning = (warnings: string[]) => warnings.some((w) => w.includes("in the target folder share"));

describe("warning texts", () => {
	it("are plural aware and name an example", () => {
		expect(DUPLICATE_KEYS_IN_CSV_WARNING(1, "7")).toBe('1 row shares a key with another row (e.g. "7"). Only the first is imported.');
		expect(DUPLICATE_NOTES_IN_VAULT_WARNING(1, "7")).toBe(
			'1 note in the target folder shares a key with another note (e.g. "7"), for example sync conflict copies. Check them before importing.',
		);
		expect(DUPLICATE_NOTES_IN_VAULT_WARNING(3, "7")).toMatch(/^3 notes in the target folder share a key/);
		expect(ROW_FILTER_WARNING(3, 10)).toBe("Row filter: 3 of 10 rows are imported.");
		expect(EXTRA_PROPERTY_CONFLICT_WARNING("status")).toBe('Extra property "status" has the same name as a CSV column and is ignored.');
	});
});

describe("key index", () => {
	it("finds an owned note by key in nested target folders without counting it twice", async () => {
		const app = new MockApp();
		await put(app, "T/sub/x.md", "---\nid: 1\nv: old\n---\n");
		const notes = [note("T/a.md", 1, { id: "1", v: "new" }, "1"), note("T/sub/b.md", 2, { id: "2", v: "b" }, "2")];
		const { result } = await run(app, notes, update(), { snapshot: owned("T/sub/x.md") });
		expect(hasDuplicateWarning(result.warnings)).toBe(false);
		expect(result.rows[0]).toMatchObject({ outcome: "updated", path: "T/sub/x.md" });
		expect(app.vault.files.has("T/a.md")).toBe(false);
	});

	it("keeps indexing past notes without frontmatter", async () => {
		const app = new MockApp();
		await put(app, "T/a plain.md", "just text\n");
		await put(app, "T/b.md", "---\nid: 1\nv: old\n---\n");
		const { result } = await run(app, [note("T/new.md", 1, { id: "1", v: "new" }, "1")], update(), { snapshot: owned("T/b.md") });
		expect(result.rows[0]).toMatchObject({ outcome: "updated", path: "T/b.md" });
		expect(app.vault.files.has("T/new.md")).toBe(false);
	});

	it("ignores list-valued keys", async () => {
		const app = new MockApp();
		await put(app, "T/a list.md", "---\nid:\n  - 1\n---\n");
		await put(app, "T/b.md", "---\nid: 1\n---\n");
		const { result } = await run(app, [note("T/b.md", 1, { id: "1" }, "1")], update(), { snapshot: owned("T/b.md") });
		expect(hasDuplicateWarning(result.warnings)).toBe(false);
	});

	it("with two owned notes for one key, updates the first one found", async () => {
		const app = new MockApp();
		await put(app, "T/a.md", "---\nid: 1\nv: old\n---\n");
		await put(app, "T/b.md", "---\nid: 1\nv: old\n---\n");
		const { result } = await run(app, [note("T/new.md", 1, { id: "1", v: "new" }, "1")], update(), { snapshot: owned("T/a.md", "T/b.md") });
		expect(result.rows[0]).toMatchObject({ outcome: "updated", path: "T/a.md" });
		expect(result.warnings).toContain(DUPLICATE_NOTES_IN_VAULT_WARNING(2, "1"));
	});

	it("names the first duplicated key in the vault warning and counts all notes", async () => {
		const app = new MockApp();
		for (const [name, id] of [["a", "1"], ["b", "1"], ["c", "2"], ["d", "2"], ["e", "3"]] as const) await put(app, `T/${name}.md`, `---\nid: ${id}\n---\n`);
		const notes = ["1", "2", "3"].map((id, i) => note(`T/n${id}.md`, i + 1, { id }, id));
		const { result } = await run(app, notes, update(), { dryRun: true });
		expect(result.warnings).toContain(DUPLICATE_NOTES_IN_VAULT_WARNING(4, "1"));
	});

	it("adopting notes still creates notes for keys not in the vault", async () => {
		const app = new MockApp();
		const { result } = await run(app, [note("T/n.md", 1, { id: "9" }, "9")], update({ adoptExistingNotes: true }));
		expect(result.rows[0]).toMatchObject({ outcome: "created", path: "T/n.md" });
		expect(app.vault.files.get("T/n.md")).toBe('---\nid: "9"\n---\n');
	});
});

describe("key index failures", () => {
	it("are logged and the import goes on without the index", async () => {
		const app = new MockApp();
		const gateway = new ObsidianLikeGateway(app);
		gateway.listMarkdown = () => {
			throw new Error("vault busy");
		};
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			const { result } = await writeNotesWith(gateway, [note("T/a.md", 1, { id: "1" }, "1")], update());
			expect(result.rows[0]).toMatchObject({ outcome: "created", path: "T/a.md" });
			expect(error).toHaveBeenCalledWith("CSV Importer: could not index existing notes", expect.any(Error));
		} finally {
			error.mockRestore();
		}
	});
});

describe("plan warnings", () => {
	it("warns about a missing key column only for update and overwrite after a previous import", async () => {
		const notes = [note("n.md", 1, { v: "x" })];
		for (const conflict of ["update", "overwrite"] as const) {
			const { result } = await run(new MockApp(), notes, cfg({ conflict }), { dryRun: true, snapshot: owned("other.md") });
			expect(result.warnings, conflict).toContain(KEY_WARNING);
		}
		const keyed = await run(new MockApp(), notes, cfg({ conflict: "update", keyColumn: "id" }), { dryRun: true, snapshot: owned("other.md") });
		expect(keyed.result.warnings).not.toContain(KEY_WARNING);
		const skip = await run(new MockApp(), notes, cfg({ conflict: "skip" }), { dryRun: true, snapshot: owned("other.md") });
		expect(skip.result.warnings).not.toContain(KEY_WARNING);
		const first = await run(new MockApp(), notes, cfg({ conflict: "update" }), { dryRun: true });
		expect(first.result.warnings).not.toContain(KEY_WARNING);
	});

	it("warns about large imports above 5000 notes", async () => {
		const many = (n: number) => Array.from({ length: n }, (_, i) => note(`n${i}.md`, i + 1, { v: "x" }));
		const at = await run(new MockApp(), many(5000), cfg(), { dryRun: true });
		expect(at.result.warnings).not.toContain(LARGE_IMPORT_WARNING(5000));
		const above = await run(new MockApp(), many(5001), cfg(), { dryRun: true });
		expect(above.result.warnings).toContain(LARGE_IMPORT_WARNING(5001));
	});

	it("warns about extra properties named like a column", async () => {
		const config = cfg({
			columns: [{ source: "Status", index: 0, property: "status", type: "text", include: true }],
			extraProperties: [{ property: "Status", type: "text", defaultValue: "x" }],
		});
		const { result } = await run(new MockApp(), [note("n.md", 1, { status: "a" })], config, { dryRun: true });
		expect(result.warnings).toContain(EXTRA_PROPERTY_CONFLICT_WARNING("Status"));
	});

	it("warns about notes not created by this import only when no note was updated or unchanged", async () => {
		const app = new MockApp();
		await put(app, "a.md", "---\nv: old\n---\n");
		await put(app, "b.md", "---\nv: same\n---\n");
		await put(app, "c.md", "---\nv: foreign\n---\n");
		const notes = [note("a.md", 1, { v: "new" }), note("b.md", 2, { v: "same" }), note("c.md", 3, { v: "x" })];
		const { result } = await run(app, notes, update(), { snapshot: owned("a.md", "b.md") });
		expect(result.rows.map((r) => r.outcome)).toEqual(["updated", "unchanged", "skipped"]);
		expect(result.warnings).not.toContain(NOT_OWNED_WARNING);
	});
});

describe("outcomes", () => {
	it("a row whose path is a folder fails, the rest is imported", async () => {
		const app = new MockApp();
		await app.vault.createFolder("x.md");
		const { result } = await run(app, [note("x.md", 1, { v: "1" }), note("y.md", 2, { v: "2" })], update());
		expect(result.rows[0]).toEqual({ row: 1, path: "x.md", outcome: "failed", reason: '"x.md" exists and is a folder' });
		expect(result.errors).toEqual([{ row: 1, message: '"x.md" exists and is a folder' }]);
		expect(result).toMatchObject({ failed: 1, skipped: 0, created: 1 });
	});

	it("skips later rows with a key already imported in this run", async () => {
		const app = new MockApp();
		const notes = [note("a.md", 1, { id: "1" }, "1"), note("b.md", 2, { id: "1" }, "1")];
		const { result } = await run(app, notes, update());
		expect(result.rows[1]).toEqual({ row: 2, path: "b.md", outcome: "skipped", reason: "duplicate key" });
		expect(result.errors).toEqual([{ row: 2, message: 'duplicate key "1"' }]);
		expect(app.vault.files.has("b.md")).toBe(false);
	});

	it("two rows with the same file name both create notes, also in a real run", async () => {
		const app = new MockApp();
		const { result } = await run(app, [note("same.md", 1, { v: "1" }), note("same.md", 2, { v: "2" })], update());
		expect(result.rows.map((r) => [r.outcome, r.path])).toEqual([
			["created", "same.md"],
			["created", "same 1.md"],
		]);
		expect(app.vault.files.get("same.md")).toBe('---\nv: "1"\n---\n');
	});

	it("a path already used by a key-matched update goes to a free name", async () => {
		for (const conflict of ["update", "overwrite"] as const) {
			const app = new MockApp();
			await put(app, "T/old.md", "---\nid: 1\n---\n");
			const notes = [note("T/one.md", 1, { id: "1", v: "a" }, "1"), note("T/old.md", 2, { id: "2" }, "2")];
			const { result } = await run(app, notes, update({ conflict }), { snapshot: owned("T/old.md") });
			expect(result.rows.map((r) => [r.outcome, r.path]), conflict).toEqual([
				["updated", "T/old.md"],
				["created", "T/old 1.md"],
			]);
		}
	});

	it("a note at the path without a key property is updated by a keyed row", async () => {
		const app = new MockApp();
		await put(app, "T/1.md", "---\nv: old\n---\n");
		const { result } = await run(app, [note("T/1.md", 1, { id: "1", v: "new" }, "1")], update(), { snapshot: owned("T/1.md") });
		expect(result.rows[0]).toMatchObject({ outcome: "updated", path: "T/1.md" });
	});
});

describe("update", () => {
	it("reports preserved properties only when there are some", async () => {
		const app = new MockApp();
		await put(app, "a.md", "---\nv: old\n---\n");
		const { result } = await run(app, [note("a.md", 1, { v: "new" })], update(), { snapshot: owned("a.md") });
		expect(result.rows[0]?.outcome).toBe("updated");
		expect(result.rows[0]?.preserved).toBeUndefined();
	});

	it("records the snapshot of an unchanged note in real runs", async () => {
		const app = new MockApp();
		await put(app, "a.md", "---\nv: same\n---\n");
		const { result, snapshot } = await run(app, [note("a.md", 1, { v: "same" })], update(), { snapshot: owned("a.md") });
		expect(result.rows[0]?.outcome).toBe("unchanged");
		expect(Object.keys(snapshot["a.md"] ?? {})).toEqual(["v"]);
	});
});

describe("overwrite", () => {
	const overwrite = () => cfg({ conflict: "overwrite" });

	it("replaces the whole note, body included, and keeps the old text for undo", async () => {
		const app = new MockApp();
		await put(app, "a.md", "---\nv: old\nmine: 1\n---\nbody\n");
		const { result, undo, snapshot } = await run(app, [{ ...note("a.md", 1, { v: "new" }), body: "fresh" }], overwrite(), { snapshot: owned("a.md") });
		expect(result.rows[0]).toEqual({ row: 1, path: "a.md", outcome: "updated", changed: ["v"] });
		expect(app.vault.files.get("a.md")).toBe("---\nv: new\n---\nfresh\n");
		expect(undo.modified.map((m) => m.path)).toEqual(["a.md"]);
		expect(Object.keys(snapshot["a.md"] ?? {})).toEqual(["v"]);
	});

	it("an overwritten note can be undone", async () => {
		const app = new MockApp();
		await put(app, "a.md", "---\nv: old\n---\nbody\n");
		const { undo } = await run(app, [note("a.md", 1, { v: "new" })], overwrite(), { snapshot: owned("a.md") });
		const outcome = await applyUndo(app as unknown as App, undo);
		expect(outcome).toMatchObject({ restored: 1, failed: 0, changed: [] });
		expect(app.vault.files.get("a.md")).toBe("---\nv: old\n---\nbody\n");
	});

	it("leaves an identical note alone", async () => {
		const app = new MockApp();
		await put(app, "a.md", "---\nv: same\n---\n");
		const { result, undo } = await run(app, [note("a.md", 1, { v: "same" })], overwrite(), { snapshot: owned("a.md") });
		expect(result.rows[0]).toEqual({ row: 1, path: "a.md", outcome: "unchanged" });
		expect(undo.modified).toEqual([]);
	});

	it("dry run reports the update without writing", async () => {
		const app = new MockApp();
		await put(app, "a.md", "---\nv: old\n---\n");
		const { result } = await run(app, [note("a.md", 1, { v: "new" })], overwrite(), { dryRun: true, snapshot: owned("a.md") });
		expect(result.rows[0]?.outcome).toBe("updated");
		expect(app.vault.files.get("a.md")).toBe("---\nv: old\n---\n");
	});
});

describe("rename", () => {
	const rename = () => cfg({ conflict: "rename" });

	it("a note matched by key is updated, not copied", async () => {
		const app = new MockApp();
		await put(app, "T/a.md", "---\nid: 1\nv: old\n---\n");
		const { result } = await run(app, [note("T/a.md", 1, { id: "1", v: "new" }, "1")], rename(), { snapshot: owned("T/a.md") });
		expect(result.rows[0]).toMatchObject({ outcome: "updated", path: "T/a.md" });
		expect(app.vault.files.has("T/a 1.md")).toBe(false);
	});

	it("an owned note matched only by path gets a copy under a free name", async () => {
		const app = new MockApp();
		await put(app, "a.md", "---\nv: old\n---\n");
		const { result } = await run(app, [note("a.md", 1, { v: "new" })], rename(), { snapshot: owned("a.md") });
		expect(result.rows[0]).toMatchObject({ outcome: "created", path: "a 1.md" });
		expect(app.vault.files.get("a.md")).toBe("---\nv: old\n---\n");
	});
});

describe("dry runs", () => {
	it("return the given snapshot and never checkpoint", async () => {
		const app = new MockApp();
		const onCheckpoint = vi.fn();
		const given = { "old.md": { v: "h" } };
		const { result, snapshot } = await run(app, [note("a.md", 1, { v: "1" })], update(), { dryRun: true, snapshot: given, onCheckpoint });
		expect(result.rows[0]).toMatchObject({ outcome: "created", reason: "would create" });
		expect(snapshot).toEqual(given);
		expect(snapshot).not.toBe(given);
		expect(onCheckpoint).not.toHaveBeenCalled();
	});
});

describe("checkpoints and progress over time", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	/** Runs with a fake clock that advances `step` ms per row (shouldStop runs before each row). */
	async function timed(rows: PlannedNote[], step: number, config: FileImportConfig, snapshot?: ImportSnapshot, app = new MockApp()) {
		vi.useFakeTimers({ toFake: ["performance"] });
		const checkpoints: number[] = [];
		const progress: number[] = [];
		const out = await run(app, rows, config, {
			snapshot,
			shouldStop: () => {
				vi.advanceTimersByTime(step);
				return false;
			},
			onCheckpoint: (_s, u) => void checkpoints.push(u.created.length + u.modified.length),
			onProgress: (d) => void progress.push(d),
		});
		return { out, checkpoints, progress };
	}

	it("checkpoints once after the first note when the run is quick", async () => {
		const rows = Array.from({ length: 3 }, (_, i) => note(`n${i}.md`, i + 1, { v: "x" }));
		const { checkpoints } = await timed(rows, 0, update());
		expect(checkpoints).toEqual([1]);
	});

	it("checkpoints after the first updated note too", async () => {
		const app = new MockApp();
		await put(app, "a.md", "---\nv: old\n---\n");
		await put(app, "b.md", "---\nv: old\n---\n");
		const rows = [note("a.md", 1, { v: "new" }), note("b.md", 2, { v: "new" })];
		const { checkpoints } = await timed(rows, 0, update(), owned("a.md", "b.md"), app);
		expect(checkpoints).toEqual([1]);
	});

	it("checkpoints again after 200 more written notes", async () => {
		const rows = Array.from({ length: 260 }, (_, i) => note(`n${i}.md`, i + 1, { v: "x" }));
		const { checkpoints } = await timed(rows, 3, update());
		expect(checkpoints).toEqual([1, 201]);
	});

	it("reports progress whenever more than 12 ms passed since the last report", async () => {
		const rows = Array.from({ length: 5 }, (_, i) => note(`n${i}.md`, i + 1, { v: "x" }));
		expect((await timed(rows, 20, cfg())).progress).toEqual([1, 2, 3, 4, 5, 5]);
		expect((await timed(rows, 12, cfg())).progress).toEqual([2, 4, 5]);
	});
});
