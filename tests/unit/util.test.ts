import { afterEach, describe, expect, it, vi } from "vitest";
import { errorMessage, parentOf, plural, uuidV4 } from "../../src/core/util";

describe("errorMessage", () => {
	it("uses the message of errors and stringifies anything else", () => {
		expect(errorMessage(new Error("disk full"))).toBe("disk full");
		expect(errorMessage("plain")).toBe("plain");
		expect(errorMessage(42)).toBe("42");
		expect(errorMessage(undefined)).toBe("undefined");
	});
});

describe("parentOf", () => {
	it("returns the folder part of a path, '' at the vault root", () => {
		expect(parentOf("a/b/c.md")).toBe("a/b");
		expect(parentOf("a/c.md")).toBe("a");
		expect(parentOf("c.md")).toBe("");
		expect(parentOf("")).toBe("");
	});
});

describe("plural", () => {
	it("picks the singular only for exactly one", () => {
		expect(plural(1, "note", "notes")).toBe("1 note");
		expect(plural(0, "note", "notes")).toBe("0 notes");
		expect(plural(2, "note", "notes")).toBe("2 notes");
	});
});

describe("uuidV4", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses crypto.randomUUID when available", () => {
		vi.stubGlobal("crypto", { randomUUID: () => "from-random-uuid", getRandomValues: () => undefined });
		expect(uuidV4()).toBe("from-random-uuid");
	});

	it("falls back to getRandomValues and sets the version and variant bits", () => {
		const fill = (value: number) => ({ getRandomValues: (b: Uint8Array) => b.fill(value) });
		vi.stubGlobal("crypto", fill(0xff));
		expect(uuidV4()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
		vi.stubGlobal("crypto", fill(0x00));
		expect(uuidV4()).toBe("00000000-0000-4000-8000-000000000000");
	});

	it("formats the 16 random bytes in order as 8-4-4-4-12 hex digits", () => {
		vi.stubGlobal("crypto", { getRandomValues: (b: Uint8Array) => b.forEach((_, i) => (b[i] = i)) });
		expect(uuidV4()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
	});
});
