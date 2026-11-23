import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv/parser";
import { prepareConfig } from "../src/csv/typeInference";
import { planNotes, serializeNote } from "../src/import/noteBuilder";
import { createDefaultFileConfig, DEFAULT_SETTINGS } from "../src/defaults";
import type { ColumnConfig, FileImportConfig } from "../src/types";

interface Opts {
	over?: Partial<FileImportConfig>;
	/** Column overrides by source header. */
	cols?: Record<string, Partial<ColumnConfig>>;
}

function run(text: string, opts: Opts = {}): { md: string[]; config: FileImportConfig } {
	const config = { ...createDefaultFileConfig(DEFAULT_SETTINGS), addSourceLink: false, ...opts.over };
	const parsed = parseCsv(text, { delimiter: "auto", hasHeader: true });
	prepareConfig(config, parsed, true);
	for (const c of config.columns) Object.assign(c, opts.cols?.[c.source] ?? {});
	const notes = planNotes(parsed, config, { path: "t.csv", basename: "t" });
	return { md: notes.map((n) => serializeNote(n.frontmatter, n.body, n.types)), config };
}
const paths = (text: string, over: Partial<FileImportConfig>) => {
	const config = { ...createDefaultFileConfig(DEFAULT_SETTINGS), ...over };
	const parsed = parseCsv(text, { delimiter: "auto", hasHeader: true });
	prepareConfig(config, parsed, true);
	return planNotes(parsed, config, { path: "t.csv", basename: "t" }).map((n) => n.path);
};
const lines = (md: string) => md.split("\n");

describe("acceptance: numbers", () => {
	it("0.5, 0,5 and quoted 0.5 all give pt: 0.5", () => {
		const { md } = run('title,pt\na,0.5\nb,"0.5"\nc,0.50');
		for (const m of md) expect(lines(m)).toContain("pt: 0.5");
	});
	it("decimal comma in ; file (auto-detected)", () => {
		const { md, config } = run("title;pt\na;0,5\nb;1,25");
		expect(config.decimalSeparator).toBe(",");
		expect(lines(md[0])).toContain("pt: 0.5");
		expect(lines(md[1])).toContain("pt: 1.25");
	});
	it("explicit decimal comma", () => {
		const { md } = run("title;pt\na;0,5", { over: { decimalSeparator: "," } });
		expect(lines(md[0])).toContain("pt: 0.5");
	});
	it("mixed 4, \"4\", 4.0 -> hours: 4", () => {
		const { md } = run('t,hours\na,4\nb,"4"\nc,4.0');
		for (const m of md) expect(lines(m)).toContain("hours: 4");
	});
	it("no float noise; precision", () => {
		expect(lines(run("t,v\na,8.8333").md[0])).toContain("v: 8.8333");
		expect(lines(run("t,v\na,8.8333", { over: { numberPrecision: 2 } }).md[0])).toContain("v: 8.83");
		expect(lines(run("t,v\na,0.50", { over: { numberPrecision: 2 } }).md[0])).toContain("v: 0.5");
		const m = run("t,v\na,8.833333333333334", { over: { numberPrecision: 2 }, cols: { v: { type: "number" } } }).md[0];
		expect(lines(m)).toContain("v: 8.83");
		expect(m).not.toContain("8.833333333333334");
	});
	it("thousands separators", () => {
		expect(lines(run("t,v\na,\"1,234.5\"").md[0])).toContain("v: 1234.5");
	});
});

describe("acceptance: dates", () => {
	it("midnight datetime -> date", () => {
		expect(lines(run("t,date\na,2026-10-20 00:00:00").md[0])).toContain("date: 2026-10-20");
	});
	it("real time -> T separated", () => {
		const { md } = run("t,date\na,2026-10-20 14:30:00\nb,2026-10-21 00:00:00");
		expect(lines(md[0])).toContain("date: 2026-10-20T14:30:00");
		expect(lines(md[1])).toContain("date: 2026-10-21T00:00:00");
	});
	it("DD.MM.YYYY", () => {
		expect(lines(run("t,date\na,20.10.2026").md[0])).toContain("date: 2026-10-20");
	});
	it("Excel serial typed date; never inferred", () => {
		const r = run("t,date\na,46315", { cols: { date: { type: "date" } } });
		expect(lines(r.md[0])).toContain("date: 2026-10-20");
		const inferred = run("t,date\na,46315");
		expect(lines(inferred.md[0])).toContain("date: 46315");
	});
	it("Excel serial with time", () => {
		const r = run("t,date\na,46315.5", { cols: { date: { type: "datetime" } } });
		expect(lines(r.md[0])).toContain("date: 2026-10-20T12:00:00");
	});
});

describe("acceptance: text", () => {
	it("007 stays quoted text", () => {
		expect(lines(run("id,t\n007,a\nA1,b").md[0])).toContain('id: "007"');
	});
	it("text date quoted, comma text plain", () => {
		const { md } = run("note,x\n2026-10-20,1\n\"Smith, J.\",2", { cols: { note: { type: "text" } } });
		expect(lines(md[0])).toContain('note: "2026-10-20"');
		expect(lines(md[1])).toContain("note: Smith, J.");
	});
	it("quotes yaml-hostile strings", () => {
		const out = serializeNote({ a: "yes", b: "1e5", c: "a: b", d: ".5", e: "0x1F", f: "x #y", g: "1_000" }, "");
		for (const k of ["a: \"yes\"", 'b: "1e5"', 'c: "a: b"', 'd: ".5"', 'e: "0x1F"', 'f: "x #y"', 'g: "1_000"'])
			expect(out).toContain(k);
	});
});

describe("acceptance: BOM / line endings", () => {
	it("BOM stripped", () => {
		for (const head of ["﻿date,x", '﻿"date",x']) {
			const { md } = run(`${head}\n2026-10-20,1\r\n2026-10-21,2\r\n`);
			expect(md[0].startsWith("---\ndate:")).toBe(true);
			for (const m of md) {
				expect(m).not.toContain("﻿");
				expect(m).not.toContain("\r");
			}
		}
	});
	it("body CRLF normalized", () => {
		expect(serializeNote({ a: 1 }, "x\r\ny\rz")).toBe("---\na: 1\n---\nx\ny\nz\n");
		expect(serializeNote({ a: "x\r\ny" }, "")).not.toContain("\r");
	});
});

describe("acceptance: empty cells", () => {
	const csv = "t,pt\na,1\nb,\nc,  ";
	it("empty mode", () => {
		const { md } = run(csv, { over: { emptyValues: "empty" } });
		expect(lines(md[1])).toContain("pt:");
		expect(lines(md[2])).toContain("pt:");
		for (const m of md) expect(m).not.toContain('""');
	});
	it("omit mode", () => {
		const { md } = run(csv, { over: { emptyValues: "omit" } });
		expect(md[1]).not.toMatch(/^pt:/m);
		expect(md[2]).not.toMatch(/^pt:/m);
		expect(lines(md[0])).toContain("pt: 1");
	});
	it("empty text cell never written as \"\"", () => {
		const { md } = run("t,n\na,x\n,y", { over: { emptyValues: "empty" } });
		expect(md[1]).not.toContain('""');
		expect(lines(md[1])).toContain("t:");
	});
});

describe("acceptance: file names", () => {
	it("date in file name", () => {
		const p = paths("date,title\n2026-10-20 00:00:00,Foo", { fileNameTemplate: "{{date}} - {{title}}" });
		expect(p[0]).toBe("t/2026-10-20 - Foo.md");
		expect(p[0]).not.toContain("000000");
	});
	it("datetime in file name", () => {
		const p = paths("date,title\n2026-10-20 14:30:00,Foo", { fileNameTemplate: "{{date}} - {{title}}" });
		expect(p[0]).toBe("t/2026-10-20 14-30 - Foo.md");
	});
});

describe("acceptance: key and types", () => {
	it("fills key and types", () => {
		const config = { ...createDefaultFileConfig(DEFAULT_SETTINGS), keyColumn: "id", tags: "x" };
		const parsed = parseCsv("id,v\n007,1.50\n,2", { delimiter: "auto", hasHeader: true });
		prepareConfig(config, parsed, true);
		const notes = planNotes(parsed, config, { path: "t.csv", basename: "t" });
		expect(notes[0].key).toEqual({ property: "id", value: "007" });
		expect(notes[1].key).toBeNull();
		expect(notes[0].types).toMatchObject({ id: "text", v: "number", tags: "list", source: "text" });
	});
});

describe("acceptance: value templates", () => {
	it("text wikilink", () => {
		const { md } = run("Rolle,x\nSoftwareentwickler,1", { cols: { Rolle: { valueTemplate: "[[{{value}}]]" } } });
		expect(lines(md[0])).toContain('Rolle: "[[Softwareentwickler]]"');
	});
	it("list per item", () => {
		const { md } = run('tags2,x\n"a,b",1', { cols: { tags2: { type: "list", valueTemplate: "[[$value]]" } } });
		expect(md[0]).toContain('tags2:\n  - "[[a]]"\n  - "[[b]]"');
	});
	it("number template", () => {
		const { md } = run("t,pt\na,0.5", { cols: { pt: { valueTemplate: "{{value}} h" } } });
		expect(lines(md[0])).toContain("pt: 0.5 h");
	});
	it("empty cell stays empty", () => {
		const { md } = run("t,pt\na,", { cols: { pt: { valueTemplate: "[[{{value}}]]" } } });
		expect(lines(md[0])).toContain("pt:");
	});
	it("references another column", () => {
		const { md } = run("who,proj\nAnn,X", { cols: { who: { valueTemplate: "[[{{proj}}/{{value}}]]" } } });
		expect(lines(md[0])).toContain('who: "[[X/Ann]]"');
	});
});
