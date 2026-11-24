import { describe, expect, it } from "vitest";
import { parseCsv, detectDelimiter } from "../../src/csv/parser";
import {
	buildColumnConfigs,
	convertValue,
	inferColumnType,
	parseNumber,
	prepareConfig,
	reconcileColumns,
	resolveDateOrder,
} from "../../src/csv/typeInference";
import {
	countMatching,
	effectiveKeyColumns,
	extraPropertyConflicts,
	findDuplicateKeys,
	planNotes,
	rowMatches,
} from "../../src/import/noteBuilder";
import { mergeFrontmatter } from "../../src/import/merge";
import { CURRENT_DATA_VERSION, DEFAULT_SETTINGS, migrateFileConfig } from "../../src/defaults";
import type { RowFilter } from "../../src/types";
import { cfg } from "./helpers/harness";

const inf = { decimalSeparator: "." as const, midnightAsDate: false, listSeparator: "," };
const conv = { decimalSeparator: "." as const, listSeparator: "," };
const csv = { path: "d/f.csv", basename: "f" };

describe("date formats", () => {
	it("month names, English and German", () => {
		const c = (v: string) => convertValue(v, "date", conv);
		expect(c("18 Nov 2026")).toBe("2026-11-18");
		expect(c("Nov 18, 2026")).toBe("2026-11-18");
		expect(c("18. November 2026")).toBe("2026-11-18");
		expect(c("5 Mär 2026")).toBe("2026-03-05");
		expect(c("5 März 2026")).toBe("2026-03-05");
		expect(c("1 Mai 2026")).toBe("2026-05-01");
		expect(c("3. Okt. 2026")).toBe("2026-10-03");
		expect(c("24 Dez 2026")).toBe("2026-12-24");
		expect(c("March 3rd, 2026")).toBe("2026-03-03");
		expect(convertValue("18 Nov 2026 14:30", "datetime", conv)).toBe("2026-11-18T14:30:00");
	});
	it("infers month-name dates", () => {
		expect(inferColumnType(["18 Nov 2026", "1 Dez 2026"], inf)).toBe("date");
		expect(inferColumnType(["31 Feb 2026"], inf)).toBe("text");
		expect(inferColumnType(["18 Foo 2026"], inf)).toBe("text");
	});
	it("DD-MM-YYYY", () => {
		expect(inferColumnType(["18-11-2026", "01-02-2026"], inf)).toBe("date");
		expect(convertValue("18-11-2026", "date", conv)).toBe("2026-11-18");
		expect(inferColumnType(["31-02-2026"], inf)).toBe("text");
	});
	it("slash dates: explicit order", () => {
		expect(convertValue("03/04/2026", "date", { ...conv, dateOrder: "dmy" })).toBe("2026-04-03");
		expect(convertValue("03/04/2026", "date", { ...conv, dateOrder: "mdy" })).toBe("2026-03-04");
		expect(inferColumnType(["03/04/2026"], { ...inf, dateOrder: "dmy" })).toBe("date");
		expect(inferColumnType(["03/04/2026 10:15"], { ...inf, dateOrder: "mdy" })).toBe("datetime");
		expect(convertValue("03/04/2026 10:15", "datetime", { ...conv, dateOrder: "mdy" })).toBe("2026-03-04T10:15:00");
	});
	it("slash dates: auto", () => {
		expect(inferColumnType(["03/04/2026", "25/04/2026"], inf)).toBe("date");
		expect(resolveDateOrder(["03/04/2026", "25/04/2026"])).toBe("dmy");
		expect(resolveDateOrder(["03/04/2026", "04/25/2026"])).toBe("mdy");
		expect(resolveDateOrder(["03/04/2026"])).toBeNull();
		expect(resolveDateOrder(["25/04/2026", "04/25/2026"])).toBeNull();
		// ambiguous: stays text
		expect(inferColumnType(["03/04/2026", "05/06/2026"], inf)).toBe("text");
		// invalid calendar date rejected
		expect(inferColumnType(["31/02/2026", "25/04/2026"], inf)).toBe("text");
	});
	it("existing formats unchanged", () => {
		expect(inferColumnType(["2026-11-18", "18.11.2026", "2026/11/18"], inf)).toBe("date");
		expect(inferColumnType(["2026-11-18 10:00:00"], inf)).toBe("datetime");
	});
	it("auto order resolved per column in planNotes", () => {
		const parsed = parseCsv("d,n\n03/04/2026,a\n25/04/2026,b\n", cfg());
		const config = cfg({ fileNameTemplate: "{{n}}" });
		config.columns = buildColumnConfigs(parsed, inf);
		expect(config.columns[0]!.type).toBe("date");
		const notes = planNotes(parsed, config, csv);
		expect(notes.map((n) => n.frontmatter["d"])).toEqual(["2026-04-03", "2026-04-25"]);
	});
});

describe("units", () => {
	it("parseNumber strips units", () => {
		const p = (s: string, d: "." | "," = ".") => parseNumber(s, d, false, true);
		expect(p("$1,234.56")).toBe(1234.56);
		expect(p("€ 12.5")).toBe(12.5);
		expect(p("12.5€")).toBe(12.5);
		expect(p("12 %")).toBe(12);
		expect(p("12%")).toBe(12);
		expect(p("1.234,56 €", ",")).toBe(1234.56);
		expect(p("CHF 99.90")).toBe(99.9);
		expect(p("100 EUR")).toBe(100);
		expect(p("USD 5")).toBe(5);
		expect(p("-£3.5")).toBe(-3.5);
		expect(p("1 234,56", ",")).toBe(1234.56);
		expect(p("1 234,56", ",")).toBe(1234.56);
		expect(p("1 234 567,5", ",")).toBe(1234567.5);
		expect(p("abc")).toBeNull();
		expect(parseNumber("12 %", ".")).toBeNull();
	});
	it("inference sets stripUnits", () => {
		const parsed = parseCsv("a,b,c\n$1.5,10,x\n$2,20,y\n", cfg());
		const cols = buildColumnConfigs(parsed, inf);
		expect(cols[0]).toMatchObject({ type: "number", stripUnits: true });
		expect(cols[1]!.stripUnits).toBeUndefined();
		expect(cols[2]!.type).toBe("text");
		expect(inferColumnType(["12 %"], inf)).toBe("number");
	});
	it("reconcile keeps the user's stripUnits", () => {
		const parsed = parseCsv("a\n1\n2\n", cfg());
		const out = reconcileColumns([{ source: "a", index: 5, property: "a", type: "number", include: true, stripUnits: true }], parsed, inf);
		expect(out[0]!.stripUnits).toBe(true);
	});
	it("convertValue honors stripUnits", () => {
		expect(convertValue("12 %", "number", { ...conv, stripUnits: true })).toBe(12);
		expect(convertValue("12 %", "number", conv)).toBe("12 %");
	});
	it("planNotes converts stripUnits columns", () => {
		const parsed = parseCsv("n,p\na,12 %\nb,\"$1,234.50\"\n", cfg());
		const config = cfg({ fileNameTemplate: "{{n}}" });
		config.columns = buildColumnConfigs(parsed, inf);
		expect(planNotes(parsed, config, csv).map((x) => x.frontmatter["p"])).toEqual([12, 1234.5]);
	});
});

describe("locale regression", () => {
	const de = "Name;Betrag;Datum\nAnna;1.234,56;18.11.2026\nBen;7,5;19.11.2026\n";
	it("; beats decimal commas", () => {
		expect(detectDelimiter(de)).toBe(";");
		expect(parseCsv(de, cfg()).delimiter).toBe(";");
	});
	it("fr-FR file end to end", () => {
		for (const sp of [" ", " ", " "]) {
			const text = `Nom;Montant;Taux\nAnna;1${sp}234,56;12 %\nBen;99,5;7 %\nCy;12${sp}000${sp}001,25;1 %\n`;
			const parsed = parseCsv(text, cfg());
			expect(parsed.delimiter).toBe(";");
			const config = prepareConfig(cfg({ fileNameTemplate: "{{Nom}}" }), parsed, true);
			expect(config.decimalSeparator).toBe(",");
			expect(config.columns[1]).toMatchObject({ type: "number", stripUnits: true });
			expect(config.columns[2]).toMatchObject({ type: "number", stripUnits: true });
			const notes = planNotes(parsed, config, csv);
			expect(notes.map((n) => n.frontmatter["Montant"])).toEqual([1234.56, 99.5, 12000001.25]);
			expect(notes.map((n) => n.frontmatter["Taux"])).toEqual([12, 7, 1]);
		}
	});
});

describe("composite key", () => {
	const text = "Date,Amount,Memo\n2026-01-01,5,a\n2026-01-02,,b\n2026-01-03,7,\n";
	it("effectiveKeyColumns", () => {
		expect(effectiveKeyColumns(cfg())).toEqual([]);
		expect(effectiveKeyColumns(cfg({ keyColumn: "id" }))).toEqual(["id"]);
		expect(effectiveKeyColumns(cfg({ keyColumn: "id", keyColumns: ["a", "b"] }))).toEqual(["a", "b"]);
	});
	it("joins formatted values", () => {
		const parsed = parseCsv(text, cfg());
		const config = cfg({ keyColumns: ["Date", "Amount"], fileNameTemplate: "{{row}}" });
		const notes = planNotes(parsed, config, csv);
		expect(notes[0]!.key).toEqual({ property: "import_key", value: "2026-01-01 | 5" });
		expect(notes[0]!.frontmatter["import_key"]).toBe("2026-01-01 | 5");
		expect(notes[0]!.types["import_key"]).toBe("text");
		expect(notes[1]!.key).toBeNull(); // empty part
		expect(notes[2]!.key?.value).toBe("2026-01-03 | 7");
	});
	it("key property collision gets a suffix", () => {
		const parsed = parseCsv("a,b,import_key\n1,2,3\n", cfg());
		const config = cfg({ keyColumns: ["a", "b"], fileNameTemplate: "{{row}}" });
		const notes = planNotes(parsed, config, csv);
		expect(notes[0]!.key?.property).toBe("import_key 2");
		expect(notes[0]!.frontmatter["import_key"]).toBe(3);
	});
	it("one entry behaves like keyColumn", () => {
		const parsed = parseCsv(text, cfg());
		const notes = planNotes(parsed, cfg({ keyColumns: ["Memo"], fileNameTemplate: "{{row}}" }), csv);
		expect(notes[0]!.key).toEqual({ property: "Memo", value: "a" });
	});
});

describe("row filter", () => {
	const h = ["Name", "N", "Note"];
	const f = (op: RowFilter["op"], value: string, column = "Name"): RowFilter => ({ column, op, value });
	it("ops", () => {
		const row = [" Anna ", "10", ""];
		expect(rowMatches(null, h, row, ".")).toBe(true);
		expect(rowMatches(f("equals", "anna"), h, row, ".")).toBe(true);
		expect(rowMatches(f("notEquals", "anna"), h, row, ".")).toBe(false);
		expect(rowMatches(f("contains", "NN"), h, row, ".")).toBe(true);
		expect(rowMatches(f("notContains", "x"), h, row, ".")).toBe(true);
		expect(rowMatches(f("empty", "", "Note"), h, row, ".")).toBe(true);
		expect(rowMatches(f("notEmpty", "", "Note"), h, row, ".")).toBe(false);
		expect(rowMatches(f("greaterThan", "9", "N"), h, row, ".")).toBe(true);
		expect(rowMatches(f("greaterThan", "9", "N"), h, ["a", "10"], ".")).toBe(true);
		expect(rowMatches(f("lessThan", "9", "N"), h, row, ".")).toBe(false);
	});
	it("numeric comparison beats string comparison and is decimal-aware", () => {
		expect(rowMatches(f("greaterThan", "9", "N"), h, ["", "10", ""], ".")).toBe(true); // "10" < "9" as strings
		expect(rowMatches(f("greaterThan", "1,5", "N"), h, ["", "1,75", ""], ",")).toBe(true);
		expect(rowMatches(f("equals", "5", "N"), h, ["", "5.0", ""], ".")).toBe(true);
		expect(rowMatches(f("lessThan", "b"), h, ["a", "", ""], ".")).toBe(true);
	});
	it("unknown column matches nothing", () => {
		expect(rowMatches(f("notEmpty", "", "Nope"), h, ["a", "b", "c"], ".")).toBe(false);
		expect(rowMatches(f("empty", "", "Nope"), h, ["a", "b", "c"], ".")).toBe(false);
	});
	it("applied in planNotes keeping row numbers; countMatching", () => {
		const parsed = parseCsv("Name,Qty\na,1\nb,5\n\nc,7\n", cfg());
		const config = cfg({ fileNameTemplate: "{{Name}}", rowFilter: f("greaterThan", "2", "Qty") });
		const notes = planNotes(parsed, config, csv);
		expect(notes.map((n) => n.row)).toEqual([2, 3]);
		expect(countMatching(parsed, config)).toBe(2);
		expect(countMatching(parsed, cfg())).toBe(3);
	});
});

describe("findDuplicateKeys", () => {
	it("returns repeated key values", () => {
		const parsed = parseCsv("id,n\n1,a\n2,b\n1,c\n1,d\n,e\n,f\n", cfg());
		const notes = planNotes(parsed, cfg({ keyColumn: "id", fileNameTemplate: "{{row}}" }), csv);
		expect(findDuplicateKeys(notes)).toEqual(["1"]);
		expect(findDuplicateKeys([])).toEqual([]);
	});
});

describe("extra properties", () => {
	const now = new Date(2026, 10, 23, 9, 5, 7);
	const parsed = parseCsv("Name,Qty\nAnna,2\nBen,3\n", cfg());
	it("renders templates, converts types and marks fillOnly", () => {
		const config = cfg({
			fileNameTemplate: "{{Name}}",
			extraProperties: [
				{ property: "status", type: "text", defaultValue: "open" },
				{ property: "who", type: "text", defaultValue: "{{Name}} #{{row}} of {{file}}" },
				{ property: "imported", type: "date", defaultValue: "{{today}}" },
				{ property: "at", type: "datetime", defaultValue: "{{now}}" },
				{ property: "labels", type: "list", defaultValue: "a, b" },
				{ property: "score", type: "number", defaultValue: "4" },
				{ property: "blank", type: "text", defaultValue: "" },
			],
		});
		const n = planNotes(parsed, config, csv, { now })[0]!;
		expect(n.frontmatter).toMatchObject({
			status: "open",
			who: "Anna #1 of f",
			imported: "2026-11-23",
			at: "2026-11-23T09:05:07",
			labels: ["a", "b"],
			score: 4,
			blank: null,
		});
		expect(n.types["imported"]).toBe("date");
		expect(n.fillOnly).toEqual(["status", "who", "imported", "at", "labels", "score", "blank"]);
	});
	it("omit drops empty extras", () => {
		const config = cfg({ fileNameTemplate: "{{Name}}", emptyValues: "omit", extraProperties: [{ property: "blank", type: "text", defaultValue: "" }] });
		const n = planNotes(parsed, config, csv, { now })[0]!;
		expect("blank" in n.frontmatter).toBe(false);
		expect(n.fillOnly).toEqual([]);
	});
	it("column wins on collision; conflicts reported", () => {
		const config = cfg({
			fileNameTemplate: "{{Name}}",
			extraProperties: [
				{ property: "qty", type: "text", defaultValue: "x" },
				{ property: "ok", type: "text", defaultValue: "y" },
				{ property: "ok", type: "text", defaultValue: "z" },
				{ property: "", type: "text", defaultValue: "z" },
			],
		});
		config.columns = buildColumnConfigs(parsed, inf);
		expect(extraPropertyConflicts(config)).toEqual(["qty", "ok"]);
		const n = planNotes(parsed, config, csv, { now })[0]!;
		expect(n.frontmatter["Qty"]).toBe(2);
		expect(n.frontmatter["ok"]).toBe("y");
		expect(n.fillOnly).toEqual(["ok"]);
	});
	it("fillOnly is [] without extras", () => {
		expect(planNotes(parsed, cfg({ fileNameTemplate: "{{Name}}" }), csv)[0]!.fillOnly).toEqual([]);
	});
});

describe("merge fillOnly", () => {
	const base = { existing: {}, planned: {}, managed: [], snapshot: undefined, protectEdits: true, keepValuesOnEmpty: true };
	it("sets only when missing or empty", () => {
		const r = mergeFrontmatter({
			...base,
			existing: { a: "mine", b: "", c: null },
			planned: { a: "x", b: "x", c: "x", d: "x" },
			fillOnly: ["a", "b", "c", "d"],
		});
		expect(r.set).toEqual({ b: "x", c: "x", d: "x" });
		expect(r.preserved).toEqual([]);
		expect(r.snapshot["a"]).toBe(mergeFrontmatter({ ...base, existing: { a: "mine" }, planned: { a: "mine" }, managed: ["a"] }).snapshot["a"]);
	});
	it("never overwritten even with protectEdits off and a stale snapshot", () => {
		const r = mergeFrontmatter({ ...base, existing: { a: "edited" }, planned: { a: "new" }, snapshot: { a: "zzz" }, protectEdits: false, fillOnly: ["a"], managed: ["a"] });
		expect(r.set).toEqual({});
		expect(r.preserved).toEqual([]);
	});
	it("empty planned with missing key writes empty property; with existing empty does nothing", () => {
		expect(mergeFrontmatter({ ...base, planned: { a: null }, fillOnly: ["a"] }).set).toEqual({ a: null });
		expect(mergeFrontmatter({ ...base, existing: { a: "" }, planned: { a: null }, fillOnly: ["a"] }).set).toEqual({});
		expect(mergeFrontmatter({ ...base, existing: {}, planned: {}, fillOnly: ["a"] }).set).toEqual({});
	});
	it("other managed keys are unaffected", () => {
		const r = mergeFrontmatter({ ...base, existing: { a: "1" }, planned: { a: "2", f: "x" }, managed: ["a"], fillOnly: ["f"] });
		expect(r.set).toEqual({ a: "2", f: "x" });
	});
});

describe("migrateFileConfig", () => {
	it("fills defaults and converts legacy keyColumn", () => {
		const m = migrateFileConfig({ keyColumn: "id", delimiter: ";" }, DEFAULT_SETTINGS);
		expect(m.keyColumns).toEqual(["id"]);
		expect(m.keyColumn).toBe("id");
		expect(m.delimiter).toBe(";");
		expect(m.dateOrder).toBe("auto");
		expect(m.rowFilter).toBeNull();
		expect(m.extraProperties).toEqual([]);
		expect(m.keyProperty).toBe("import_key");
	});
	it("keeps existing keyColumns and sanitizes", () => {
		const m = migrateFileConfig({ keyColumn: "id", keyColumns: [] , dateOrder: "bad" as never, extraProperties: "x" as never, columns: null as never }, DEFAULT_SETTINGS);
		expect(m.keyColumns).toEqual([]);
		expect(m.dateOrder).toBe("auto");
		expect(m.extraProperties).toEqual([]);
		expect(m.columns).toEqual([]);
		expect(migrateFileConfig({ keyColumns: ["a", "b"] }, DEFAULT_SETTINGS).keyColumns).toEqual(["a", "b"]);
	});
	it("version constant", () => {
		expect(CURRENT_DATA_VERSION).toBe(1);
	});
});
