import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/csv/parser";
import { planNotes } from "../../src/import/noteBuilder";
import { cfg } from "./helpers/harness";

describe("row numbers with skipped blank rows", () => {
	it("keeps original numbering for {{row}} and note.row", () => {
		const parsed = parseCsv("name,val\nA,1\n,\nB,2\n", { delimiter: ",", hasHeader: true });
		expect(parsed.rows).toHaveLength(2);
		expect(parsed.rowNumbers).toEqual([1, 3]);
		const notes = planNotes(parsed, cfg(), { path: "data.csv", basename: "data" });
		expect(notes.map((n) => n.path)).toEqual(["data/data 1.md", "data/data 3.md"]);
		expect(notes.map((n) => n.row)).toEqual([1, 3]);
	});

	it("numbers rows 1..n when nothing is skipped", () => {
		const parsed = parseCsv("a\n1\n2\n3", { delimiter: ",", hasHeader: true });
		expect(parsed.rowNumbers).toEqual([1, 2, 3]);
	});

	it("without a header, rows are numbered from 1", () => {
		const parsed = parseCsv("x,y\n,\nz,w", { delimiter: ",", hasHeader: false });
		expect(parsed.rowNumbers).toEqual([1, 3]);
	});

	it("unterminated quote warning uses original numbering", () => {
		const parsed = parseCsv('a,b\n1,2\n,\n3,"oops\nrest', { delimiter: ",", hasHeader: true });
		expect(parsed.warnings.some((w) => w.includes("row 3"))).toBe(true);
	});
});
