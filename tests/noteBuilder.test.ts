import { describe, expect, it } from "vitest";
import {
	planNotes,
	renderTemplate,
	resolveTargetFolder,
	sanitizeFileName,
	serializeNote,
} from "../src/import/noteBuilder";
import { parseCsv } from "../src/csv/parser";
import { buildColumnConfigs } from "../src/csv/typeInference";
import type { FileImportConfig } from "../src/types";

function cfg(over: Partial<FileImportConfig> = {}): FileImportConfig {
	return {
		delimiter: "auto",
		hasHeader: true,
		decimalSeparator: ".",
		targetFolder: "",
		fileNameTemplate: "{{file}} {{row}}",
		bodyTemplate: "",
		conflict: "skip",
		tags: "",
		addSourceLink: false,
		listSeparator: ",",
		emptyValues: "empty",
		numberPrecision: null,
		keyColumn: "",
		columns: [],
		lastImport: null,
		...over,
	};
}

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
		expect(sanitizeFileName("x".repeat(300)).length).toBe(200);
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
			types: { Name: "text", Qty: "number", Done: "checkbox" },
			key: null,
		});
		expect(notes[1].frontmatter).toEqual({ Name: "B", Qty: null, Done: false });
	});

	it("respects include=false and uses configured columns", () => {
		const parsed = parseCsv("a,b\n1,2", { delimiter: ",", hasHeader: true });
		const columns = buildColumnConfigs(parsed, { decimalSeparator: ".", midnightAsDate: false, listSeparator: "," });
		columns[0].include = false;
		columns[1].type = "text";
		columns[1].property = "B";
		const [n] = planNotes(parsed, cfg({ columns }), csv);
		expect(n.frontmatter).toEqual({ B: "2" });
	});

	it("adds tags and source link", () => {
		const parsed = parseCsv("a\n1", { delimiter: ",", hasHeader: true });
		const [n] = planNotes(parsed, cfg({ tags: " #foo, bar baz ,, foo ", addSourceLink: true }), csv);
		expect(n.frontmatter.tags).toEqual(["foo", "bar-baz"]);
		expect(n.frontmatter.source).toBe("[[Data/hours.csv]]");
	});

	it("merges config tags with a tags column", () => {
		const parsed = parseCsv("tags\n\"x, #y\"", { delimiter: ",", hasHeader: true });
		const columns = buildColumnConfigs(parsed, { decimalSeparator: ".", midnightAsDate: false, listSeparator: "," });
		columns[0].type = "list";
		const [n] = planNotes(parsed, cfg({ columns, tags: "imported" }), csv);
		expect(n.frontmatter.tags).toEqual(["x", "y", "imported"]);
	});

	it("falls back to <file> <row> for empty names and dedupes paths", () => {
		const parsed = parseCsv("Name\n\n,\nA\nA\na", { delimiter: ",", hasHeader: true });
		// blank line skipped -> rows: "", A, A, a
		const notes = planNotes(parsed, cfg({ fileNameTemplate: "{{Name}}" }), { path: "x.csv", basename: "x" });
		expect(notes.map((n) => n.path)).toEqual(["x/x 1.md", "x/A.md", "x/A 2.md", "x/a 3.md"]);
	});

	it("uses no leading slash for the vault root", () => {
		const parsed = parseCsv("a\n1", { delimiter: ",", hasHeader: true });
		const [n] = planNotes(parsed, cfg({ targetFolder: "/" }), csv);
		expect(n.path).toBe("hours 1.md");
	});

	it("uses a custom target folder", () => {
		const parsed = parseCsv("a\n1", { delimiter: ",", hasHeader: true });
		const [n] = planNotes(parsed, cfg({ targetFolder: "Out/Put/" }), csv);
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
		const [note] = planNotes(parsed, cfg({ columns, decimalSeparator: dec, fileNameTemplate: "{{Beschreibung}}" }), {
			path: "hours.csv",
			basename: "hours",
		});
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
		const [note] = planNotes(parsed, cfg({ columns, decimalSeparator: "," }), { path: "h.csv", basename: "h" });
		expect(serializeNote(note.frontmatter, "", note.types)).toContain("Datum: 2026-11-18T00:00:00\n");
	});
});
