import { describe, expect, it } from "vitest";
import {
	buildColumnConfigs,
	convertValue,
	detectHeaderDrift,
	formatNumber,
	hasTimezoneOffsets,
	parseExcelSerial,
	inferColumnType,
	parseNumber,
	reconcileColumns,
	toPropertyName,
} from "../src/csv/typeInference";
import { parseCsv } from "../src/csv/parser";
import type { ColumnConfig } from "../src/types";

const dot = { decimalSeparator: "." as const, midnightAsDate: false, listSeparator: "," };
const comma = { ...dot, decimalSeparator: "," as const };
const conv = { decimalSeparator: "." as const, listSeparator: "," };
const convComma = { decimalSeparator: "," as const, listSeparator: ";" };

describe("parseNumber", () => {
	it("parses plain, signed, decimal and exponent numbers", () => {
		expect(parseNumber("5", ".")).toBe(5);
		expect(parseNumber("-5", ".")).toBe(-5);
		expect(parseNumber("+0.625", ".")).toBe(0.625);
		expect(parseNumber(".5", ".")).toBe(0.5);
		expect(parseNumber("1e3", ".")).toBe(1000);
		expect(parseNumber("2.5E-2", ".")).toBe(0.025);
	});
	it("supports comma decimals and grouping", () => {
		expect(parseNumber("0,625", ",")).toBe(0.625);
		expect(parseNumber("1.234,5", ",")).toBe(1234.5);
		expect(parseNumber("1.234.567", ",")).toBe(1234567);
		expect(parseNumber("1,234.5", ".")).toBe(1234.5);
	});
	it("rejects invalid grouping and garbage", () => {
		expect(parseNumber("1,23", ".")).toBeNull();
		expect(parseNumber("12,34.5", ".")).toBeNull();
		expect(parseNumber("0,625", ".")).toBeNull();
		expect(parseNumber("abc", ".")).toBeNull();
		expect(parseNumber("", ".")).toBeNull();
		expect(parseNumber("1 2", ".")).toBeNull();
		expect(parseNumber("-", ".")).toBeNull();
		expect(parseNumber("1e999", ".")).toBeNull();
	});
	it("strict mode rejects leading zeros and long digit strings", () => {
		expect(parseNumber("007", ".", true)).toBeNull();
		expect(parseNumber("0", ".", true)).toBe(0);
		expect(parseNumber("0.5", ".", true)).toBe(0.5);
		expect(parseNumber("1234567890123456", ".", true)).toBeNull();
		expect(parseNumber("007", ".", false)).toBe(7);
	});
});

describe("inferColumnType", () => {
	it("infers numbers (dot)", () => {
		expect(inferColumnType(["0.625", "5", "-3", "12"], dot)).toBe("number");
		expect(inferColumnType(["1,234.5", "2"], dot)).toBe("number");
	});
	it("infers numbers (comma)", () => {
		expect(inferColumnType(["0,625", "5", "1.234,5"], comma)).toBe("number");
	});
	it("a comma number is text with dot separator", () => {
		expect(inferColumnType(["0,625", "5"], dot)).toBe("text");
	});
	it("ignores empty cells", () => {
		expect(inferColumnType(["", "5", "  ", "6"], dot)).toBe("number");
		expect(inferColumnType(["", ""], dot)).toBe("text");
		expect(inferColumnType([], dot)).toBe("text");
	});
	it("keeps leading-zero and long IDs as text", () => {
		expect(inferColumnType(["007", "008"], dot)).toBe("text");
		expect(inferColumnType(["4915112345678901234"], dot)).toBe("text");
		expect(inferColumnType(["0123", "5"], dot)).toBe("text");
	});
	it("infers checkbox", () => {
		expect(inferColumnType(["true", "FALSE", "Yes", "no", ""], dot)).toBe("checkbox");
		expect(inferColumnType(["true", "maybe"], dot)).toBe("text");
	});
	it("treats 0/1 as number, not checkbox", () => {
		expect(inferColumnType(["0", "1", "1"], dot)).toBe("number");
	});
	it("infers dates in all formats", () => {
		expect(inferColumnType(["2026-11-18", "2026-01-02"], dot)).toBe("date");
		expect(inferColumnType(["18.11.2026", "02.01.2026"], dot)).toBe("date");
		expect(inferColumnType(["2026/11/18"], dot)).toBe("date");
	});
	it("rejects invalid calendar dates", () => {
		expect(inferColumnType(["2026-02-30"], dot)).toBe("text");
		expect(inferColumnType(["2026-13-01"], dot)).toBe("text");
		expect(inferColumnType(["2025-02-29"], dot)).toBe("text");
		expect(inferColumnType(["2024-02-29"], dot)).toBe("date");
	});
	it("infers datetime", () => {
		expect(inferColumnType(["2026-11-18 08:30", "2026-11-18T09:15:10"], dot)).toBe("datetime");
		expect(inferColumnType(["2026-11-18T09:15:10.123Z", "2026-11-18 09:15:10+02:00"], dot)).toBe("datetime");
		expect(inferColumnType(["2026-11-18 25:00"], dot)).toBe("text");
	});
	it("midnightAsDate collapses midnight datetimes", () => {
		const vals = ["2026-11-18 00:00:00", "2026-11-19 00:00"];
		expect(inferColumnType(vals, dot)).toBe("datetime");
		expect(inferColumnType(vals, { ...dot, midnightAsDate: true })).toBe("date");
		expect(inferColumnType([...vals, "2026-11-20 01:00:00"], { ...dot, midnightAsDate: true })).toBe("datetime");
	});
	it("mixed date and datetime is datetime", () => {
		expect(inferColumnType(["2026-11-18", "2026-11-19 10:00"], dot)).toBe("datetime");
	});
	it("never infers list", () => {
		expect(inferColumnType(["a, b", "c, d"], dot)).toBe("text");
	});
	it("mixed content is text", () => {
		expect(inferColumnType(["5", "abc"], dot)).toBe("text");
	});
});

describe("convertValue", () => {
	it("converts numbers", () => {
		expect(convertValue("0.625", "number", conv)).toBe(0.625);
		expect(convertValue("0,625", "number", convComma)).toBe(0.625);
		expect(convertValue(" 5 ", "number", conv)).toBe(5);
		expect(convertValue("007", "number", conv)).toBe(7);
	});
	it("converts checkboxes", () => {
		expect(convertValue("Yes", "checkbox", conv)).toBe(true);
		expect(convertValue("no", "checkbox", conv)).toBe(false);
	});
	it("converts dates and datetimes", () => {
		expect(convertValue("18.11.2026", "date", conv)).toBe("2026-11-18");
		expect(convertValue("2026/11/18", "date", conv)).toBe("2026-11-18");
		expect(convertValue("2026-11-18 00:00:00", "date", conv)).toBe("2026-11-18");
		expect(convertValue("2026-11-18 08:30", "datetime", conv)).toBe("2026-11-18T08:30:00");
		expect(convertValue("2026-11-18T08:30:15.500+02:00", "datetime", conv)).toBe("2026-11-18T08:30:15");
		expect(convertValue("2026-11-18", "datetime", conv)).toBe("2026-11-18T00:00:00");
	});
	it("converts lists", () => {
		expect(convertValue(" a, b ,,c ", "list", conv)).toEqual(["a", "b", "c"]);
		expect(convertValue("a;b", "list", convComma)).toEqual(["a", "b"]);
		expect(convertValue(",,", "list", conv)).toBeNull();
	});
	it("trims text", () => {
		expect(convertValue("  hi  ", "text", conv)).toBe("hi");
	});
	it("empty -> null for every type", () => {
		for (const t of ["text", "number", "checkbox", "date", "datetime", "list"] as const) {
			expect(convertValue("", t, conv)).toBeNull();
			expect(convertValue("   ", t, conv)).toBeNull();
		}
	});
	it("falls back to trimmed raw string when unparseable", () => {
		expect(convertValue(" abc ", "number", conv)).toBe("abc");
		expect(convertValue("maybe", "checkbox", conv)).toBe("maybe");
		expect(convertValue("soon", "date", conv)).toBe("soon");
		expect(convertValue("soon", "datetime", conv)).toBe("soon");
	});
});

describe("toPropertyName", () => {
	it("trims and collapses whitespace", () => {
		expect(toPropertyName("  Hello   World ")).toBe("Hello World");
	});
	it("removes hostile characters", () => {
		expect(toPropertyName("#tag [x] {y}, z")).toBe("tag x y z");
		expect(toPropertyName("- ? : name")).toBe("name");
		expect(toPropertyName("Time: Start")).toBe("Time Start");
	});
	it("keeps unicode letters", () => {
		expect(toPropertyName("Größe äöü ß")).toBe("Größe äöü ß");
	});
	it("falls back to property", () => {
		expect(toPropertyName("")).toBe("property");
		expect(toPropertyName("  ## ")).toBe("property");
	});
});

describe("buildColumnConfigs / reconcileColumns", () => {
	it("builds configs with unique property names", () => {
		const parsed = parseCsv("A,A,#,[]\n1,2,3,4", { delimiter: ",", hasHeader: true });
		const cfg = buildColumnConfigs(parsed, dot);
		expect(cfg.map((c) => c.property)).toEqual(["A", "A 2", "property", "property 2"]);
		expect(cfg.every((c) => c.include)).toBe(true);
		expect(cfg.map((c) => c.index)).toEqual([0, 1, 2, 3]);
		expect(cfg[0].type).toBe("number");
	});

	it("reconcile keeps user choices, adds new, drops removed, reindexes", () => {
		const old = parseCsv("a,b,c\n1,2,x", { delimiter: ",", hasHeader: true });
		const cfg = buildColumnConfigs(old, dot);
		cfg[1] = { ...cfg[1], property: "Renamed", type: "text", include: false };
		const next = parseCsv("c,b,d\nx,2,2026-01-01", { delimiter: ",", hasHeader: true });
		const out = reconcileColumns(cfg, next, dot);
		expect(out.map((c) => c.source)).toEqual(["c", "b", "d"]);
		expect(out.map((c) => c.index)).toEqual([0, 1, 2]);
		expect(out[1]).toMatchObject({ property: "Renamed", type: "text", include: false });
		expect(out[2]).toMatchObject({ property: "d", type: "date", include: true });
	});

	it("reconcile keeps new property names unique against kept ones", () => {
		const existing: ColumnConfig[] = [{ source: "a", index: 0, property: "x", type: "text", include: true }];
		const parsed = parseCsv("a,x\n1,2", { delimiter: ",", hasHeader: true });
		const out = reconcileColumns(existing, parsed, dot);
		expect(out.map((c) => c.property)).toEqual(["x", "x 2"]);
	});
});

describe("detectHeaderDrift", () => {
	const parsed = parseCsv("a,b,c\n1,2,3\n", { delimiter: ",", hasHeader: true });
	const col = (source: string, index: number): ColumnConfig => ({ source, index, property: source, type: "text", include: true });
	it("reports added and removed headers", () => {
		expect(detectHeaderDrift([col("a", 0), col("x", 1), col("b", 2)], parsed)).toEqual({ added: ["c"], removed: ["x"] });
	});
	it("no drift", () => {
		expect(detectHeaderDrift([col("a", 0), col("b", 1), col("c", 2)], parsed)).toEqual({ added: [], removed: [] });
	});
	it("empty columns -> nothing", () => {
		expect(detectHeaderDrift([], parsed)).toEqual({ added: [], removed: [] });
	});
});

describe("S5 strict inference", () => {
	const dot = { decimalSeparator: ".", midnightAsDate: true, listSeparator: "," } as const;
	it("keeps +49 phone numbers and exponents as text, convertValue stays lenient", () => {
		expect(inferColumnType(["+491234", "+4955"], dot)).toBe("text");
		expect(inferColumnType(["1e5", "2"], dot)).toBe("text");
		expect(inferColumnType(["12E3"], dot)).toBe("text");
		expect(convertValue("1e5", "number", { decimalSeparator: ".", listSeparator: "," })).toBe(100000);
		expect(convertValue("+5", "number", { decimalSeparator: ".", listSeparator: "," })).toBe(5);
	});
	it("a column of only 'no' is text, other bool columns stay checkboxes", () => {
		for (const v of ["no", "No", "NO"]) expect(inferColumnType([v, v], dot)).toBe("text");
		expect(inferColumnType(["no", "yes"], dot)).toBe("checkbox");
		expect(inferColumnType(["no", "false"], dot)).toBe("checkbox");
		expect(inferColumnType(["yes", "yes"], dot)).toBe("checkbox");
		expect(inferColumnType(["true", "false", ""], dot)).toBe("checkbox");
	});
	it("Excel serial 60 is not converted", () => {
		expect(parseExcelSerial("60", ".")).toBeNull();
		expect(convertValue("60", "date", { decimalSeparator: ".", listSeparator: "," })).toBe("60");
		expect(parseExcelSerial("61", ".")?.date).toBe("1900-03-01");
		expect(parseExcelSerial("59", ".")?.date).toBe("1900-02-28");
	});
	it("tiny numbers do not collapse to 0 and stay YAML numbers", () => {
		const out = formatNumber(1.5e-120);
		expect(out).toBe("1.5e-120");
		expect(Number(out)).toBe(1.5e-120);
		expect(formatNumber(1e-130)).toBe("1.0e-130");
		expect(formatNumber(1e-7)).toBe("0.0000001");
		expect(formatNumber(0)).toBe("0");
		expect(formatNumber(1e-120, 3)).toBe("0");
	});
});

describe("hasTimezoneOffsets", () => {
	it("detects Z and offsets on datetimes only", () => {
		expect(hasTimezoneOffsets(["2024-01-01T10:00:00Z"])).toBe(true);
		expect(hasTimezoneOffsets(["x", "2024-01-01 10:00+02:00"])).toBe(true);
		expect(hasTimezoneOffsets(["2024-01-01T10:00:00", "2024-01-01", "-5"])).toBe(false);
	});
});

describe("property name uniqueness", () => {
	it("is case-insensitive and truncated", () => {
		const parsed = { headers: ["Name", "name", "NAME"], rows: [["a", "b", "c"]], delimiter: "," as const, warnings: [] };
		const cols = buildColumnConfigs(parsed, { decimalSeparator: ".", midnightAsDate: true, listSeparator: "," });
		expect(cols.map((c) => c.property)).toEqual(["Name", "name 2", "NAME 3"]);
		expect(toPropertyName("x".repeat(500))).toHaveLength(200);
		expect(toPropertyName("\u{1F600}".repeat(150))).toHaveLength(200);
	});
});
