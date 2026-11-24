import { describe, expect, it } from "vitest";
import {
	planNotes,
	renderTemplate,
	resolveRowFolder,
	resolveTargetFolder,
	sourceLinkProperty,
	sanitizeFileName,
	serializeNote,
} from "../../src/import/noteBuilder";
import { parseCsv } from "../../src/csv/parser";
import { buildColumnConfigs, suggestKeyColumn } from "../../src/csv/typeInference";
import { cfg } from "./helpers/harness";

describe("renderTemplate", () => {
	const ctx = { headers: ["Name", "Age"], row: ["Ann", " 5 "], rowNumber: 3, fileBasename: "people" };
	it("replaces placeholders", () => {
		expect(renderTemplate("{{Name}} ({{ Age }}) #{{row}} from {{file}}", ctx)).toBe("Ann (5) #3 from people");
	});
	it("unknown -> empty, case-sensitive", () => {
		expect(renderTemplate("[{{Nope}}][{{name}}]", ctx)).toBe("[][]");
	});
	it("leaves plain text alone", () => {
		expect(renderTemplate("no placeholders { }", ctx)).toBe("no placeholders { }");
	});
});

describe("sanitizeFileName", () => {
	it("strips forbidden characters", () => {
		expect(sanitizeFileName('a\\b/c:d*e?f"g<h>i|j#k^l[m]n')).toBe("abcdefghijklmn");
	});
	it("collapses whitespace and control chars, trims dots", () => {
		expect(sanitizeFileName("  a \t\n b\u0001c.. ")).toBe("a b c");
		expect(sanitizeFileName("...")).toBe("");
		expect(sanitizeFileName("")).toBe("");
	});
	it("limits length", () => {
		expect(sanitizeFileName("x".repeat(300)).length).toBe(240);
	});
	it("keeps unicode", () => {
		expect(sanitizeFileName("Größe Übung")).toBe("Größe Übung");
	});
});

describe("resolveTargetFolder", () => {
	it("defaults to a folder named like the csv", () => {
		expect(resolveTargetFolder(cfg(), "hours.csv")).toBe("hours");
		expect(resolveTargetFolder(cfg(), "Data/hours.csv")).toBe("Data/hours");
		expect(resolveTargetFolder(cfg(), "A/B/my.data.csv")).toBe("A/B/my.data");
	});
	it("normalizes an explicit folder", () => {
		expect(resolveTargetFolder(cfg({ targetFolder: "/Notes//Sub/" }), "x.csv")).toBe("Notes/Sub");
		expect(resolveTargetFolder(cfg({ targetFolder: "Notes\\Sub" }), "x.csv")).toBe("Notes/Sub");
		expect(resolveTargetFolder(cfg({ targetFolder: "/" }), "x.csv")).toBe("");
	});
});

describe("planNotes", () => {
	const csv = { path: "Data/hours.csv", basename: "hours" };

	it("plans one note per row with typed frontmatter", () => {
		const parsed = parseCsv("Name,Qty,Done\nA,1.5,yes\nB,,no", { delimiter: ",", hasHeader: true });
		const notes = planNotes(parsed, cfg({ fileNameTemplate: "{{Name}}", bodyTemplate: "Qty: {{Qty}}" }), csv);
		expect(notes).toHaveLength(2);
		expect(notes[0]).toEqual({
			path: "Data/hours/A.md",
			frontmatter: { Name: "A", Qty: 1.5, Done: true },
			body: "Qty: 1.5",
			row: 1,
			fillOnly: [],
			types: { Name: "text", Qty: "number", Done: "checkbox" },
			key: null,
		});
		expect(notes[1]!.frontmatter).toEqual({ Name: "B", Qty: null, Done: false });
	});

	it("respects include=false and uses configured columns", () => {
		const parsed = parseCsv("a,b\n1,2", { delimiter: ",", hasHeader: true });
		const columns = buildColumnConfigs(parsed, { decimalSeparator: ".", midnightAsDate: false, listSeparator: "," });
		columns[0]!.include = false;
		columns[1]!.type = "text";
		columns[1]!.property = "B";
		const n = planNotes(parsed, cfg({ columns }), csv)[0]!;
		expect(n.frontmatter).toEqual({ B: "2" });
	});

	it("adds tags and source link", () => {
		const parsed = parseCsv("a\n1", { delimiter: ",", hasHeader: true });
		const n = planNotes(parsed, cfg({ tags: " #foo, bar baz ,, foo ", addSourceLink: true }), csv)[0]!;
		expect(n.frontmatter.tags).toEqual(["foo", "bar-baz"]);
		expect(n.frontmatter.source).toBe("[[Data/hours.csv]]");
	});

	it("merges config tags with a tags column", () => {
		const parsed = parseCsv("tags\n\"x, #y\"", { delimiter: ",", hasHeader: true });
		const columns = buildColumnConfigs(parsed, { decimalSeparator: ".", midnightAsDate: false, listSeparator: "," });
		columns[0]!.type = "list";
		const n = planNotes(parsed, cfg({ columns, tags: "imported" }), csv)[0]!;
		expect(n.frontmatter.tags).toEqual(["x", "y", "imported"]);
	});

	it("falls back to <file> <row> for empty names and dedupes paths", () => {
		const parsed = parseCsv("Name,Other\n,x\nA,\nA,\na,", { delimiter: ",", hasHeader: true });
		// rows: "", A, A, a
		const notes = planNotes(parsed, cfg({ fileNameTemplate: "{{Name}}" }), { path: "x.csv", basename: "x" });
		expect(notes.map((n) => n.path)).toEqual(["x/x 1.md", "x/A.md", "x/A 2.md", "x/a 3.md"]);
	});

	it("uses no leading slash for the vault root", () => {
		const parsed = parseCsv("a\n1", { delimiter: ",", hasHeader: true });
		const n = planNotes(parsed, cfg({ targetFolder: "/" }), csv)[0]!;
		expect(n.path).toBe("hours 1.md");
	});

	it("uses a custom target folder", () => {
		const parsed = parseCsv("a\n1", { delimiter: ",", hasHeader: true });
		const n = planNotes(parsed, cfg({ targetFolder: "Out/Put/" }), csv)[0]!;
		expect(n.path).toBe("Out/Put/hours 1.md");
	});
});

describe("serializeNote", () => {
	it("writes numbers, booleans and nulls unquoted", () => {
		const out = serializeNote({ a: 0.625, b: 5, c: true, d: false, e: null }, "");
		expect(out).toBe("---\na: 0.625\nb: 5\nc: true\nd: false\ne:\n---\n");
	});
	it("quotes strings that could be misread", () => {
		const out = serializeNote(
			{
				num: "123",
				f: "1.5",
				b: "true",
				yn: "yes",
				nul: "null",
				colon: "a: b",
				hash: "a #b",
				dash: "- x",
				lead: " x",
				nl: "a\nb",
				empty: "",
				q: 'say "hi"',
				tilde: "~",
			},
			"",
		);
		expect(out).toContain('num: "123"');
		expect(out).toContain('f: "1.5"');
		expect(out).toContain('b: "true"');
		expect(out).toContain('yn: "yes"');
		expect(out).toContain('nul: "null"');
		expect(out).toContain('colon: "a: b"');
		expect(out).toContain('hash: "a #b"');
		expect(out).toContain('dash: "- x"');
		expect(out).toContain('lead: " x"');
		expect(out).toContain('nl: "a\\nb"');
		expect(out).toContain('empty: ""');
		expect(out).toContain('q: say "hi"');
		expect(out).toContain('tilde: "~"');
	});
	it("writes plain safe words and unicode unquoted", () => {
		const out = serializeNote({ a: "Softwareentwickler", b: "Architektur und Harness Vorbereitung Backend", c: "Größe" }, "");
		expect(out).toContain("a: Softwareentwickler\n");
		expect(out).toContain("b: Architektur und Harness Vorbereitung Backend\n");
		expect(out).toContain("c: Größe\n");
	});
	it("writes date/datetime strings unquoted only for date-typed keys", () => {
		const out = serializeNote(
			{ d: "2026-11-18", t: "2026-11-18T08:30:00" },
			"",
			{ d: "date", t: "datetime" },
		);
		expect(out).toContain("d: 2026-11-18\n");
		expect(out).toContain("t: 2026-11-18T08:30:00\n");
	});
	it("writes lists as block sequences", () => {
		const out = serializeNote({ l: ["a", "1", "b c"], e: [] }, "");
		expect(out).toBe('---\nl:\n  - a\n  - "1"\n  - b c\ne: []\n---\n');
	});
	it("quotes the source wikilink and special keys", () => {
		const out = serializeNote({ source: "[[Data/x.csv]]", "my key": 1, "a: b": 2, "123": 3, "": 4 }, "");
		expect(out).toContain('source: "[[Data/x.csv]]"');
		expect(out).toContain("my key: 1");
		expect(out).toContain('"a: b": 2');
		expect(out).toContain('"123": 3');
		expect(out).toContain('"": 4');
	});
	it("appends the body and ends with a newline", () => {
		expect(serializeNote({ a: 1 }, "Hello")).toBe("---\na: 1\n---\nHello\n");
		expect(serializeNote({ a: 1 }, "Hello\n")).toBe("---\na: 1\n---\nHello\n");
	});
	it("handles empty frontmatter", () => {
		expect(serializeNote({}, "x")).toBe("---\n---\nx\n");
	});
	it("escapes unicode line separators", () => {
		expect(serializeNote({ a: "x y" }, "")).toContain('a: "x\\u2028y"');
	});
});

describe("end to end", () => {
	const example = (header: string, row: string, sep: string, dec: "." | ",") => {
		const text = `${header}\n${row}\n`;
		const parsed = parseCsv(text, { delimiter: "auto", hasHeader: true });
		expect(parsed.delimiter).toBe(sep);
		const opts = { decimalSeparator: dec, midnightAsDate: true, listSeparator: "," };
		const columns = buildColumnConfigs(parsed, opts);
		expect(columns.map((c) => c.type)).toEqual(["date", "text", "text", "number", "number"]);
		const note = planNotes(parsed, cfg({ columns, decimalSeparator: dec, fileNameTemplate: "{{Beschreibung}}" }), {
			path: "hours.csv",
			basename: "hours",
		})[0]!;
		return serializeNote(note.frontmatter, note.body, note.types);
	};

	it("comma file with dot decimals", () => {
		const yaml = example(
			"Datum,Rolle,Beschreibung,Stunden,Tage",
			"2026-11-18 00:00:00,Softwareentwickler,Architektur und Harness Vorbereitung Backend,0.625,5",
			",",
			".",
		);
		expect(yaml).toContain("Stunden: 0.625\n");
		expect(yaml).toContain("Tage: 5\n");
		expect(yaml).toContain("Datum: 2026-11-18\n");
		expect(yaml).toContain("Rolle: Softwareentwickler\n");
	});

	it("semicolon file with decimal comma", () => {
		const yaml = example(
			"Datum;Rolle;Beschreibung;Stunden;Tage",
			"2026-11-18 00:00:00;Softwareentwickler;Architektur und Harness Vorbereitung Backend;0,625;5",
			";",
			",",
		);
		expect(yaml).toContain("Stunden: 0.625\n");
		expect(yaml).toContain("Tage: 5\n");
		expect(yaml).toContain("Datum: 2026-11-18\n");
		expect(yaml).not.toMatch(/Stunden: "/);
		expect(yaml).not.toMatch(/Tage: "/);
	});

	it("without midnightAsDate the datetime is kept", () => {
		const parsed = parseCsv("Datum;Tage\n2026-11-18 00:00:00;5", { delimiter: "auto", hasHeader: true });
		const columns = buildColumnConfigs(parsed, { decimalSeparator: ",", midnightAsDate: false, listSeparator: "," });
		const note = planNotes(parsed, cfg({ columns, decimalSeparator: "," }), { path: "h.csv", basename: "h" })[0]!;
		expect(serializeNote(note.frontmatter, "", note.types)).toContain("Datum: 2026-11-18T00:00:00\n");
	});
});

describe("folder placeholders", () => {
	const csv = { path: "Data/p.csv", basename: "p" };
	it("renders per-row subfolders, sanitized, empty segments dropped", () => {
		const parsed = parseCsv("Client,Year,Name\nAcme/Co,2024,A\n,2025,B\n", { delimiter: ",", hasHeader: true });
		const notes = planNotes(parsed, cfg({ targetFolder: "Projects/{{Client}}/{{Year}}", fileNameTemplate: "{{Name}}" }), csv);
		expect(notes.map((n) => n.path)).toEqual(["Projects/AcmeCo/2024/A.md", "Projects/2025/B.md"]);
	});
	it("resolveRowFolder works with row/file and static folders", () => {
		const ctx = { headers: ["C"], row: ["x"], rowNumber: 4, fileBasename: "f" };
		expect(resolveRowFolder(cfg({ targetFolder: "A/{{file}}-{{row}}" }), "d/f.csv", ctx)).toBe("A/f-4");
		expect(resolveRowFolder(cfg({ targetFolder: "A/B" }), "d/f.csv", ctx)).toBe("A/B");
		expect(resolveRowFolder(cfg({ targetFolder: "" }), "d/f.csv", ctx)).toBe("d/f");
	});
	it("duplicate detection is per full path", () => {
		const parsed = parseCsv("C,N\nx,A\ny,A\nx,A\n", { delimiter: ",", hasHeader: true });
		const notes = planNotes(parsed, cfg({ targetFolder: "F/{{C}}", fileNameTemplate: "{{N}}" }), csv);
		expect(notes.map((n) => n.path)).toEqual(["F/x/A.md", "F/y/A.md", "F/x/A 2.md"]);
	});
});

describe("tags / aliases / cssclasses normalization", () => {
	const csv = { path: "d/p.csv", basename: "p" };
	it("normalizes text columns into lists", () => {
		const parsed = parseCsv("tags,aliases,cssclasses\n\"#a, #b c ,a\",\"X, Y,,X\",wide\n", { delimiter: ",", hasHeader: true });
		const columns = buildColumnConfigs(parsed, { decimalSeparator: ".", midnightAsDate: false, listSeparator: ";" });
		const n = planNotes(parsed, cfg({ columns }), csv)[0]!;
		expect(n.frontmatter["tags"]).toEqual(["a", "b", "c"]);
		expect(n.frontmatter["aliases"]).toEqual(["X", "Y"]);
		expect(n.frontmatter["cssclasses"]).toEqual(["wide"]);
		expect(n.types["tags"]).toBe("list");
		expect(n.types["aliases"]).toBe("list");
	});
	it("list-typed tags: spaces become dashes; merged with config tags", () => {
		const parsed = parseCsv("tags\n#my tag;#x\n", { delimiter: ",", hasHeader: true });
		const columns = buildColumnConfigs(parsed, { decimalSeparator: ".", midnightAsDate: false, listSeparator: ";" });
		columns[0]!.type = "list";
		const n = planNotes(parsed, cfg({ columns, listSeparator: ";", tags: "x, new" }), csv)[0]!;
		expect(n.frontmatter["tags"]).toEqual(["my-tag", "x", "new"]);
	});
	it("empty cell -> empty property or omitted", () => {
		const parsed = parseCsv("tags,n\n,1\n", { delimiter: ",", hasHeader: true });
		expect(planNotes(parsed, cfg(), csv)[0]!.frontmatter["tags"]).toBeNull();
		expect("tags" in planNotes(parsed, cfg({ emptyValues: "omit" }), csv)[0]!.frontmatter).toBe(false);
	});
});

const csv = { path: "hours.csv", basename: "hours" };

describe("S2 sourceLinkProperty", () => {
	const col = (property: string, index = 0) => ({ source: property, index, property, type: "text" as const, include: true });
	it("is null when addSourceLink is off", () => {
		expect(sourceLinkProperty(cfg())).toBeNull();
	});
	it("is 'source' normally and source_csv when a column uses 'source'", () => {
		expect(sourceLinkProperty(cfg({ addSourceLink: true, columns: [col("a")] }))).toBe("source");
		expect(sourceLinkProperty(cfg({ addSourceLink: true, columns: [col("Source")] }))).toBe("source_csv");
		expect(sourceLinkProperty(cfg({ addSourceLink: true, columns: [col("source"), col("source_csv", 1)] }))).toBe(
			"source_csv 2",
		);
	});
	it("planNotes keeps the source column and writes the link elsewhere", () => {
		const parsed = parseCsv("source,b\nweb,1", { delimiter: ",", hasHeader: true });
		const n = planNotes(parsed, cfg({ addSourceLink: true }), csv)[0]!;
		expect(n.frontmatter["source"]).toBe("web");
		expect(n.frontmatter["source_csv"]).toBe("[[hours.csv]]");
	});
});

describe("S3 suggestKeyColumn", () => {
	const run = (text: string) => {
		const parsed = parseCsv(text, { delimiter: ",", hasHeader: true });
		return suggestKeyColumn(parsed, buildColumnConfigs(parsed, { decimalSeparator: ".", midnightAsDate: true, listSeparator: "," }));
	};
	it("picks a unique text column", () => {
		expect(run("name,qty\nann,1\nbob,1")).toBe("name");
	});
	it("prefers id-like names and accepts numeric ids", () => {
		expect(run("name,ID\nann,1\nbob,2")).toBe("ID");
		expect(run("name,customer_id\nann,1\nbob,2")).toBe("customer_id");
	});
	it("does not pick number or date columns without an id name", () => {
		expect(run("amount,day\n1,2024-01-01\n2,2024-01-02")).toBeNull();
	});
	it("requires every value non-empty and unique (case-sensitive, trimmed)", () => {
		expect(run("n,x\na,1\n,2\nb,3")).toBeNull();
		expect(run("n\na\n a\nb")).toBeNull();
		expect(run("n\na\nA\nb")).toBe("n");
		expect(run("n\n")).toBeNull();
	});
});

describe("S4 file names", () => {
	it("normalizes to NFC", () => {
		expect(sanitizeFileName("Ma\u0308dchen")).toBe("M\u00e4dchen");
	});
	it("truncates to 240 UTF-8 bytes without splitting surrogate pairs", () => {
		const out = sanitizeFileName("\u{1F600}".repeat(100));
		expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(240);
		expect([...out].every((c) => c === "\u{1F600}")).toBe(true);
		expect([...out].length).toBe(60);
		const de = sanitizeFileName("\u00fc".repeat(200));
		expect(new TextEncoder().encode(de).length).toBe(240);
	});
	it("prefixes Windows reserved names", () => {
		for (const n of ["CON", "nul", "COM1", "lpt9", "con.txt", "Aux.tar.gz"]) expect(sanitizeFileName(n)).toBe("_" + n);
		expect(sanitizeFileName("console")).toBe("console");
		expect(sanitizeFileName("COM10")).toBe("COM10");
	});
	it("dedupes case-insensitively and avoids collisions with literal suffix names", () => {
		const parsed = parseCsv("n\nA\na\nA 2\nA", { delimiter: ",", hasHeader: true });
		const notes = planNotes(parsed, cfg({ fileNameTemplate: "{{n}}" }), csv);
		const lower = notes.map((x) => x.path.toLowerCase());
		expect(new Set(lower).size).toBe(4);
		expect(notes[0]!.path).toBe("hours/A.md");
		expect(notes[1]!.path).toBe("hours/a 2.md");
		expect(notes[2]!.path).toBe("hours/A 2 2.md");
	});
	it("handles 10k duplicates with correct unique suffixes (and not quadratically slowly)", () => {
		const parsed = parseCsv("n\n" + "x\n".repeat(10000), { delimiter: ",", hasHeader: true });
		const t = Date.now();
		const notes = planNotes(parsed, cfg({ fileNameTemplate: "{{n}}" }), csv);
		// Generous bound: only guards against pathological (quadratic) behaviour, not machine speed.
		expect(Date.now() - t).toBeLessThan(10_000);
		const expected = ["hours/x.md", ...Array.from({ length: 9999 }, (_, i) => `hours/x ${i + 2}.md`)];
		expect(notes.map((x) => x.path)).toEqual(expected);
	});
});

describe("S8 target folder", () => {
	it("rejects .. segments and drive paths", () => {
		for (const f of ["../x", "a/../b", "a\\..\\b", "C:\\", "c:/Users"]) {
			expect(() => resolveTargetFolder(cfg({ targetFolder: f }), "a.csv")).toThrow(
				"The target folder must be inside the vault",
			);
		}
		const parsed = parseCsv("a\n1", { delimiter: ",", hasHeader: true });
		expect(() => planNotes(parsed, cfg({ targetFolder: "../{{a}}" }), csv)).toThrow("inside the vault");
		expect(() =>
			resolveRowFolder(cfg({ targetFolder: "x/.." }), "a.csv", { headers: [], row: [], rowNumber: 1, fileBasename: "a" }),
		).toThrow("inside the vault");
	});
	it("placeholder values with .. stay safe", () => {
		const parsed = parseCsv("a\n..", { delimiter: ",", hasHeader: true });
		const n = planNotes(parsed, cfg({ targetFolder: "x/{{a}}" }), csv)[0]!;
		expect(n.path.startsWith("x/")).toBe(true);
		expect(n.path).not.toContain("..");
	});
});
