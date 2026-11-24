import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/csv/parser";
import { buildColumnConfigs } from "../../src/csv/typeInference";
import { keyColumnStatus, suggestShortKey } from "../../src/view/config/keys";

const setup = (text: string, delimiter: "," | ";" = ",", decimalSeparator: "." | "," = ".") => {
	const parsed = parseCsv(text, { delimiter, hasHeader: true });
	const columns = buildColumnConfigs(parsed, { decimalSeparator, midnightAsDate: true, listSeparator: "," });
	return { parsed, columns };
};

describe("import settings: key suggestion", () => {
	it("never suggests a free-text column (the timesheet's Beschreibung)", () => {
		const { parsed, columns } = setup(
			[
				"Datum;Rolle;Beschreibung;Stunden",
				"2026-11-18;Softwareentwickler;Architektur und Harness Vorbereitung Backend;0,625",
				"2026-11-19;Softwareentwickler;Code Review und Pairing;0,5",
				"2026-11-20;Projektleiter;Sprint Planning;0,25",
				"2026-11-21;Softwareentwickler;Fehleranalyse Importer;0,75",
				"2026-11-22;Tester;Regressionstests;0,375",
				"2026-11-23;Softwareentwickler;Dokumentation;0,125",
			].join("\n"),
			";",
			",",
		);
		expect(suggestShortKey(parsed, columns)).toBeNull();
	});

	it("never suggests a column whose average value is over 30 characters", () => {
		const long = (n: number) => `${"x".repeat(35)}${n}`;
		const { parsed, columns } = setup(["Ref,Name", `${long(1)},a b`, `${long(2)},c d`].join("\n"));
		expect(suggestShortKey(parsed, columns)).toBeNull();
	});

	it("suggests a short unique code column", () => {
		const { parsed, columns } = setup(["Title,ISBN", "Some book,978-1", "Other book,978-2"].join("\n"));
		expect(suggestShortKey(parsed, columns)).toBe("ISBN");
	});

	it("prefers a code-like column over a title that is sometimes one word", () => {
		const { parsed, columns } = setup(["Title,ISBN", "Kindred,978-1", "The Remains of the Day,978-2", "Piranesi,978-3", "Some book,978-4"].join("\n"));
		expect(suggestShortKey(parsed, columns)).toBe("ISBN");
	});

	it("keeps an ID-named column even when its values contain spaces", () => {
		const { parsed, columns } = setup(["Title,Order ID", "a b c,INV 2026 001", "d e f,INV 2026 002"].join("\n"));
		expect(suggestShortKey(parsed, columns)).toBe("Order ID");
	});

	it("reports unique, duplicate and empty columns", () => {
		const { parsed, columns } = setup(["A,B,C", "1,x,", "2,x,y"].join("\n"));
		const [a, b, c] = columns;
		if (!a || !b || !c) throw new Error("columns missing");
		expect(keyColumnStatus(parsed, a)).toBe("unique");
		expect(keyColumnStatus(parsed, b)).toBe("duplicates");
		expect(keyColumnStatus(parsed, c)).toBe("empty");
	});
});
