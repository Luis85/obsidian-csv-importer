// CSV parsing edge cases (complements parser.test.ts): empty trailing fields, quoted blank rows,
// delimiter detection ties and warning texts.
import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv } from "../../src/csv/parser";

const opts = { delimiter: "," as const, hasHeader: true };

describe("parseCsv records", () => {
	it("a row ending in an empty field still ends at the line break", () => {
		expect(parseCsv("x,y\na,\nb,c", opts).rows).toEqual([
			["a", ""],
			["b", "c"],
		]);
	});

	it('a line holding only "" is a blank row: skipped, but it keeps its row number', () => {
		const p = parseCsv('a\n""\nb', opts);
		expect(p.rows).toEqual([["b"]]);
		expect(p.rowNumbers).toEqual([2]);
		expect(p.warnings).toEqual(["1 blank row was skipped."]);
	});
});

describe("parseCsv warnings", () => {
	it("counts rows that are longer than the header", () => {
		expect(parseCsv("a\n1,2\n", opts).warnings).toEqual(["1 row has more values than the header; extra values were ignored."]);
		expect(parseCsv("a\n1,2\n3,4\n", opts).warnings).toEqual(["2 rows have more values than the header; extra values were ignored."]);
	});

	it("names the data row of an unterminated quote, with and without a header row", () => {
		expect(parseCsv('a\nx\n"open', opts).warnings[0]).toBe("Unterminated quote starting in row 2. The rest of the file was read as one value.");
		expect(parseCsv('x\n"open', { ...opts, hasHeader: false }).warnings[0]).toBe(
			"Unterminated quote starting in row 2. The rest of the file was read as one value.",
		);
	});
});

describe("detectDelimiter ties", () => {
	it("equally consistent delimiters: the one giving more columns wins", () => {
		expect(detectDelimiter("a;b|c|d\ne;f|g|h")).toBe("|");
		expect(detectDelimiter("a,b;c\nd;e;f")).toBe(";");
	});

	it("a full tie keeps the earlier candidate", () => {
		expect(detectDelimiter("a;b|c\nd;e|f")).toBe(";");
	});
});

describe("spaces before an opening quote", () => {
	it("still open a quoted field, so a delimiter inside the quotes does not split it", () => {
		const r = parseCsv('a,b,c\n1, "x, y", z\n', { delimiter: ",", hasHeader: true });
		expect(r.rows).toEqual([["1", "x, y", " z"]]);
	});

	it("a quote after other text stays literal", () => {
		const r = parseCsv('a,b\n1,x "y"\n', { delimiter: ",", hasHeader: true });
		expect(r.rows).toEqual([["1", 'x "y"']]);
	});
});
