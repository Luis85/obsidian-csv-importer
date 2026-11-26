import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv } from "../../src/csv/parser";

const auto = { delimiter: "auto" as const, hasHeader: true };

describe("parseCsv", () => {
	it("parses a simple file", () => {
		const r = parseCsv("a,b,c\n1,2,3\n4,5,6\n", { delimiter: ",", hasHeader: true });
		expect(r.headers).toEqual(["a", "b", "c"]);
		expect(r.rows).toEqual([["1", "2", "3"], ["4", "5", "6"]]);
		expect(r.delimiter).toBe(",");
	});

	it("handles quoted fields with delimiters, newlines and escaped quotes", () => {
		const r = parseCsv('a,b\n"x, y","line1\nline2"\n"say ""hi""",z', { delimiter: ",", hasHeader: true });
		expect(r.rows).toEqual([["x, y", "line1\nline2"], ['say "hi"', "z"]]);
	});

	it("handles CRLF, LF and CR line endings", () => {
		for (const nl of ["\r\n", "\n", "\r"]) {
			const r = parseCsv(`a,b${nl}1,2${nl}3,4${nl}`, { delimiter: ",", hasHeader: true });
			expect(r.rows).toEqual([["1", "2"], ["3", "4"]]);
		}
	});

	it("turns CRLF inside quotes into LF, as the note gets it", () => {
		const r = parseCsv('a\r\n"x\r\ny"\r\n', { delimiter: ",", hasHeader: true });
		expect(r.rows).toEqual([["x\ny"]]);
	});

	it("strips a BOM", () => {
		const r = parseCsv("﻿a,b\n1,2", { delimiter: ",", hasHeader: true });
		expect(r.headers).toEqual(["a", "b"]);
	});

	it("skips trailing empty lines", () => {
		const r = parseCsv("a,b\n1,2\n\n\n", { delimiter: ",", hasHeader: true });
		expect(r.rows).toEqual([["1", "2"]]);
	});

	it("skips rows that only contain blank cells and warns", () => {
		const r = parseCsv("a,b\n,\n 1,2\n  , \n", { delimiter: ",", hasHeader: true });
		expect(r.rows).toEqual([[" 1", "2"]]);
		expect(r.warnings).toEqual(["2 blank rows were skipped."]);
	});

	it("pads short and truncates long rows", () => {
		const r = parseCsv("a,b,c\n1\n1,2,3,4,5\n", { delimiter: ",", hasHeader: true });
		expect(r.rows).toEqual([["1", "", ""], ["1", "2", "3"]]);
	});

	it("makes headers unique and non-empty", () => {
		const r = parseCsv(" a ,a,,a\n1,2,3,4", { delimiter: ",", hasHeader: true });
		expect(r.headers).toEqual(["a", "a 2", "Column 3", "a 3"]);
	});

	it("generates headers when hasHeader is false", () => {
		const r = parseCsv("1,2,3\n4,5\n", { delimiter: ",", hasHeader: false });
		expect(r.headers).toEqual(["Column 1", "Column 2", "Column 3"]);
		expect(r.rows).toEqual([["1", "2", "3"], ["4", "5", ""]]);
	});

	it("handles empty input", () => {
		const r = parseCsv("", auto);
		expect(r.headers).toEqual([]);
		expect(r.rows).toEqual([]);
		expect(r.delimiter).toBe(",");
	});

	it("handles header only", () => {
		const r = parseCsv("a,b", auto);
		expect(r.headers).toEqual(["a", "b"]);
		expect(r.rows).toEqual([]);
	});

	it("handles a trailing delimiter at EOF", () => {
		const r = parseCsv("a,b\n1,", auto);
		expect(r.rows).toEqual([["1", ""]]);
	});

	it("auto-detects semicolons and keeps decimal commas", () => {
		const r = parseCsv("Datum;Stunden\n2026-11-18;0,625\n", auto);
		expect(r.delimiter).toBe(";");
		expect(r.rows).toEqual([["2026-11-18", "0,625"]]);
	});

	it("honors an explicit tab delimiter", () => {
		const r = parseCsv("a\tb\n1\t2", { delimiter: "\t", hasHeader: true });
		expect(r.rows).toEqual([["1", "2"]]);
	});
});

describe("detectDelimiter", () => {
	it("detects each candidate", () => {
		expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
		expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
		expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
		expect(detectDelimiter("a|b|c\n1|2|3")).toBe("|");
	});

	it("defaults to comma", () => {
		expect(detectDelimiter("")).toBe(",");
		expect(detectDelimiter("single column\nvalue")).toBe(",");
	});

	it("is quote aware", () => {
		expect(detectDelimiter('a;b\n"x,y,z,w";2\n"1,2,3";4')).toBe(";");
	});

	it("prefers consistency over raw counts (decimal commas)", () => {
		const text = "Datum;Rolle;Beschreibung;Stunden;Tage\n2026-11-18;Dev;Arbeit;0,625;5\n2026-11-19;Dev;Mehr;1,5;3\n";
		expect(detectDelimiter(text)).toBe(";");
	});

	it("works with a BOM", () => {
		expect(detectDelimiter("﻿a;b\n1;2")).toBe(";");
	});
});

describe("parser warnings (S6)", () => {
	const opts = { delimiter: ",", hasHeader: true } as const;
	it("returns an empty warnings array when all is well", () => {
		expect(parseCsv("a,b\n1,2", opts).warnings).toEqual([]);
		expect(parseCsv("", opts).warnings).toEqual([]);
	});
	it("warns about an unterminated quote with the data row number", () => {
		const r = parseCsv('a,b\n1,2\n3,"oops\n4,5\n', opts);
		expect(r.warnings).toEqual(["Unterminated quote starting in row 2. The rest of the file was read as one value."]);
		expect(r.rows).toHaveLength(2);
	});
	it("numbers rows from 1 without a header", () => {
		const r = parseCsv('"abc\n', { delimiter: ",", hasHeader: false });
		expect(r.warnings[0]).toContain("row 1.");
	});
	it("aggregates rows longer than the header", () => {
		const r = parseCsv("a,b\n1,2,3\n4,5\n6,7,8,9", opts);
		expect(r.warnings).toEqual(["2 rows have more values than the header; extra values were ignored."]);
		expect(r.rows).toEqual([["1", "2"], ["4", "5"], ["6", "7"]]);
	});
});
