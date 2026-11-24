// Which existing notes an import may change, and when a note at the planned path belongs to another record.
import { describe, expect, it } from "vitest";
import { hasOtherKey, isOwned, normalizeLink } from "../../src/import/ownership";
import type { OwnershipInput } from "../../src/import/ownership";

describe("normalizeLink", () => {
	it("returns null for non-strings", () => {
		expect(normalizeLink(undefined)).toBeNull();
		expect(normalizeLink(42)).toBeNull();
		expect(normalizeLink(["[[x.csv]]"])).toBeNull();
	});

	it("strips wikilink brackets, alias, heading, the .csv extension and case", () => {
		expect(normalizeLink("[[Data/People.csv]]")).toBe("data/people");
		expect(normalizeLink("  [[Data/People.csv]]  ")).toBe("data/people");
		expect(normalizeLink("[[Data/People.csv|the people]]")).toBe("data/people");
		expect(normalizeLink("[[Data/People.csv | the people]]")).toBe("data/people");
		expect(normalizeLink("[[Data/People.csv#Heading]]")).toBe("data/people");
		expect(normalizeLink("Data/People")).toBe("data/people");
	});

	it("only strips brackets that open and close the link", () => {
		expect(normalizeLink("[[x.csv")).toBe("[[x");
		expect(normalizeLink("x.csv]]")).toBe("x.csv]]");
	});

	it("an alias or heading at the start leaves an empty (root) link", () => {
		expect(normalizeLink("[[|alias]]")).toBe("/");
		expect(normalizeLink("#heading")).toBe("/");
		expect(normalizeLink("/")).toBe("/");
	});

	it("normalizes slashes like Obsidian's normalizePath", () => {
		expect(normalizeLink("Data//sub///x.csv")).toBe("data/sub/x");
		expect(normalizeLink("Data\\sub\\x.csv")).toBe("data/sub/x");
		expect(normalizeLink("/Data/x.csv/")).toBe("data/x");
		expect(normalizeLink("//Data/x.csv")).toBe("data/x");
	});

	it("treats non-breaking spaces as spaces and compares in NFC", () => {
		expect(normalizeLink("Data/my file.csv")).toBe("data/my file");
		expect(normalizeLink("Data/my file.csv")).toBe("data/my file");
		expect(normalizeLink("Data/Café.csv")).toBe(normalizeLink("Data/Café.csv"));
	});
});

describe("isOwned", () => {
	const base: OwnershipInput = {
		hasSnapshotEntry: false,
		frontmatter: {},
		plannedLink: "[[Data/x.csv]]",
		ownedLinkProps: ["source_csv", "source"],
		adopt: false,
	};

	it("adopted notes and notes in the snapshot are owned", () => {
		expect(isOwned({ ...base, adopt: true })).toBe(true);
		expect(isOwned({ ...base, hasSnapshotEntry: true })).toBe(true);
		expect(isOwned({ ...base, hasSnapshotEntry: true, plannedLink: undefined, frontmatter: undefined })).toBe(true);
	});

	it("a note linking to this CSV under any owned property is owned", () => {
		expect(isOwned({ ...base, frontmatter: { source: "[[data/X.csv|x]]" } })).toBe(true);
		expect(isOwned({ ...base, frontmatter: { source_csv: "Data/x" } })).toBe(true);
	});

	it("a note without a link, with a link elsewhere or under another property is not owned", () => {
		expect(isOwned(base)).toBe(false);
		expect(isOwned({ ...base, frontmatter: undefined })).toBe(false);
		expect(isOwned({ ...base, frontmatter: { source: "[[Data/y.csv]]" } })).toBe(false);
		expect(isOwned({ ...base, frontmatter: { link: "[[Data/x.csv]]" } })).toBe(false);
	});

	it("without a planned link nothing is owned by link, even a note without one", () => {
		expect(isOwned({ ...base, plannedLink: undefined })).toBe(false);
		expect(isOwned({ ...base, plannedLink: undefined, frontmatter: { source: "[[Data/x.csv]]" } })).toBe(false);
	});
});

describe("hasOtherKey", () => {
	const key = { property: "id", value: "1" };

	it("is false without a key, frontmatter or key value", () => {
		expect(hasOtherKey({ id: "2" }, null)).toBe(false);
		expect(hasOtherKey(undefined, key)).toBe(false);
		expect(hasOtherKey({}, key)).toBe(false);
		expect(hasOtherKey({ id: null }, key)).toBe(false);
		expect(hasOtherKey({ id: "" }, key)).toBe(false);
		expect(hasOtherKey({ id: "   " }, key)).toBe(false);
	});

	it("ignores list and object values", () => {
		expect(hasOtherKey({ id: ["2"] }, key)).toBe(false);
		expect(hasOtherKey({ id: { a: 2 } }, key)).toBe(false);
	});

	it("compares the formatted scalar value with the planned key", () => {
		expect(hasOtherKey({ id: 1 }, key)).toBe(false);
		expect(hasOtherKey({ id: "1" }, key)).toBe(false);
		expect(hasOtherKey({ id: 2 }, key)).toBe(true);
		expect(hasOtherKey({ id: "x" }, key)).toBe(true);
		expect(hasOtherKey({ id: true }, { property: "id", value: "true" })).toBe(false);
	});
});
