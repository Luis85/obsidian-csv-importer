import { describe, expect, it } from "vitest";
import { buildBaseFile } from "../../src/import/baseFile";

describe("buildBaseFile", () => {
	it("builds a table view filtered by folder", () => {
		expect(buildBaseFile("Data/hours", ["Name", "Rate (€)"], "Hours")).toBe(
			[
				"filters:",
				"  and:",
				'    - "file.inFolder(\\"Data/hours\\")"',
				"views:",
				"  - type: table",
				'    name: "Hours"',
				"    order:",
				'      - "file.name"',
				'      - "Name"',
				'      - "Rate (€)"',
				"",
			].join("\n"),
		);
	});
	it("quotes risky names and omits filter for vault root", () => {
		const t = buildBaseFile("/", ["a: b", ""], 'V"w');
		expect(t).not.toContain("filters");
		expect(t).toContain('name: "V\\"w"');
		expect(t).toContain('- "a: b"');
	});
});
