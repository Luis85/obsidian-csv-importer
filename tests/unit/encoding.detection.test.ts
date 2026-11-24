// Encoding detection edge cases (complements encoding.test.ts): BOMs on text the heuristic cannot detect,
// heuristic thresholds, explicit encodings and BOM stripping.
import { describe, expect, it } from "vitest";
import { decodeCsv, stripBom } from "../../src/csv/encoding";

const buf = (b: number[]) => new Uint8Array(b).buffer;
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** UTF-16 code units of `s` as bytes. CJK text has no zero bytes, so only a BOM tells it is UTF-16. */
function utf16(s: string, le: boolean): number[] {
	const out: number[] = [];
	for (const ch of s) {
		const c = ch.charCodeAt(0);
		out.push(...(le ? [c & 0xff, c >> 8] : [c >> 8, c & 0xff]));
	}
	return out;
}

/** `pairs` byte pairs of ASCII letters with zero bytes at the given even and odd positions. */
function withZeros(pairs: number, evenZeros: number, oddZeros: number): number[] {
	const out = Array.from({ length: pairs * 2 }, () => 0x61);
	for (let i = 0; i < evenZeros; i++) out[i * 2] = 0;
	for (let i = 0; i < oddZeros; i++) out[pairs * 2 - 1 - i * 2] = 0;
	return out;
}

describe("decodeCsv: byte order marks", () => {
	it("a UTF-16 BOM decides the encoding even when the text has no zero bytes", () => {
		expect(decodeCsv(buf([0xff, 0xfe, ...utf16("日本;東京", true)]), "auto")).toEqual({ text: "日本;東京", encoding: "utf-16le" });
		expect(decodeCsv(buf([0xfe, 0xff, ...utf16("日本;東京", false)]), "auto")).toEqual({ text: "日本;東京", encoding: "utf-16be" });
	});

	it("a file that is only a UTF-16 BOM is empty UTF-16", () => {
		expect(decodeCsv(buf([0xff, 0xfe]), "auto")).toEqual({ text: "", encoding: "utf-16le" });
		expect(decodeCsv(buf([0xfe, 0xff]), "auto")).toEqual({ text: "", encoding: "utf-16be" });
	});

	it("a UTF-8 BOM keeps UTF-8 even when later bytes are invalid", () => {
		const r = decodeCsv(buf([0xef, 0xbb, 0xbf, 0x61, 0xe9, 0x62]), "auto");
		expect(r.encoding).toBe("utf-8");
		expect(r.text).toBe("a�b");
	});

	it("bytes that only start like a BOM are not one", () => {
		expect(decodeCsv(buf([0xef, 0xbb, 0x61, 0x62]), "auto").encoding).toBe("windows-1252");
		expect(decodeCsv(buf([0xef, 0x61, 0xbf, 0x62]), "auto").encoding).toBe("windows-1252");
		expect(decodeCsv(buf([0x61, 0xbb, 0xbf, 0x62]), "auto").encoding).toBe("windows-1252");
		expect(decodeCsv(buf([0xff, 0x61, 0x62, 0x63]), "auto").encoding).toBe("windows-1252");
		expect(decodeCsv(buf([0x61, 0xfe, 0x62, 0x63]), "auto").encoding).toBe("windows-1252");
		expect(decodeCsv(buf([0xfe, 0x61, 0x62, 0x63]), "auto").encoding).toBe("windows-1252");
		expect(decodeCsv(buf([0x61, 0xff, 0x62, 0x63]), "auto").encoding).toBe("windows-1252");
	});

	it("decodes BOM-less UTF-8 text with non-ASCII characters as UTF-8", () => {
		expect(decodeCsv(buf([...new TextEncoder().encode("Müller;Größe")]), "auto")).toEqual({ text: "Müller;Größe", encoding: "utf-8" });
	});
});

describe("decodeCsv: explicit encoding", () => {
	it("is used as given, without sniffing", () => {
		const utf8 = [...new TextEncoder().encode("é")];
		expect(decodeCsv(buf(utf8), "windows-1252")).toEqual({ text: "Ã©", encoding: "windows-1252" });
		expect(decodeCsv(buf(ascii("a\0b\0")), "utf-8")).toEqual({ text: "a\0b\0", encoding: "utf-8" });
	});
});

describe("decodeCsv: UTF-16 heuristic", () => {
	it("needs at least 4 bytes", () => {
		expect(decodeCsv(buf(ascii("a\0")), "auto")).toEqual({ text: "a\0", encoding: "utf-8" });
		expect(decodeCsv(buf(ascii("a\0b\0")), "auto")).toEqual({ text: "ab", encoding: "utf-16le" });
		expect(decodeCsv(buf(ascii("\0a\0b")), "auto")).toEqual({ text: "ab", encoding: "utf-16be" });
	});

	it("little endian: zeros in more than 30 % of odd bytes and fewer than 5 % of even bytes", () => {
		expect(decodeCsv(buf(withZeros(10, 0, 3)), "auto").encoding).toBe("utf-8");
		expect(decodeCsv(buf(withZeros(10, 0, 4)), "auto").encoding).toBe("utf-16le");
		expect(decodeCsv(buf(withZeros(20, 1, 15)), "auto").encoding).toBe("utf-8");
		expect(decodeCsv(buf(withZeros(40, 1, 15)), "auto").encoding).toBe("utf-16le");
	});

	it("big endian: zeros in more than 30 % of even bytes and fewer than 5 % of odd bytes", () => {
		expect(decodeCsv(buf(withZeros(10, 3, 0)), "auto").encoding).toBe("utf-8");
		expect(decodeCsv(buf(withZeros(10, 4, 0)), "auto").encoding).toBe("utf-16be");
		expect(decodeCsv(buf(withZeros(20, 15, 1)), "auto").encoding).toBe("utf-8");
		expect(decodeCsv(buf(withZeros(40, 15, 1)), "auto").encoding).toBe("utf-16be");
	});
});

describe("stripBom", () => {
	it("removes one leading BOM by default, all of them with `all`", () => {
		expect(stripBom("﻿﻿a")).toBe("﻿a");
		expect(stripBom("﻿﻿a", true)).toBe("a");
		expect(stripBom("a﻿")).toBe("a﻿");
		expect(stripBom("")).toBe("");
	});
});
