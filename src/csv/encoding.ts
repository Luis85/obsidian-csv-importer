import type { CsvEncoding } from "../types";

type Concrete = Exclude<CsvEncoding, "auto">;

function utf16Heuristic(u: Uint8Array): "utf-16le" | "utf-16be" | null {
	const n = Math.min(u.length, 4096);
	if (n < 4) return null;
	let even = 0;
	let odd = 0;
	for (let i = 0; i < n; i++) {
		if (u[i] === 0) {
			if (i % 2 === 0) even++;
			else odd++;
		}
	}
	const pairs = Math.floor(n / 2);
	if (odd > pairs * 0.3 && even < pairs * 0.05) return "utf-16le";
	if (even > pairs * 0.3 && odd < pairs * 0.05) return "utf-16be";
	return null;
}

function stripBom(s: string): string {
	return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Decode raw CSV bytes. "auto": UTF-8 / UTF-16LE / UTF-16BE BOM sniffing; without BOM try strict UTF-8,
 * fall back to Windows-1252 when the bytes are not valid UTF-8 (typical Excel "CSV (ANSI)" export).
 * A BOM is never part of the returned text. Returns the encoding actually used.
 */
export function decodeCsv(bytes: ArrayBuffer, encoding: CsvEncoding): { text: string; encoding: Concrete } {
	const u = new Uint8Array(bytes);
	let enc: Concrete;
	if (encoding !== "auto") enc = encoding;
	else if (u.length >= 3 && u[0] === 0xef && u[1] === 0xbb && u[2] === 0xbf) enc = "utf-8";
	else if (u.length >= 2 && u[0] === 0xff && u[1] === 0xfe) enc = "utf-16le";
	else if (u.length >= 2 && u[0] === 0xfe && u[1] === 0xff) enc = "utf-16be";
	else {
		const h = utf16Heuristic(u);
		if (h) enc = h;
		else {
			try {
				return { text: stripBom(new TextDecoder("utf-8", { fatal: true }).decode(u)), encoding: "utf-8" };
			} catch {
				enc = "windows-1252";
			}
		}
	}
	return { text: stripBom(new TextDecoder(enc).decode(u)), encoding: enc };
}
