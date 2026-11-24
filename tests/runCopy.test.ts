import { describe, expect, it } from "vitest";
import { KEY_WARNING, ROW_FILTER_WARNING } from "../src/import/importer";
import { driftMessage } from "../src/view/labels";
import { calloutTitle, runHeadline, thingsToCheck, warningTitle } from "../src/view/runCopy";

describe("callout titles", () => {
	it("names the one problem", () => {
		expect(calloutTitle([driftMessage(["Tage"], [])])).toBe("Columns changed");
		expect(calloutTitle([KEY_WARNING])).toBe("Notes are matched by file name");
		expect(calloutTitle(["Unterminated quote starting in row 7. The rest of the file was read as one value."])).toBe("Unclosed quote in the file");
		expect(warningTitle(ROW_FILTER_WARNING(4, 6))).toBe("Row filter is on");
	});

	it("uses a neutral count title when problems of different kinds are merged", () => {
		expect(calloutTitle([driftMessage(["Tage"], ["Kostenstelle"]), "1 blank row was skipped."])).toBe("2 things to check");
		expect(thingsToCheck(1)).toBe("1 thing to check");
	});

	it("falls back to a generic title for unknown wording", () => {
		expect(calloutTitle(["Something new."])).toBe("Check before importing");
	});
});

describe("run headline", () => {
	it("says what will be written and where, and how many rows need attention", () => {
		expect(runHeadline("preview", 4, 3, "Data/timesheet")).toBe("4 notes will be written to Data/timesheet/. 3 rows need attention.");
		expect(runHeadline("preview", 1, 0, "Data/timesheet/")).toBe("1 note will be written to Data/timesheet/.");
		expect(runHeadline("preview", 0, 1, "")).toBe("No notes will be written. 1 row needs attention.");
	});

	it("uses the past tense when done or stopped", () => {
		expect(runHeadline("done", 4, 0, "Data/timesheet")).toBe("4 notes written to Data/timesheet/.");
		expect(runHeadline("stopped", 2, 0, "")).toBe("2 notes written before the import was stopped.");
		expect(runHeadline("done", 0, 0, "x")).toBe("No notes were written.");
	});
});
