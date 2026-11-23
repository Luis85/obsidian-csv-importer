import { describe, expect, it } from "vitest";
import { uuidV4 } from "../src/core/util";
import { parseCsv } from "../src/csv/parser";
import { prepareConfig } from "../src/csv/typeInference";
import { planNotes, serializeNote } from "../src/import/noteBuilder";
import { cfg, setup } from "./helpers/harness";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuid generator", () => {
	it("produces RFC 4122 v4 UUIDs", () => {
		const ids = new Set(Array.from({ length: 200 }, () => uuidV4()));
		expect(ids.size).toBe(200);
		for (const id of ids) expect(id).toMatch(UUID);
	});

	it("{{uuid}} gives every note its own ID, written as text", () => {
		const c = cfg({ extraProperties: [{ property: "note id", type: "text", defaultValue: "{{uuid}}" }] });
		const parsed = parseCsv("a,b\n1,x\n2,y\n", c);
		prepareConfig(c, parsed, true);
		const notes = planNotes(parsed, c, { path: "d.csv", basename: "d" });
		const ids = notes.map((n) => n.frontmatter["note id"]);
		expect(new Set(ids).size).toBe(2);
		for (const id of ids) expect(id).toMatch(UUID);
		expect(notes[0]!.fillOnly).toContain("note id");
		expect(serializeNote(notes[0]!.frontmatter, notes[0]!.body, notes[0]!.types)).toMatch(/^note id: "?[0-9a-f-]{36}"?$/m);
	});

	it("can be combined with text and is injectable for tests", () => {
		let n = 0;
		const c = cfg({ extraProperties: [{ property: "ref", type: "text", defaultValue: "R-{{uuid}}-{{row}}" }] });
		const parsed = parseCsv("a\n1\n2\n", c);
		prepareConfig(c, parsed, true);
		const notes = planNotes(parsed, c, { path: "d.csv", basename: "d" }, { uuid: () => `u${++n}` });
		expect(notes.map((x) => x.frontmatter.ref)).toEqual(["R-u1-1", "R-u2-2"]);
	});

	it("keeps the ID stable across re-imports (fill-only)", async () => {
		const t = setup({ extraProperties: [{ property: "id", type: "text", defaultValue: "{{uuid}}" }], keyColumn: "a" });
		await t.run("a,b\n1,x\n");
		const path = [...t.app.vault.files.keys()].find((p) => p.endsWith(".md"))!;
		const first = t.fm(path).id;
		expect(String(first)).toMatch(UUID);
		await t.run("a,b\n1,changed\n");
		expect(t.fm(path).id).toBe(first);
		expect(t.fm(path).b).toBe("changed");
	});
});
