// Per-file config defaults and migration of stored (possibly old or hand-edited) configs.
import { describe, expect, it } from "vitest";
import { createDefaultFileConfig, DEFAULT_SETTINGS, migrateFileConfig } from "../../src/defaults";
import type { ColumnConfig, FileImportConfig } from "../../src/types";

const migrate = (raw: unknown) => migrateFileConfig(raw as Partial<FileImportConfig>, DEFAULT_SETTINGS);

describe("createDefaultFileConfig", () => {
	it("derives a fresh config from the global settings", () => {
		const settings = { ...DEFAULT_SETTINGS, defaultDelimiter: ";" as const, defaultTargetFolder: "Notes", defaultConflict: "skip" as const };
		expect(createDefaultFileConfig(settings)).toEqual({
			delimiter: ";",
			hasHeader: true,
			decimalSeparator: ".",
			targetFolder: "Notes",
			fileNameTemplate: "{{file}} {{row}}",
			bodyTemplate: "",
			conflict: "skip",
			tags: "",
			addSourceLink: true,
			listSeparator: ",",
			emptyValues: "empty",
			numberPrecision: null,
			keyColumn: "",
			encoding: "auto",
			protectEdits: true,
			keepValuesOnEmpty: true,
			createBase: true,
			adoptExistingNotes: false,
			keyColumns: [],
			keyProperty: "import_key",
			dateOrder: "auto",
			rowFilter: null,
			extraProperties: [],
			columns: [],
			lastImport: null,
		});
	});
});

describe("migrateFileConfig", () => {
	it("treats a missing or non-object config as empty", () => {
		const fresh = createDefaultFileConfig(DEFAULT_SETTINGS);
		expect(migrate(null)).toEqual(fresh);
		expect(migrate(undefined)).toEqual(fresh);
		expect(migrate("oops")).toEqual(fresh);
		expect(migrate(7)).toEqual(fresh);
	});

	it("does not change the stored object", () => {
		const raw = { keyColumn: "id", keyProperty: " ", columns: "bad" };
		migrate(raw);
		expect(raw).toEqual({ keyColumn: "id", keyProperty: " ", columns: "bad" });
	});

	it("derives keyColumns from a non-empty legacy keyColumn only", () => {
		expect(migrate({ keyColumn: "id" }).keyColumns).toEqual(["id"]);
		expect(migrate({ keyColumn: "" }).keyColumns).toEqual([]);
		expect(migrate({}).keyColumns).toEqual([]);
		expect(migrate({ keyColumn: 5 }).keyColumns).toEqual([]);
	});

	it("keeps only non-empty string keyColumns", () => {
		expect(migrate({ keyColumn: "legacy", keyColumns: ["a", "", 3, null, "b"] }).keyColumns).toEqual(["a", "b"]);
	});

	it("resets a non-string keyColumn", () => {
		expect(migrate({ keyColumn: 5 }).keyColumn).toBe("");
		expect(migrate({ keyColumn: "id" }).keyColumn).toBe("id");
	});

	it("falls back to import_key for a missing, non-string or blank key property", () => {
		expect(migrate({ keyProperty: 5 }).keyProperty).toBe("import_key");
		expect(migrate({ keyProperty: "  " }).keyProperty).toBe("import_key");
		expect(migrate({ keyProperty: "" }).keyProperty).toBe("import_key");
		expect(migrate({ keyProperty: "ref" }).keyProperty).toBe("ref");
	});

	it("keeps known date orders", () => {
		expect(migrate({ dateOrder: "dmy" }).dateOrder).toBe("dmy");
		expect(migrate({ dateOrder: "mdy" }).dateOrder).toBe("mdy");
		expect(migrate({ dateOrder: "ymd" }).dateOrder).toBe("auto");
	});

	it("keeps a valid row filter, drops invalid ones", () => {
		expect(migrate({ rowFilter: { column: "a", op: "contains", value: "x", extra: 1 } }).rowFilter).toEqual({ column: "a", op: "contains", value: "x" });
		expect(migrate({ rowFilter: { column: "a", op: "notEmpty" } }).rowFilter).toEqual({ column: "a", op: "notEmpty", value: "" });
		expect(migrate({ rowFilter: { column: "a", op: "equals", value: 3 } }).rowFilter).toEqual({ column: "a", op: "equals", value: "" });
		expect(migrate({ rowFilter: { column: "a", op: "like", value: "x" } }).rowFilter).toBeNull();
		expect(migrate({ rowFilter: { column: 1, op: "equals", value: "x" } }).rowFilter).toBeNull();
		expect(migrate({ rowFilter: "a=x" }).rowFilter).toBeNull();
		expect(migrate({ rowFilter: null }).rowFilter).toBeNull();
	});

	it("sanitizes extra properties", () => {
		const m = migrate({
			extraProperties: [
				{ property: "status", type: "text", defaultValue: "open", junk: true },
				{ property: "due", type: "date" },
				{ property: "n", type: "weird", defaultValue: 5 },
				{ type: "text", defaultValue: "no name" },
				null,
				"status",
			],
		});
		expect(m.extraProperties).toEqual([
			{ property: "status", type: "text", defaultValue: "open" },
			{ property: "due", type: "date", defaultValue: "" },
			{ property: "n", type: "text", defaultValue: "" },
		]);
	});

	it("keeps stored columns and resets non-arrays", () => {
		const columns: ColumnConfig[] = [{ source: "a", index: 0, property: "a", type: "text", include: true }];
		expect(migrate({ columns }).columns).toEqual(columns);
		expect(migrate({ columns: { a: 1 } }).columns).toEqual([]);
	});
});
