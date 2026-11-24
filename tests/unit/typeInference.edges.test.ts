// Boundary and edge-case behavior of type inference and conversion (complements typeInference.test.ts).
import { describe, expect, it } from "vitest";
import {
	buildColumnConfigs,
	convertValue,
	formatNumber,
	hasTimezoneOffsets,
	inferColumnType,
	parseExcelSerial,
	parseNumber,
	prepareConfig,
	reconcileColumns,
	resolveDateOrder,
	stripNumberUnits,
	suggestKeyColumn,
	toPropertyName,
} from "../../src/csv/typeInference";
import { createDefaultFileConfig, DEFAULT_SETTINGS } from "../../src/defaults";
import type { ColumnConfig, ParsedCsv } from "../../src/types";

const dot = { decimalSeparator: "." as const, midnightAsDate: false, listSeparator: "," };
const conv = { decimalSeparator: "." as const, listSeparator: "," };

function csv(headers: string[], rows: string[][]): ParsedCsv {
	return { headers, rows } as unknown as ParsedCsv;
}

function col(source: string, index: number, type: ColumnConfig["type"] = "text", include = true): ColumnConfig {
	return { source, index, property: source, type, include };
}

describe("formatNumber", () => {
	it("returns an empty string for non-finite numbers", () => {
		expect(formatNumber(Number.NaN)).toBe("");
		expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("");
	});

	it("keeps the source precision when precision is null, undefined or negative", () => {
		expect(formatNumber(1.25, null)).toBe("1.25");
		expect(formatNumber(1.25, undefined)).toBe("1.25");
		expect(formatNumber(1.25, -1)).toBe("1.25");
	});

	it("rounds to the given precision and strips trailing zeros", () => {
		expect(formatNumber(1.6, 0)).toBe("2");
		expect(formatNumber(100, 0)).toBe("100");
		expect(formatNumber(1.5, 2)).toBe("1.5");
		expect(formatNumber(1.005, 1)).toBe("1");
		expect(formatNumber(-0.001, 2)).toBe("0");
	});

	it("writes huge numbers without exponent notation, with or without precision", () => {
		expect(formatNumber(1e21)).toBe("1000000000000000000000");
		expect(formatNumber(1.5e21)).toBe("1500000000000000000000");
		expect(formatNumber(-1e21)).toBe("-1000000000000000000000");
		expect(formatNumber(-1.5e21, 2)).toBe("-1500000000000000000000");
	});

	it("writes small numbers in plain decimals up to 100 places, beyond that in exponent form", () => {
		expect(formatNumber(1.25e-7)).toBe("0.000000125");
		expect(formatNumber(1e-100)).toBe(`0.${"0".repeat(99)}1`);
		expect(formatNumber(1.5e-100)).toBe("1.5e-100");
		expect(formatNumber(1e-101)).toBe("1.0e-101");
	});
});

describe("stripNumberUnits / parseNumber", () => {
	it("joins a sign separated from the digits by spaces", () => {
		expect(stripNumberUnits("€ -  12")).toBe("-12");
		expect(stripNumberUnits("+ 5 %")).toBe("+5");
	});

	it("only touches a sign at the start", () => {
		expect(stripNumberUnits("12 - 3")).toBe("12 - 3");
	});

	it("trims surrounding whitespace", () => {
		expect(parseNumber(" 5 ", ".")).toBe(5);
		expect(parseNumber("\t-2.5\n", ".")).toBe(-2.5);
	});

	it("strict mode accepts exactly 15 significant digits, integer and fraction counted together", () => {
		expect(parseNumber("123456789012345", ".", true)).toBe(123456789012345);
		expect(parseNumber("1234567890.12345", ".", true)).toBe(1234567890.12345);
		expect(parseNumber("1234567890.123456", ".", true)).toBeNull();
		expect(parseNumber("1234567890.123456", ".", false)).toBe(1234567890.123456);
	});
});

describe("calendar validation", () => {
	it("rejects month 0 and day 0", () => {
		expect(inferColumnType(["2026-00-10"], dot)).toBe("text");
		expect(inferColumnType(["2026-01-00"], dot)).toBe("text");
		expect(convertValue("2026-00-10", "date", conv)).toBe("2026-00-10");
	});

	it("applies the Gregorian leap-year rules to 29 February", () => {
		expect(convertValue("2024-02-29", "date", conv)).toBe("2024-02-29");
		expect(convertValue("2000-02-29", "date", conv)).toBe("2000-02-29");
		expect(convertValue("2023-02-29", "date", conv)).toBe("2023-02-29"); // unchanged raw text
		expect(inferColumnType(["2023-02-29"], dot)).toBe("text");
		expect(inferColumnType(["1900-02-29"], dot)).toBe("text");
		expect(inferColumnType(["2100-02-29"], dot)).toBe("text");
		expect(inferColumnType(["2000-02-29"], dot)).toBe("date");
	});

	it("does not cap other months at 28 days in common years", () => {
		expect(inferColumnType(["2023-03-31", "2023-01-29"], dot)).toBe("date");
		expect(inferColumnType(["2023-04-31"], dot)).toBe("text");
	});

	it("accepts the last valid time of day and rejects one past it", () => {
		expect(inferColumnType(["2026-11-18 23:59:59"], dot)).toBe("datetime");
		expect(inferColumnType(["2026-11-18 24:00"], dot)).toBe("text");
		expect(inferColumnType(["2026-11-18 10:60"], dot)).toBe("text");
		expect(inferColumnType(["2026-11-18 10:00:60"], dot)).toBe("text");
		expect(convertValue("2026-11-18 23:59:59", "datetime", conv)).toBe("2026-11-18T23:59:59");
	});

	it("a time after something that is not a date is not a datetime", () => {
		expect(inferColumnType(["foo 10:00"], dot)).toBe("text");
		expect(convertValue("foo 10:00", "datetime", conv)).toBe("foo 10:00");
	});
});

describe("slash dates", () => {
	it("convertValue without a date order reads unambiguous values per value", () => {
		expect(convertValue("13/04/2026", "date", conv)).toBe("2026-04-13");
		expect(convertValue("04/13/2026", "date", conv)).toBe("2026-04-13");
		expect(convertValue("05/05/2026", "date", conv)).toBe("2026-05-05");
		expect(convertValue("13/04/2026 10:00", "datetime", conv)).toBe("2026-04-13T10:00:00");
		expect(convertValue("13/04/2026", "date", { ...conv, dateOrder: "auto" })).toBe("2026-04-13");
	});

	it("convertValue keeps ambiguous values (both parts 12 or less) as text", () => {
		expect(convertValue("03/04/2026", "date", conv)).toBe("03/04/2026");
		expect(convertValue("12/05/2026", "date", conv)).toBe("12/05/2026");
		expect(convertValue("05/12/2026", "date", conv)).toBe("05/12/2026");
	});

	it("explicit orders win over the per-value guess", () => {
		expect(convertValue("03/04/2026", "date", { ...conv, dateOrder: "dmy" })).toBe("2026-04-03");
		expect(convertValue("03/04/2026", "date", { ...conv, dateOrder: "mdy" })).toBe("2026-03-04");
	});

	it("resolveDateOrder needs a part greater than 12 and ignores surrounding whitespace", () => {
		expect(resolveDateOrder([" 13/04/2026 "])).toBe("dmy");
		expect(resolveDateOrder(["04/13/2026 10:00"])).toBe("mdy");
		expect(resolveDateOrder(["12/05/2026"])).toBeNull();
		expect(resolveDateOrder(["05/12/2026"])).toBeNull();
		expect(resolveDateOrder(["13/04/2026", "04/13/2026"])).toBeNull();
		expect(resolveDateOrder(["03/04/2026"], "mdy")).toBe("mdy");
	});
});

describe("hasTimezoneOffsets", () => {
	it("ignores datetimes without a zone and values that are not dates", () => {
		expect(hasTimezoneOffsets(["2026-11-18 10:00"])).toBe(false);
		expect(hasTimezoneOffsets(["foo 10:00Z"])).toBe(false);
	});

	it("trims values and reads unambiguous slash dates", () => {
		expect(hasTimezoneOffsets([" 2026-11-18T10:00Z "])).toBe(true);
		expect(hasTimezoneOffsets(["13/04/2026 10:00Z"])).toBe(true);
	});
});

describe("parseExcelSerial", () => {
	it("returns a date for whole serials and a datetime for fractions", () => {
		expect(parseExcelSerial("45000", ".")).toEqual({ kind: "date", date: "2023-03-15" });
		expect(parseExcelSerial(" 45000 ", ".")).toEqual({ kind: "date", date: "2023-03-15" });
		expect(parseExcelSerial("45000.0625", ".")).toEqual({ kind: "datetime", date: "2023-03-15", time: "01:30:00" });
		expect(parseExcelSerial("45000,25", ",")).toEqual({ kind: "datetime", date: "2023-03-15", time: "06:00:00" });
	});

	it("rolls a fraction that rounds to a full day over to the next day", () => {
		expect(parseExcelSerial("45000.9999999", ".")).toEqual({ kind: "date", date: "2023-03-16" });
	});

	it("covers serials 1 to 2958465 and skips the fake 1900-02-29", () => {
		expect(parseExcelSerial("1", ".")).toEqual({ kind: "date", date: "1900-01-01" });
		expect(parseExcelSerial("59", ".")).toEqual({ kind: "date", date: "1900-02-28" });
		expect(parseExcelSerial("61", ".")).toEqual({ kind: "date", date: "1900-03-01" });
		expect(parseExcelSerial("2958465", ".")).toEqual({ kind: "date", date: "9999-12-31" });
		expect(parseExcelSerial("0", ".")).toBeNull();
		expect(parseExcelSerial("0.5", ".")).toBeNull();
		expect(parseExcelSerial("2958466", ".")).toBeNull();
	});

	it("accepts only plain unsigned digits", () => {
		expect(parseExcelSerial("045000", ".")).toEqual({ kind: "date", date: "2023-03-15" });
		expect(parseExcelSerial("+45000", ".")).toBeNull();
		expect(parseExcelSerial("4500e1", ".")).toBeNull();
		expect(parseExcelSerial("1e3", ".")).toBeNull();
	});
});

describe("inference of unit columns", () => {
	it("a column with units and plain text is text", () => {
		expect(inferColumnType(["12 %", "abc"], dot)).toBe("text");
		expect(inferColumnType(["abc", "12 %"], dot)).toBe("text");
	});

	it("marks only real unit columns with stripUnits", () => {
		const parsed = csv(
			["text", "empty", "bool", "date", "dt", "num", "unit", "no"],
			[
				["a", "", "yes", "2026-01-01", "2026-01-01 10:00", "1", "5 %", "no"],
				["b", "", "no", "2026-01-02", "2026-01-02 11:00", "2", "6 %", "no"],
			],
		);
		const cols = buildColumnConfigs(parsed, dot);
		expect(cols.map((c) => [c.source, c.type, c.stripUnits])).toEqual([
			["text", "text", undefined],
			["empty", "text", undefined],
			["bool", "checkbox", undefined],
			["date", "date", undefined],
			["dt", "datetime", undefined],
			["num", "number", undefined],
			["unit", "number", true],
			["no", "text", undefined],
		]);
		const midnight = buildColumnConfigs(csv(["m"], [["2026-01-01 00:00"]]), { ...dot, midnightAsDate: true });
		expect(midnight[0]).not.toHaveProperty("stripUnits");
		expect(midnight[0]?.type).toBe("date");
	});

	it("treats missing cells of short rows as empty", () => {
		const cols = buildColumnConfigs(csv(["a", "b"], [["x", "1"], ["y"], ["z", "3"]]), dot);
		expect(cols[1]?.type).toBe("number");
	});
});

describe("convertValue edges", () => {
	it("a missing cell is null", () => {
		expect(convertValue(undefined as unknown as string, "text", conv)).toBeNull();
	});

	it("an empty list separator keeps the cell as one item", () => {
		expect(convertValue("a,b", "list", { ...conv, listSeparator: "" })).toEqual(["a,b"]);
	});
});

describe("toPropertyName edges", () => {
	it("turns control characters into spaces", () => {
		expect(toPropertyName("a\tb")).toBe("a b");
		expect(toPropertyName("a\u0000b")).toBe("a b");
	});

	it("drops a trailing colon and colons before spaces, keeps inner colons", () => {
		expect(toPropertyName("Note:")).toBe("Note");
		expect(toPropertyName("a: b")).toBe("a b");
		expect(toPropertyName("a:b")).toBe("a:b");
	});

	it("falls back to 'property' for a missing header", () => {
		expect(toPropertyName(undefined as unknown as string)).toBe("property");
	});

	it("truncates at 200 characters without splitting surrogate pairs or leaving trailing space", () => {
		const a199 = "a".repeat(199);
		expect(toPropertyName(`${a199}😀b`)).toBe(a199);
		expect(toPropertyName(`${a199}\u{10000}b`)).toBe(a199);
		expect(toPropertyName(`${a199}\u{10FFFF}b`)).toBe(a199);
		expect(toPropertyName(`${a199} bc`)).toBe(a199);
		expect(toPropertyName(`${"a".repeat(200)}b`)).toBe("a".repeat(200));
	});
});

describe("reconcileColumns duplicates", () => {
	it("uses the first saved config of a duplicated source", () => {
		const existing = [{ ...col("a", 0), property: "first" }, { ...col("a", 0), property: "second" }];
		const out = reconcileColumns(existing, csv(["a"], [["1"]]), dot);
		expect(out.map((c) => c.property)).toEqual(["first"]);
	});
});

describe("prepareConfig: decimal separator detection", () => {
	function prep(rows: string[][], sep: "." | ",", columns: ColumnConfig[] = []) {
		const cfg = { ...createDefaultFileConfig(DEFAULT_SETTINGS), decimalSeparator: sep, columns };
		const headers = (rows[0] ?? []).map((_, i) => `c${i}`);
		return prepareConfig(cfg, csv(headers, rows), true).decimalSeparator;
	}

	it("detects a comma or dot column", () => {
		expect(prep([["1,5"], ["2,25"]], ".")).toBe(",");
		expect(prep([["1.5"], ["2.25"]], ",")).toBe(".");
	});

	it("keeps the configured separator without evidence or on a tie", () => {
		expect(prep([["1"], ["2"]], ",")).toBe(",");
		expect(prep([["abc"]], ",")).toBe(",");
		expect(prep([["1,5", "1.5"]], ",")).toBe(",");
		expect(prep([["1,5", "1.5"]], ".")).toBe(".");
	});

	it("the majority of columns wins", () => {
		expect(prep([["1,5", "2,5", "1.5"]], ".")).toBe(",");
		expect(prep([["1,5", "1.5", "2.5"]], ",")).toBe(".");
	});

	it("looks at all values of a column, skipping empty and missing cells", () => {
		expect(prep([["1"], ["1,5"]], ".")).toBe(",");
		expect(prep([["1,5"], [""]], ".")).toBe(",");
		expect(prep([["x", "1,5"], ["y"]], ".")).toBe(",");
	});

	it("a column with a non-number does not vote", () => {
		expect(prep([["1,5"], ["abc"]], ".")).toBe(".");
		expect(prep([["1.5"], ["abc"]], ",")).toBe(",");
	});

	it("votes like inference: units are stripped, exponents do not count", () => {
		expect(prep([["12,5 %"]], ".")).toBe(",");
		expect(prep([["12.5 %"]], ",")).toBe(".");
		expect(prep([["1,5"], ["1e5"]], ".")).toBe(".");
		expect(prep([["1.5"], ["1e5"]], ",")).toBe(",");
	});

	it("does not re-detect for an already configured file", () => {
		expect(prep([["1,5"]], ".", [col("c0", 0)])).toBe(".");
	});
});

describe("suggestKeyColumn edges", () => {
	it("skips excluded columns", () => {
		const parsed = csv(["id", "name"], [["1", "a"], ["2", "b"]]);
		expect(suggestKeyColumn(parsed, [col("id", 0, "number", false), col("name", 1)])).toBe("name");
	});

	it("recognizes id-like headers with surrounding whitespace", () => {
		const parsed = csv([" id ", "userid "], [["1", "7"], ["2", "8"]]);
		expect(suggestKeyColumn(parsed, [col(" id ", 0, "number")])).toBe(" id ");
		expect(suggestKeyColumn(parsed, [col("userid ", 1, "number")])).toBe("userid ");
		expect(suggestKeyColumn(parsed, [col(" nr ", 1, "number")])).toBe(" nr ");
	});

	it("only headers ending in 'id' count as id-like", () => {
		const parsed = csv(["idx"], [["1"], ["2"]]);
		expect(suggestKeyColumn(parsed, [col("idx", 0, "number")])).toBeNull();
	});

	it("a missing cell disqualifies a column", () => {
		const parsed = csv(["x", "id"], [["a", "1"], ["b"]]);
		expect(suggestKeyColumn(parsed, [col("id", 1, "number")])).toBeNull();
	});

	it("id names must match the whole header", () => {
		const parsed = csv(["h"], [["1"], ["2"]]);
		for (const name of ["Nr", "code", "UUID", "Nummer"]) expect(suggestKeyColumn(parsed, [col(name, 0, "number")]), name).toBe(name);
		for (const name of ["zipcode", "codex", "nrx"]) expect(suggestKeyColumn(parsed, [col(name, 0, "number")]), name).toBeNull();
	});
});

describe("recognized date formats", () => {
	const asDate = (v: string) => convertValue(v, "date", conv);
	const asDatetime = (v: string) => convertValue(v, "datetime", conv);

	it("reads each numeric format, and only the whole value", () => {
		const cases: [string, string][] = [
			["2026-01-02", "2026-01-02"],
			["2026/01/02", "2026-01-02"],
			["02.01.2026", "2026-01-02"],
			["2-1-2026", "2026-01-02"],
			["02-01-2026", "2026-01-02"],
			["13/1/2026", "2026-01-13"],
		];
		for (const [raw, iso] of cases) expect(asDate(raw), raw).toBe(iso);
		const rejected = [
			"x2026-01-02", "2026-01-02x", "26-01-02", "2026-1-02", "2026-01-2", "2026-0a-02",
			"x2026/01/02", "2026/01/02x", "2026/1/02", "2026/01/2",
			"x02.01.2026", "02.01.2026x", "2.01.2026", "02.1.2026", "02.01.26",
			"x2-1-2026", "2-1-2026x", "123-1-2026", "2-1-26",
			"x13/1/2026", "13/1/2026x", "13/1/26", "13/123/2026",
		];
		for (const raw of rejected) expect(asDate(raw), raw).toBe(raw);
	});

	it("reads month names day-first and month-first, in English and German", () => {
		const cases: [string, string][] = [
			["3 March 2026", "2026-03-03"],
			["3. März 2026", "2026-03-03"],
			["3 Mar. 2026", "2026-03-03"],
			["03 mar, 2026", "2026-03-03"],
			["3  March   2026", "2026-03-03"],
			["March 3, 2026", "2026-03-03"],
			["Mar. 3rd 2026", "2026-03-03"],
			["March 21st, 2026", "2026-03-21"],
			["march  3   2026", "2026-03-03"],
		];
		for (const [raw, iso] of cases) expect(asDate(raw), raw).toBe(iso);
		const rejected = [
			"x3 March 2026", "3 March 2026x", "3 March 26", "123 March 2026", "3March 2026", "3 Foo 2026", "3 M 2026",
			"xMarch 3, 2026", "March 3, 2026x", "March 3, 26", "March 123, 2026", "March3, 2026", "Foo 3, 2026",
		];
		for (const raw of rejected) expect(asDate(raw), raw).toBe(raw);
	});

	it("knows every month name and abbreviation", () => {
		const names = [
			["jan", "january", "januar", "jänner", "janner"],
			["feb", "february", "februar"],
			["mar", "march", "mär", "märz", "maerz", "marz"],
			["apr", "april"],
			["may", "mai"],
			["jun", "june", "juni"],
			["jul", "july", "juli"],
			["aug", "august"],
			["sep", "sept", "september"],
			["oct", "october", "okt", "oktober"],
			["nov", "november"],
			["dec", "december", "dez", "dezember"],
		];
		names.forEach((list, i) => {
			for (const name of list) expect(asDate(`1 ${name} 2026`), name).toBe(`2026-${String(i + 1).padStart(2, "0")}-01`);
		});
	});

	it("reads a trailing time with T or space, optional seconds, fractions and zones", () => {
		const cases: [string, string][] = [
			["2026-01-02T3:04", "2026-01-02T03:04:00"],
			["2026-01-02 13:04:05", "2026-01-02T13:04:05"],
			["2026-01-02 13:04:05.123", "2026-01-02T13:04:05"],
			["2026-01-02 13:04:05,5", "2026-01-02T13:04:05"],
			["2026-01-02 13:04Z", "2026-01-02T13:04:00"],
			["2026-01-02 13:04 Z", "2026-01-02T13:04:00"],
			["2026-01-02 13:04:05+02", "2026-01-02T13:04:05"],
			["2026-01-02 13:04:05-0230", "2026-01-02T13:04:05"],
			["2026-01-02 13:04:05+02:30", "2026-01-02T13:04:05"],
			["3 March 2026 10:00", "2026-03-03T10:00:00"],
		];
		for (const [raw, iso] of cases) expect(asDatetime(raw), raw).toBe(iso);
		const rejected = [
			"x2026-01-02 13:04", "2026-01-02 13:04x", "2026-01-02X13:04", "2026-01-02 123:04", "2026-01-02 13:4",
			"2026-01-02 13:04:5", "2026-01-02 13:04:05.", "2026-01-02 13:04:05x1", "2026-01-02 13:04+2",
			"2026-01-02 13:04+02:3", "2026-01-02 13:04 x",
		];
		for (const raw of rejected) expect(asDatetime(raw), raw).toBe(raw);
	});
});

describe("stripNumberUnits grouping", () => {
	it("removes space-like thousands separators only in groups of three", () => {
		expect(stripNumberUnits("1 234")).toBe("1234");
		expect(stripNumberUnits("-12 345 678,5")).toBe("-12345678,5");
		expect(stripNumberUnits("1 234.5 €")).toBe("1234.5");
		expect(stripNumberUnits("1 234.56")).toBe("1234.56");
		expect(stripNumberUnits("+1 234")).toBe("+1234");
		expect(stripNumberUnits("1234 567")).toBe("1234 567");
		expect(stripNumberUnits("1 23")).toBe("1 23");
		expect(stripNumberUnits("1 2345")).toBe("1 2345");
		expect(stripNumberUnits("1 234x")).toBe("1 234x");
		expect(stripNumberUnits("1 234.5x")).toBe("1 234.5x");
		expect(stripNumberUnits("a 234")).toBe("a 234");
	});

	it("removes currency codes as whole words only", () => {
		expect(stripNumberUnits("12 EUR")).toBe("12");
		expect(stripNumberUnits("usd 12")).toBe("12");
		expect(stripNumberUnits("12 EURO")).toBe("12 EURO");
	});
});
