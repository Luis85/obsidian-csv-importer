// File names and target folders: UTF-8 length limit, trimming, folders outside the vault, per-row folders.
import { describe, expect, it } from "vitest";
import { formatValue, resolveRowFolder, resolveTargetFolder, sanitizeFileName } from "../../src/import/noteBuilder";
import { cfg } from "./helpers/harness";

describe("sanitizeFileName: 240-byte limit", () => {
	const fits = (bytes: number) => Math.floor(240 / bytes);

	it("counts 2-byte, 3-byte and 4-byte characters", () => {
		expect([...sanitizeFileName("\u0080".repeat(121))]).toHaveLength(fits(2));
		expect([...sanitizeFileName("\u07ff".repeat(121))]).toHaveLength(fits(2));
		expect([...sanitizeFileName("\u0800".repeat(81))]).toHaveLength(fits(3));
		expect([...sanitizeFileName("\uffff".repeat(81))]).toHaveLength(fits(3));
		expect([...sanitizeFileName("\u{10000}".repeat(61))]).toHaveLength(fits(4));
	});

	it("keeps 1-byte characters up to 240 and never splits a surrogate pair", () => {
		expect(sanitizeFileName("a".repeat(239) + "😀")).toBe("a".repeat(239));
		expect(sanitizeFileName("a".repeat(236) + "😀")).toBe("a".repeat(236) + "😀");
	});

	it("trims all leading and trailing dots and spaces", () => {
		expect(sanitizeFileName("..a..")).toBe("a");
		expect(sanitizeFileName(" . a . ")).toBe("a");
	});
});

describe("resolveTargetFolder", () => {
	it("a blank target folder means the default folder next to the CSV", () => {
		expect(resolveTargetFolder(cfg({ targetFolder: "   " }), "Data/hours.csv")).toBe("Data/hours");
	});

	it("the default folder keeps names without or with only a leading dot", () => {
		expect(resolveTargetFolder(cfg(), "Data/README")).toBe("Data/README");
		expect(resolveTargetFolder(cfg(), "Data/.csv")).toBe("Data/.csv");
		expect(resolveTargetFolder(cfg(), "")).toBe("");
	});

	it("rejects drive letters and '..', also with surrounding spaces", () => {
		expect(() => resolveTargetFolder(cfg({ targetFolder: "  C:/x " }), "a.csv")).toThrow("The target folder must be inside the vault: C:/x");
		expect(() => resolveTargetFolder(cfg({ targetFolder: "a/../b" }), "a.csv")).toThrow("must be inside the vault");
		expect(resolveTargetFolder(cfg({ targetFolder: "Notes/a:b" }), "a.csv")).toBe("Notes/a:b");
	});
});

describe("resolveRowFolder", () => {
	const ctx = { headers: ["Team"], row: ["Ops#1"], rowNumber: 1, fileBasename: "f" };

	it("sanitizes rendered segments and leaves literal ones as written", () => {
		expect(resolveRowFolder(cfg({ targetFolder: "My#Notes/{{Team}}" }), "d/f.csv", ctx)).toBe("My#Notes/Ops1");
	});

	it("a blank target folder means the default folder", () => {
		expect(resolveRowFolder(cfg({ targetFolder: "  " }), "d/f.csv", ctx)).toBe("d/f");
	});
});

describe("formatValue", () => {
	it("formats values as templates show them", () => {
		expect(formatValue(null)).toBe("");
		expect(formatValue(1e21)).toBe("1000000000000000000000");
		expect(formatValue(1e-7)).toBe("0.0000001");
		expect(formatValue(["a", "b"])).toBe("a, b");
		expect(formatValue(true)).toBe("true");
		expect(formatValue("x")).toBe("x");
	});
});
