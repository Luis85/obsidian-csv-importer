// Note planning details (complements noteBuilder.test.ts): display values in templates, list properties,
// keys, extra properties, row filters and per-column date handling.
import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/csv/parser";
import { buildColumnConfigs } from "../../src/csv/typeInference";
import {
	compositeKeyProperty,
	effectiveKeyColumns,
	extraPropertyConflicts,
	ownedLinkProperties,
	planNotes,
	rowMatches,
} from "../../src/import/noteBuilder";
import type { ColumnConfig, FileImportConfig, RowFilter } from "../../src/types";
import { cfg } from "./helpers/harness";

const csvFile = { path: "Data/f.csv", basename: "f" };
const inf = { decimalSeparator: "." as const, midnightAsDate: true, listSeparator: "," };

/** Plans notes for `text`; `cols` patches the inferred column configs by source header. */
function plan(text: string, over: Partial<FileImportConfig> = {}, cols: Record<string, Partial<ColumnConfig>> = {}, csv = csvFile) {
	const c = cfg({ targetFolder: "/", ...over });
	const parsed = parseCsv(text, c);
	if (Object.keys(cols).length > 0 || over.columns === undefined) {
		c.columns = buildColumnConfigs(parsed, inf).map((col) => ({ ...col, ...(cols[col.source] ?? {}) }));
	}
	return planNotes(parsed, c, csv, { now: new Date(2026, 0, 2, 3, 4, 5), uuid: () => "U" });
}

const column = (source: string, index: number, over: Partial<ColumnConfig> = {}): ColumnConfig => ({
	source,
	index,
	property: source,
	type: "text",
	include: true,
	...over,
});

describe("display values in templates", () => {
	it("file names show datetimes as YYYY-MM-DD HH-mm, with seconds only when set", () => {
		const notes = plan("When\n2026-01-02 10:30\n2026-01-02 10:30:15", { fileNameTemplate: "{{When}}" });
		expect(notes.map((n) => n.path)).toEqual(["2026-01-02 10-30.md", "2026-01-02 10-30-15.md"]);
	});

	it("a datetime cell that cannot be parsed is used as it is", () => {
		const notes = plan("When\nsoon", { fileNameTemplate: "{{When}}" }, { When: { type: "datetime" } });
		expect(notes[0]?.path).toBe("soon.md");
	});

	it("bodies show datetimes in ISO form", () => {
		const [n] = plan("When\n2026-01-02 10:30", { bodyTemplate: "at {{When}}" });
		expect(n?.body).toBe("at 2026-01-02T10:30:00");
	});

	it("only datetime columns are reformatted for file names", () => {
		const notes = plan("Code\n2026-01-02T10:30:00", { fileNameTemplate: "{{Code}}" }, { Code: { type: "text" } });
		expect(notes[0]?.path).toBe("2026-01-02T103000.md");
	});

	it("columns without a config still fill templates with their trimmed cell", () => {
		const c = cfg({ targetFolder: "/", fileNameTemplate: "{{b}}", bodyTemplate: "[{{b}}]", columns: [column("a", 0)] });
		const notes = planNotes(parseCsv("a,b\n1, x \n", c), c, csvFile);
		expect(notes[0]).toMatchObject({ path: "x.md", body: "[x]", frontmatter: { a: "1" } });
	});
});

describe("tags, aliases and cssclasses", () => {
	it("tags from config lose all leading # characters", () => {
		expect(plan("a\n1", { tags: "##deep, #one" })[0]?.frontmatter.tags).toEqual(["deep", "one"]);
	});

	it("tags turn inner whitespace into one dash and keep inner # characters", () => {
		expect(plan("a\n1", { tags: "a  b, c#d, # spaced" })[0]?.frontmatter.tags).toEqual(["a-b", "c#d", "spaced"]);
	});

	it("aliases split on commas only, tags also on spaces", () => {
		const [n] = plan('aliases,tags\n"Al Smith, Big Al","x y"');
		expect(n?.frontmatter.aliases).toEqual(["Al Smith", "Big Al"]);
		expect(n?.frontmatter.tags).toEqual(["x", "y"]);
		expect(n?.types).toMatchObject({ aliases: "list", tags: "list" });
	});

	it("list-typed aliases are trimmed and deduplicated", () => {
		const [n] = plan('aliases\n" a , b ,a"', {}, { aliases: { type: "list" } });
		expect(n?.frontmatter.aliases).toEqual(["a", "b"]);
	});

	it("a numeric tags column becomes a one-item list", () => {
		expect(plan("tags\n5")[0]?.frontmatter.tags).toEqual(["5"]);
	});

	it("a tags cell with no usable tag is omitted or kept empty like an empty cell", () => {
		const omitted = plan("tags,a\n#,1", { emptyValues: "omit" })[0];
		expect(omitted?.frontmatter).not.toHaveProperty("tags");
		const kept = plan("tags,a\n#,1", { emptyValues: "empty" })[0];
		expect(kept?.frontmatter.tags).toBeNull();
		expect(kept?.types.tags).toBe("list");
	});

	it("an empty tags column is omitted entirely or kept as an empty list property", () => {
		const omitted = plan("tags,a\n,1", { emptyValues: "omit" })[0];
		expect(omitted?.frontmatter).not.toHaveProperty("tags");
		expect(omitted?.types).not.toHaveProperty("tags");
		const kept = plan("tags,a\n,1", { emptyValues: "empty" })[0];
		expect(kept?.frontmatter.tags).toBeNull();
		expect(kept?.types.tags).toBe("list");
	});
});

describe("value templates", () => {
	it("turn a number into text, keep lists as lists", () => {
		const [n] = plan('n,l\n5,"a,b"', {}, { n: { valueTemplate: "#{{value}}" }, l: { type: "list", valueTemplate: "[[{{value}}]]" } });
		expect(n?.frontmatter).toMatchObject({ n: "#5", l: ["[[a]]", "[[b]]"] });
		expect(n?.types).toMatchObject({ n: "text", l: "list" });
	});
});

describe("keys", () => {
	it("effectiveKeyColumns prefers non-empty keyColumns, else keyColumn", () => {
		expect(effectiveKeyColumns(cfg({ keyColumns: ["", "a", "b"] }))).toEqual(["a", "b"]);
		expect(effectiveKeyColumns(cfg({ keyColumns: ["", ""], keyColumn: "k" }))).toEqual(["k"]);
		expect(effectiveKeyColumns({ ...cfg({ keyColumn: "k" }), keyColumns: undefined as unknown as string[] })).toEqual(["k"]);
		expect(effectiveKeyColumns(cfg())).toEqual([]);
	});

	it("compositeKeyProperty needs two key columns and avoids column names", () => {
		const cols = [column("import_key", 0), column("import_key 2", 1)];
		expect(compositeKeyProperty(cfg({ keyColumn: "a" }), cols)).toBeNull();
		expect(compositeKeyProperty(cfg({ keyColumns: ["a", "b"] }), [])).toBe("import_key");
		expect(compositeKeyProperty(cfg({ keyColumns: ["a", "b"] }), cols)).toBe("import_key 3");
		expect(compositeKeyProperty(cfg({ keyColumns: ["a", "b"], keyProperty: " ref " }), [])).toBe("ref");
		expect(compositeKeyProperty(cfg({ keyColumns: ["a", "b"], keyProperty: "  " }), [])).toBe("import_key");
		expect(compositeKeyProperty({ ...cfg({ keyColumns: ["a", "b"] }), keyProperty: undefined as unknown as string }, [])).toBe("import_key");
	});

	it("a row with an empty key cell has no key", () => {
		const notes = plan("id,v\n1,a\n,b", { keyColumn: "id" });
		expect(notes.map((n) => n.key)).toEqual([{ property: "id", value: "1" }, null]);
	});

	it("an omitted empty key cell or a list key gives no key", () => {
		expect(plan("id,v\n,b", { keyColumn: "id", emptyValues: "omit" })[0]?.key).toBeNull();
		expect(plan('id,v\n"a,b",x', { keyColumn: "id" }, { id: { type: "list" } })[0]?.key).toBeNull();
	});

	it("an excluded column of a composite key is not written", () => {
		const [n] = plan("a,b,c\n1,2,3", { keyColumns: ["a", "b"] }, { a: { include: false } });
		expect(n?.frontmatter).not.toHaveProperty("a");
		expect(n?.key).toEqual({ property: "import_key", value: "1 | 2" });
	});
});

describe("ownedLinkProperties", () => {
	it("is the legacy 'source' plus the current link property when it differs", () => {
		expect(ownedLinkProperties(cfg({ addSourceLink: false }))).toEqual(["source"]);
		expect(ownedLinkProperties(cfg({ addSourceLink: true }))).toEqual(["source"]);
		expect(ownedLinkProperties(cfg({ addSourceLink: true, columns: [column("Source", 0, { property: "Source" })] }))).toEqual(["source_csv", "source"]);
	});
});

describe("extra properties", () => {
	const extra = (property: string, defaultValue = "x") => ({ property, type: "text" as const, defaultValue });

	it("conflict with columns, the composite key, the source link and configured tags (case-insensitive)", () => {
		const config = cfg({
			columns: [column("Status", 0, { property: "status" })],
			keyColumns: ["a", "b"],
			addSourceLink: true,
			tags: "t",
			extraProperties: [extra(" Status "), extra("IMPORT_KEY"), extra("SOURCE"), extra("Tags"), extra("  "), extra("free"), extra("FREE")],
		});
		expect(extraPropertyConflicts(config)).toEqual([" Status ", "IMPORT_KEY", "SOURCE", "Tags", "FREE"]);
	});

	it("blank extra property names are ignored", () => {
		expect(extraPropertyConflicts(cfg({ extraProperties: [extra("  "), extra("")] }))).toEqual([]);
	});

	it("tags are free when no tags are configured", () => {
		expect(extraPropertyConflicts(cfg({ tags: " , ", extraProperties: [extra("tags")] }))).toEqual([]);
	});

	it("are written under their trimmed name, also with emptyValues omit", () => {
		const [n] = plan("a\n1", { emptyValues: "omit", extraProperties: [extra(" status ", "open")] });
		expect(n?.frontmatter.status).toBe("open");
		expect(n?.fillOnly).toEqual(["status"]);
	});

	it("an extra property without a default value is empty", () => {
		const [n] = plan("a\n1", { extraProperties: [{ property: "p", type: "text" } as never] });
		expect(n?.frontmatter.p).toBeNull();
	});

	it("placeholders may have spaces inside the braces", () => {
		const [n] = plan("a\n1", {
			extraProperties: [extra("d", "{{ today }}|{{today }}|{{ today}}"), extra("t", "{{ now }}|{{now }}"), extra("u", "{{ uuid }}|{{uuid }}")],
		});
		expect(n?.frontmatter).toMatchObject({
			d: "2026-01-02|2026-01-02|2026-01-02",
			t: "2026-01-02T03:04:05|2026-01-02T03:04:05",
			u: "U|U",
		});
	});
});

describe("dates in planned notes", () => {
	it("columns are inferred with midnight times as dates", () => {
		const c = cfg({ targetFolder: "/" });
		const [n] = planNotes(parseCsv("d\n2026-01-02 00:00\n", c), c, csvFile);
		expect(n?.types.d).toBe("date");
		expect(n?.frontmatter.d).toBe("2026-01-02");
	});

	it("ambiguous slash dates follow the order the whole column shows", () => {
		const notes = plan("d,t\n13/04/2026,13/04/2026 10:00\n03/04/2026,03/04/2026 10:00", {}, { d: { type: "date" }, t: { type: "datetime" } });
		expect(notes.map((n) => [n.frontmatter.d, n.frontmatter.t])).toEqual([
			["2026-04-13", "2026-04-13T10:00:00"],
			["2026-04-03", "2026-04-03T10:00:00"],
		]);
	});

	it("an explicit date order wins over what the column shows", () => {
		const notes = plan("d\n03/04/2026\n13/04/2026", { dateOrder: "mdy" }, { d: { type: "date" } });
		expect(notes.map((n) => n.frontmatter.d)).toEqual(["2026-03-04", "13/04/2026"]);
	});
});

describe("file name allocation", () => {
	it("skips suffixed names that are already taken", () => {
		const notes = plan("n\nA 2\nA\nA\na", { fileNameTemplate: "{{n}}" });
		expect(notes.map((n) => n.path)).toEqual(["A 2.md", "A.md", "A 3.md", "a 4.md"]);
	});
});

describe("rowMatches", () => {
	const h = ["Name", "N"];
	const f = (op: RowFilter["op"], value: string, col = "Name"): RowFilter => ({ column: col, op, value });

	it("empty / notEmpty", () => {
		expect(rowMatches(f("empty", ""), h, ["x", "1"], ".")).toBe(false);
		expect(rowMatches(f("notEmpty", ""), h, ["x", "1"], ".")).toBe(true);
		expect(rowMatches(f("empty", ""), h, ["", "1"], ".")).toBe(true);
	});

	it("equals / notEquals", () => {
		expect(rowMatches(f("equals", "bob"), h, ["Ann", "1"], ".")).toBe(false);
		expect(rowMatches(f("notEquals", "bob"), h, ["Ann", "1"], ".")).toBe(true);
		expect(rowMatches(f("notEquals", "ann"), h, ["Ann", "1"], ".")).toBe(false);
	});

	it("contains trims the wanted value; a missing value matches everything", () => {
		expect(rowMatches(f("contains", " ann "), h, ["Joanna", "1"], ".")).toBe(true);
		expect(rowMatches({ column: "Name", op: "contains" } as RowFilter, h, ["x", "1"], ".")).toBe(true);
	});

	it("greaterThan / lessThan compare strings when one side is not a number", () => {
		expect(rowMatches(f("greaterThan", "a"), h, ["b", "1"], ".")).toBe(true);
		expect(rowMatches(f("greaterThan", "5"), h, ["abc", "1"], ".")).toBe(true);
		expect(rowMatches(f("lessThan", "abc", "N"), h, ["x", "10"], ".")).toBe(true);
		expect(rowMatches(f("lessThan", "b"), h, ["c", "1"], ".")).toBe(false);
	});

	it("greaterThan / lessThan are strict and never match empty cells", () => {
		expect(rowMatches(f("greaterThan", "5", "N"), h, ["x", "5"], ".")).toBe(false);
		expect(rowMatches(f("lessThan", "5", "N"), h, ["x", "5"], ".")).toBe(false);
		expect(rowMatches(f("lessThan", "5", "N"), h, ["x", ""], ".")).toBe(false);
	});

	it("an unknown operator matches nothing", () => {
		expect(rowMatches({ column: "Name", op: "bogus" } as unknown as RowFilter, h, ["x", "1"], ".")).toBe(false);
	});
});
