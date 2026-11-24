// YAML frontmatter serialization: which strings and keys get quoted, so YAML reads back exactly the value written.
import { describe, expect, it } from "vitest";
import { serializeNote } from "../../src/import/yaml";
import type { FrontmatterValue, PropertyType } from "../../src/types";

/** The serialized `v: …` line of a single text value. */
function line(value: FrontmatterValue, type?: PropertyType): string {
	const out = serializeNote({ v: value }, "", type ? { v: type } : undefined);
	return out.slice("---\n".length, -"\n---\n".length);
}

const plain = (s: string) => `v: ${s}`;
const quoted = (s: string) => `v: ${JSON.stringify(s)}`;

function expectPlain(values: string[], type?: PropertyType) {
	for (const s of values) expect(line(s, type), s).toBe(plain(s));
}
function expectQuoted(values: string[], type?: PropertyType) {
	for (const s of values) expect(line(s, type), s).toBe(quoted(s));
}

describe("serializeNote: plain strings", () => {
	it("leaves ordinary text unquoted", () => {
		expectPlain(["abc", "Hello world", "a:b", "a#b", "C# rocks", "x - y", "123a", "a123", "1.5.6", "Größe"]);
	});
});

describe("serializeNote: strings YAML would read as numbers", () => {
	it("quotes decimal, signed, underscore and exponent numbers", () => {
		expectQuoted(["123", "-1", "+1", "1.5", "1.25", ".5", ".55", "1.", "1_000", "1e5", "1E5", "1e-5", "1e+5", "1e10", "-1.5e3"]);
	});

	it("does not quote numbers embedded in text", () => {
		expectPlain(["a123", "123a", "1e", "1ex", "1.5x", "e5"]);
	});

	it("quotes hex, octal and binary literals, only as whole values", () => {
		expectQuoted(["0x1F", "0X1f", "0o17", "0b101", "0x1_F"]);
		expectPlain(["10x1F", "0x1G", "0o8", "0b2", "x0b1"]);
	});

	it("quotes infinity and not-a-number spellings", () => {
		expectQuoted([".inf", ".NaN", "-.inf", "+.Inf"]);
		expectPlain(["a.inf", ".info", "inf", "x-.nan"]);
	});

	it("quotes base-60 numbers (times)", () => {
		expectQuoted(["1:30", "12:30", "1:5", "-1:30", "+1:30", "1:30:00", "1:30.", "1:30.5", "1:30.25"]);
		expectPlain(["a1:30", "1:30x", "1:61", "1:30.5x"]);
	});
});

describe("serializeNote: strings YAML would read as other types", () => {
	it("quotes booleans, null and special tokens", () => {
		expectQuoted(["true", "False", "yes", "No", "on", "OFF", "y", "N", "null", "~", "<<", "="]);
		expectPlain(["yesterday", "ayes", "nully", "true story"]);
	});

	it("quotes date-like text for non-date properties", () => {
		expectQuoted(["2026-01-02", "2026-1-2", "2026-01-02 10:00", "2026-01-02T10:00", "2026-01-02t10:00", "2026-01-02\t10:00"]);
		expectPlain(["x2026-01-02", "26-01-02", "2026-01-02x", "2026-001-02", "2026-01-002"]);
	});

	it("list items are never treated as dates", () => {
		const out = serializeNote({ l: ["2026-01-02", "a"] }, "", { l: "date" });
		expect(out).toBe('---\nl:\n  - "2026-01-02"\n  - a\n---\n');
	});
});

describe("serializeNote: date and datetime properties", () => {
	it("keeps ISO dates and datetimes plain", () => {
		expectPlain(["2026-01-02"], "date");
		expectPlain(["2026-01-02T10:00", "2026-01-02T10:00:00"], "datetime");
	});

	it("still quotes values that are not exact ISO dates", () => {
		expectQuoted(["2026-1-2", "2026-01-02 10:00", "2026-01-02T10:00Z", "2026-01-02T1:00", "2026-01-02T10:0", "2026-01-02T10:00:0"], "datetime");
		expectQuoted(["2026-1-02", "2026-01-2", "2026-01-02 x", "not a date: x"], "date");
	});
});

describe("serializeNote: YAML syntax characters", () => {
	it("quotes empty strings and surrounding whitespace", () => {
		expectQuoted(["", " a", "a ", "\ta"]);
	});

	it("quotes leading indicator characters", () => {
		expectQuoted(["-a", "?a", ":a", ",a", "[a", "]a", "{a", "}a", "#a", "&a", "*a", "!a", "|a", ">a", "'a", '"a', "%a", "@a", "`a"]);
	});

	it("quotes a colon-space, a space-hash and a trailing colon", () => {
		expectQuoted(["a: b", "a #b", "Note:"]);
	});

	it("quotes and escapes control and invisible separator characters", () => {
		expect(line("a\u0001b")).toBe('v: "a\\u0001b"');
		expect(line("a\u0085b")).toBe('v: "a\\u0085b"');
		expect(line("a\u007fb")).toBe('v: "a\\u007fb"');
		expect(line("a b")).toBe('v: "a\\u2028b"');
		expect(line("a b")).toBe('v: "a\\u2029b"');
		expect(line("﻿a")).toBe('v: "\\ufeffa"');
	});

	it("normalizes CR and CRLF line breaks inside values to LF", () => {
		expect(line("a\rb")).toBe('v: "a\\nb"');
		expect(line("a\r\nb")).toBe('v: "a\\nb"');
		expect(line("a\nb")).toBe('v: "a\\nb"');
	});
});

describe("serializeNote: keys", () => {
	const key = (k: string) => serializeNote({ [k]: 1 }, "").slice("---\n".length, -": 1\n---\n".length);

	it("leaves names made of letters, digits, spaces and . ( ) / & + - _ plain", () => {
		for (const k of ["name", "_x", "a1", "Größe", "ab c", "a b.c(d)/e&f+g-h_i", "yesterday", "ayes"]) expect(key(k), k).toBe(k);
	});

	it("quotes keys YAML would misread", () => {
		for (const k of ["1abc", "a#", "a:b", "a ", " a", "true", "Yes", "n", "null", "-a"]) expect(key(k), k).toBe(JSON.stringify(k));
	});
});

describe("serializeNote: non-string values", () => {
	it("writes undefined and non-finite numbers as empty values", () => {
		expect(serializeNote({ a: undefined as unknown as FrontmatterValue, b: Number.NaN, c: Number.POSITIVE_INFINITY }, "")).toBe(
			"---\na:\nb:\nc:\n---\n",
		);
	});
});
