import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv/parser";
import { applyValueTemplate, planNotes, renderTemplate, staticPrefix, type TemplateContext } from "../src/import/noteBuilder";
import { compileTemplate, headerIndexOf, renderCompiled } from "../src/import/templates";
import { buildColumnConfigs, inferenceOptionsOf } from "../src/csv/typeInference";
import { cfg } from "./helpers/harness";

/** Independent reference: the original regex-per-render implementation of renderTemplate. */
function reference(template: string, ctx: TemplateContext): string {
	return template.replace(/\{\{([^{}]*)\}\}/g, (_m, key: string) => {
		const k = key.trim();
		if (k === "row") return String(ctx.rowNumber);
		if (k === "file") return ctx.fileBasename;
		const idx = ctx.headers.indexOf(k);
		if (idx < 0) return "";
		return (ctx.formatted?.[idx] ?? ctx.row[idx] ?? "").trim();
	});
}

const TEMPLATES = [
	"",
	"plain text",
	"{{Name}}",
	"{{ Name }}",
	"{{\tName\t}}",
	"{{Name}}{{Age}}",
	"{{Name}} ({{ Age }}) #{{row}} from {{file}}",
	"{{name}}",
	"{{NAME}}",
	"{{Nope}}",
	"[{{Nope}}]",
	"{{}}",
	"{{ }}",
	"{{{Name}}}",
	"{{Name}}}",
	"{{{{Name}}",
	"{ {Name} }",
	"{{Na me}}",
	"{{row}} {{ row }} {{file}} {{ file }}",
	"{{Full Name}} / {{Name}}",
	"{{Dup}}",
	"{{Ünï}} {{emoji 🎉}}",
	"$value {{value}} stay literal",
	"a$b $1 $& {{Name}} $$",
	"line1\n{{Name}}\nline3",
	"{{Name}",
	"{Name}}",
	"{{Name}}{{",
	"{{file}}{{row}}{{Age}}",
];

const CONTEXTS: TemplateContext[] = [
	{ headers: ["Name", "Age"], row: ["Ann", " 5 "], rowNumber: 3, fileBasename: "people" },
	{ headers: ["Name", "Age"], row: ["Ann"], rowNumber: 1, fileBasename: "" },
	{ headers: [], row: [], rowNumber: 10, fileBasename: "x" },
	{ headers: ["Full Name", "Name", "Ünï", "emoji 🎉", "Dup", "Dup"], row: ["A B", " n ", "ü", "e", "first", "second"], rowNumber: 2, fileBasename: "f $& $1" },
	{ headers: ["row", "file", "Name"], row: ["header-row", "header-file", "N"], rowNumber: 7, fileBasename: "real" },
	{
		headers: ["Name", "Age"],
		row: ["raw name", "raw age"],
		formatted: ["Fmt Name", "42"],
		rowNumber: 4,
		fileBasename: "p",
	},
	{ headers: ["Name", "Age"], row: ["{{Age}}", "$value"], rowNumber: 5, fileBasename: "{{row}}" },
];

describe("renderTemplate vs reference and compiled path", () => {
	for (const t of TEMPLATES) {
		it(`matches for ${JSON.stringify(t)}`, () => {
			for (const ctx of CONTEXTS) {
				const expected = reference(t, ctx);
				expect(renderTemplate(t, ctx)).toBe(expected);
				expect(renderCompiled(compileTemplate(t, headerIndexOf(ctx.headers)), ctx)).toBe(expected);
			}
		});
	}

	it("whitespace in braces is trimmed, values are trimmed, unknown is empty, names are case-sensitive", () => {
		const ctx = CONTEXTS[0];
		expect(renderTemplate("{{  Name  }}|{{Age}}|{{name}}|{{Zip}}", ctx)).toBe("Ann|5||");
	});

	it("row and file win over headers with the same name", () => {
		const ctx = CONTEXTS[4];
		expect(renderTemplate("{{row}}/{{file}}/{{Name}}", ctx)).toBe("7/real/N");
	});

	it("duplicate headers resolve to the leftmost column", () => {
		expect(renderTemplate("{{Dup}}", CONTEXTS[3])).toBe("first");
	});

	it("special characters in values and file names are inserted literally (no replace patterns)", () => {
		expect(renderTemplate("{{file}}", CONTEXTS[3])).toBe("f $& $1");
		expect(renderTemplate("a$b $1 $& {{Name}} $$", CONTEXTS[3])).toBe("a$b $1 $& n $$");
	});

	it("placeholders inside values are not expanded again", () => {
		expect(renderTemplate("{{Name}}-{{file}}", CONTEXTS[6])).toBe("{{Age}}-{{row}}");
	});

	it("uses formatted display values when present", () => {
		expect(renderTemplate("{{Name}} {{Age}}", CONTEXTS[5])).toBe("Fmt Name 42");
	});

	it("body templates in planNotes render exactly like renderTemplate", () => {
		const csv = "Name,Full Name,row\nAnn, A B ,r1\nBo,C D,r2\n";
		const parsed = parseCsv(csv, { delimiter: ",", hasHeader: true });
		for (const t of TEMPLATES) {
			const notes = planNotes(parsed, cfg({ bodyTemplate: t }), { path: "d/people.csv", basename: "people" });
			notes.forEach((n, i) => {
				const ctx: TemplateContext = {
					headers: parsed.headers,
					row: parsed.rows[i],
					rowNumber: parsed.rowNumbers[i],
					fileBasename: "people",
				};
				expect(n.body).toBe(reference(t, ctx));
			});
		}
	});
});

describe("applyValueTemplate", () => {
	const ctx: TemplateContext = { headers: ["Name", "Team"], row: ["Ann", " Core "], rowNumber: 9, fileBasename: "staff" };

	it("null stays null and an empty template is a no-op", () => {
		expect(applyValueTemplate("[[{{value}}]]", null, ctx)).toBeNull();
		expect(applyValueTemplate("", "x", ctx)).toBe("x");
		expect(applyValueTemplate("", 5, ctx)).toBe(5);
		expect(applyValueTemplate("", ["a"], ctx)).toEqual(["a"]);
	});

	it("{{value}}, {{ value }} and $value are all the formatted value", () => {
		expect(applyValueTemplate("[[{{value}}]]", "Ann", ctx)).toBe("[[Ann]]");
		expect(applyValueTemplate("<{{ value }}>", "Ann", ctx)).toBe("<Ann>");
		expect(applyValueTemplate("$value and $value", "Ann", ctx)).toBe("Ann and Ann");
		expect(applyValueTemplate("{{value}}-$value", "x", ctx)).toBe("x-x");
	});

	it("numbers and booleans become text, using normalized number formatting", () => {
		expect(applyValueTemplate("{{value}} h", 4, ctx)).toBe("4 h");
		expect(applyValueTemplate("{{value}}", 2.5, ctx)).toBe("2.5");
		expect(applyValueTemplate("is {{value}}", true, ctx)).toBe("is true");
		expect(applyValueTemplate("is {{value}}", false, ctx)).toBe("is false");
	});

	it("lists are templated per item", () => {
		expect(applyValueTemplate("[[{{value}}]]", ["a", "b"], ctx)).toEqual(["[[a]]", "[[b]]"]);
		expect(applyValueTemplate("$value@{{Team}}", ["a", "b"], ctx)).toEqual(["a@Core", "b@Core"]);
		expect(applyValueTemplate("[[{{value}}]]", [], ctx)).toEqual([]);
	});

	it("other column refs, row and file resolve against the row context", () => {
		expect(applyValueTemplate("{{Team}}/{{value}}/{{row}}/{{file}}", "Ann", ctx)).toBe("Core/Ann/9/staff");
		expect(applyValueTemplate("{{Missing}}|{{value}}", "x", ctx)).toBe("|x");
		expect(applyValueTemplate("{{ Team }}", "x", ctx)).toBe("Core");
	});

	it("{{value}} inside a value is not expanded again", () => {
		expect(applyValueTemplate("[{{value}}]", "{{Team}} $value", ctx)).toBe("[{{Team}} $value]");
	});

	it("a column named value is shadowed by the value slot", () => {
		const c: TemplateContext = { headers: ["value"], row: ["col"], rowNumber: 1, fileBasename: "f" };
		expect(applyValueTemplate("{{value}}", "v", c)).toBe("v");
	});

	it("applies per column in planNotes, leaving empty cells empty", () => {
		const parsed = parseCsv("Name,Team,Tags\nAnn,Core,\"a,b\"\n,Ops,\n", { delimiter: ",", hasHeader: true });
		const base = buildColumnConfigs(parsed, inferenceOptionsOf(cfg(), true));
		const columns = base.map((c) => {
			if (c.source === "Name") return { ...c, valueTemplate: "[[{{value}}]] ({{Team}}, #{{row}})" };
			if (c.source === "Tags") return { ...c, type: "list" as const, valueTemplate: "t/$value" };
			return c;
		});
		const notes = planNotes(parsed, cfg({ fileNameTemplate: "N {{row}}", columns }), { path: "d/s.csv", basename: "s" });
		expect(notes[0].frontmatter.Name).toBe("[[Ann]] (Core, #1)");
		expect(notes[0].frontmatter.Tags).toEqual(["t/a", "t/b"]);
		expect(notes[1].frontmatter.Name).toBeNull();
		expect(JSON.stringify(notes[1].frontmatter.Tags ?? null)).not.toContain("t/");
	});
});

describe("staticPrefix", () => {
	it.each([
		["", ""],
		["Data", "Data"],
		["Data/Sub", "Data/Sub"],
		["Data/{{Team}}", "Data"],
		["Data/Sub/{{Team}}/x", "Data/Sub"],
		["{{Team}}", ""],
		["{{Team}}/x", ""],
		["Data/pre{{Team}}", "Data"],
		["Data/{{Team}}/{{Year}}", "Data"],
		["Data/", "Data/"],
	])("%j -> %j", (input, expected) => {
		expect(staticPrefix(input)).toBe(expected);
	});
});
