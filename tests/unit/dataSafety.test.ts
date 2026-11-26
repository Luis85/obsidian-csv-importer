// Data-safety regressions found in the review before 1.0: each test reproduces a way user data was lost or a
// note stopped updating.
import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/csv/parser";
import type { App } from "obsidian";
import { applyUndo, applyUndoToSnapshot, outermostFolders } from "../../src/import/importer";
import { matchesHash, valueHash } from "../../src/import/merge";
import { cfg, setup } from "./helpers/harness";

const NOTE = "Data/hours/Entry 1.md";

describe("line breaks inside quoted cells", () => {
	it("become LF, whatever the CSV uses", () => {
		const { rows } = parseCsv('id,notes\r\n1,"a\r\nb\rc\nd"\r\n', cfg());
		expect(rows[0]?.[1]).toBe("a\nb\nc\nd");
	});

	it("a changed multi-line cell from a CRLF CSV updates the note on re-import", async () => {
		const t = setup({ conflict: "update" });
		await t.run('id,notes\r\n1,"line a\r\nline b"\r\n');
		const again = await t.run('id,notes\r\n1,"line a\r\nline b"\r\n');
		expect(again.result.rows[0]?.outcome).toBe("unchanged");
		const changed = await t.run('id,notes\r\n1,"line a\r\nline CHANGED"\r\n');
		expect(changed.result.rows[0]?.outcome).toBe("updated");
		expect(t.fm(NOTE).notes).toBe("line a\nline CHANGED");
	});

	it("a snapshot written before the fix (CRLF hash) does not count as an edit", async () => {
		const t = setup({ conflict: "update" });
		await t.run('id,notes\n1,"line a\nline b"\n');
		const s = t.getSnapshot();
		s[NOTE]!.notes = valueHash("line a\r\nline b");
		t.setSnapshot(s);
		const r = await t.run('id,notes\n1,"line a\nline CHANGED"\n');
		expect(r.result.rows[0]?.outcome).toBe("updated");
		expect(t.fm(NOTE).notes).toBe("line a\nline CHANGED");
	});

	it("matchesHash still tells an edited multi-line value apart", () => {
		expect(matchesHash("a\nb", valueHash("a\r\nb"))).toBe(true);
		expect(matchesHash("a\nb", valueHash("a\nb"))).toBe(true);
		expect(matchesHash("a\nB", valueHash("a\r\nb"))).toBe(false);
		expect(matchesHash(3, valueHash(3))).toBe(true);
	});
});

describe("omitted empty properties of notes imported before 0.4.1", () => {
	it("a value added in Obsidian is protected once the CSV gets a value", async () => {
		const t = setup({ conflict: "update", emptyValues: "omit" });
		await t.run("id,role,x\n1,,a\n");
		const s = t.getSnapshot();
		delete s[NOTE]!.role; // 0.4.0 recorded no entry for an omitted property
		t.setSnapshot(s);
		await t.editInBases(NOTE, (fm) => {
			fm.role = "Mine";
		});
		await t.run("id,role,x\n1,,b\n");
		expect(t.getSnapshot()[NOTE]?.role).toBe(valueHash(null));
		const r = await t.run("id,role,x\n1,Dev,b\n");
		expect(r.result.rows[0]?.preserved).toEqual(["role"]);
		expect(t.fm(NOTE).role).toBe("Mine");
	});

	it("a first import into an adopted note records nothing for it", async () => {
		const t = setup({ conflict: "update", emptyValues: "omit", adoptExistingNotes: true });
		await t.put(NOTE, "---\nid: 1\nrole: Mine\n---\n");
		await t.run("id,role\n1,\n");
		expect(t.getSnapshot()[NOTE]?.role).toBeUndefined();
	});
});

describe("rows whose note is in another folder than planned", () => {
	it("a row that moves to another placeholder folder updates its note instead of creating a second one", async () => {
		const t = setup({ targetFolder: "P/{{status}}", conflict: "update" });
		await t.run("id,status\n1,Open\n");
		const r = await t.run("id,status\n1,Done\n");
		expect(r.result.rows[0]).toMatchObject({ outcome: "updated", path: "P/Open/Entry 1.md" });
		expect([...t.app.vault.files.keys()].filter((p) => p.endsWith(".md"))).toEqual(["P/Open/Entry 1.md"]);
	});

	it("finds a note the user moved to a sibling folder", async () => {
		const t = setup({ targetFolder: "P/{{status}}", conflict: "update" });
		await t.run("id,status,x\n1,Open,a\n");
		await t.put("P/Archive/.keep.md", "");
		t.app.vault.rename("P/Open/Entry 1.md", "P/Archive/Entry 1.md");
		const s = t.getSnapshot();
		s["P/Archive/Entry 1.md"] = s["P/Open/Entry 1.md"]!; // the plugin re-keys the snapshot on rename
		delete s["P/Open/Entry 1.md"];
		t.setSnapshot(s);
		const r = await t.run("id,status,x\n1,Open,b\n");
		expect(r.result.rows[0]).toMatchObject({ outcome: "updated", path: "P/Archive/Entry 1.md" });
	});

	it("outermostFolders drops folders inside others", () => {
		expect(outermostFolders(["a/b", "a", "c/d", "c/d/e", "cd"])).toEqual(["a", "cd", "c/d"]);
		expect(outermostFolders(["a", ""])).toEqual([""]);
	});
});

describe("an undo that was interrupted", () => {
	it("can be run again: restored notes count as restored and a later re-import updates them", async () => {
		const t = setup({ conflict: "update" });
		await t.run("id,role\n1,Dev\n");
		const out = await t.run("id,role\n1,Lead\n");
		const app = t.app as unknown as App;
		await applyUndo(app, out.undo); // Obsidian closed before the state was saved
		const again = await applyUndo(app, out.undo);
		expect(again).toMatchObject({ restored: 1, changed: [] });
		t.setSnapshot(applyUndoToSnapshot(t.getSnapshot(), out.undo, new Set(again.changed)));
		expect(t.fm(NOTE).role).toBe("Dev");
		const r = await t.run("id,role\n1,Lead\n");
		expect(r.result.rows[0]?.outcome).toBe("updated");
		expect(t.fm(NOTE).role).toBe("Lead");
	});

	it("still leaves a note alone that was edited after the import", async () => {
		const t = setup({ conflict: "update" });
		await t.run("id,role\n1,Dev\n");
		const out = await t.run("id,role\n1,Lead\n");
		await t.editInBases(NOTE, (fm) => {
			fm.role = "Mine";
		});
		const r = await applyUndo(t.app as unknown as App, out.undo);
		expect(r.changed).toEqual([NOTE]);
		expect(t.fm(NOTE).role).toBe("Mine");
	});
});

describe("an edit the metadata cache has not caught up with", () => {
	it("is still recognized when the note is updated", async () => {
		const t = setup({ conflict: "update" });
		await t.run("id,role,x\n1,Dev,a\n");
		const stale = t.app.metadataCache.getFileCache;
		const cached = { frontmatter: t.fm(NOTE) };
		t.app.metadataCache.getFileCache = () => cached; // still shows role: Dev
		await t.editInBases(NOTE, (fm) => {
			fm.role = "Mine";
		});
		const r = await t.run("id,role,x\n1,Lead,b\n");
		t.app.metadataCache.getFileCache = stale;
		expect(r.result.rows[0]).toMatchObject({ outcome: "updated", preserved: ["role"], changed: ["x"] });
		expect(t.fm(NOTE)).toMatchObject({ role: "Mine", x: "b" });
	});
});

describe("long note paths", () => {
	it("are named in a preview warning", async () => {
		const t = setup({ fileNameTemplate: "{{name}}", keyColumn: "" });
		const r = await t.run(`name\n${"x".repeat(220)}\nshort\n`, true);
		expect(r.result.warnings.some((w) => w.startsWith("1 note path is longer than 200 characters"))).toBe(true);
	});
});
