import { describe, expect, it } from "vitest";
import { decodeCsv } from "../../src/csv/encoding";

const buf = (b: number[]) => new Uint8Array(b).buffer;
const cp1252 = [0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x3b, 0x47, 0x72, 0xf6, 0xdf, 0x65];
function utf16(s: string, le: boolean, bom: boolean): number[] {
	const out: number[] = bom ? (le ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
	for (const ch of s) {
		const c = ch.charCodeAt(0);
		out.push(...(le ? [c & 0xff, c >> 8] : [c >> 8, c & 0xff]));
	}
	return out;
}

describe("decodeCsv", () => {
	it("decodes utf-8 and strips BOM", () => {
		const bytes = [0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Müller;Größe")];
		expect(decodeCsv(buf(bytes), "auto")).toEqual({ text: "Müller;Größe", encoding: "utf-8" });
	});
	it("falls back to windows-1252 in auto mode", () => {
		expect(decodeCsv(buf(cp1252), "auto")).toEqual({ text: "Müller;Größe", encoding: "windows-1252" });
	});
	it("explicit windows-1252", () => {
		expect(decodeCsv(buf(cp1252), "windows-1252").text).toBe("Müller;Größe");
	});
	it("UTF-16LE with BOM", () => {
		const r = decodeCsv(buf(utf16("Müller;Größe", true, true)), "auto");
		expect(r).toEqual({ text: "Müller;Größe", encoding: "utf-16le" });
	});
	it("UTF-16BE with BOM", () => {
		expect(decodeCsv(buf(utf16("Müller;Größe", false, true)), "auto").text).toBe("Müller;Größe");
	});
	it("UTF-16 without BOM via heuristic", () => {
		expect(decodeCsv(buf(utf16("name;age\nAnn;5\n", true, false)), "auto")).toEqual({ text: "name;age\nAnn;5\n", encoding: "utf-16le" });
		expect(decodeCsv(buf(utf16("name;age\nAnn;5\n", false, false)), "auto").encoding).toBe("utf-16be");
	});
	it("explicit utf-8 strips BOM", () => {
		expect(decodeCsv(buf([0xef, 0xbb, 0xbf, 0x61]), "utf-8").text).toBe("a");
	});
	it("empty input", () => {
		expect(decodeCsv(buf([]), "auto").text).toBe("");
	});
});
