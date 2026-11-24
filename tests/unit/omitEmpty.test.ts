// emptyValues "omit": omitted properties are left out of the note but stay managed by the import, with their type.
import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/csv/parser";
import { prepareConfig } from "../../src/csv/typeInference";
import { planNotes } from "../../src/import/noteBuilder";
import type { FileImportConfig } from "../../src/types";
import { cfg, setup } from "./helpers/harness";

function plan(csv: string, overrides: Partial<FileImportConfig>) {
	const config = cfg(overrides);
	const parsed = parseCsv(csv, config);
	prepareConfig(config, parsed, true);
	return planNotes(parsed, config, { path: "Data/x.csv", basename: "x" });
}

describe("emptyValues omit", () => {
	it("leaves an empty plain cell out of the note but keeps its type", () => {
		const [n] = plan("a,b\n1,\n2,x", { emptyValues: "omit" });
		expect(n?.frontmatter).not.toHaveProperty("b");
		expect(n?.types.b).toBe("text");
	});

	it("treats an empty tags cell and a cell like '#' the same way", () => {
		for (const cell of ["", "#", " # , "]) {
			const [n] = plan(`tags,a\n"${cell}",1`, { emptyValues: "omit" });
			expect(n?.frontmatter, `cell ${JSON.stringify(cell)}`).not.toHaveProperty("tags");
			expect(n?.types.tags, `cell ${JSON.stringify(cell)}`).toBe("list");
		}
	});

	it("with the default, writes an empty property for both", () => {
		for (const cell of ["", "#"]) {
			const [n] = plan(`tags,a\n"${cell}",1`, {});
			expect(n?.frontmatter.tags, `cell ${JSON.stringify(cell)}`).toBeNull();
			expect(n?.types.tags).toBe("list");
		}
	});
});

describe("emptyValues omit on re-import", () => {
	const V1 = "id,note\n1,\n";
	const V2 = "id,note\n1,from the CSV\n";

	it("protects a value the user added to an omitted property", async () => {
		const t = setup({ emptyValues: "omit" });
		await t.run(V1);
		const p = "Data/hours/Entry 1.md";
		expect(t.fm(p)).not.toHaveProperty("note");
		await t.editInBases(p, (fm) => {
			fm.note = "mine";
		});
		const { result } = await t.run(V2);
		expect(t.fm(p).note).toBe("mine");
		expect(result.rows.find((r) => r.row === 1)?.preserved).toContain("note");
	});

	it("fills an omitted property the user left empty once the CSV has a value", async () => {
		const t = setup({ emptyValues: "omit" });
		await t.run(V1);
		const p = "Data/hours/Entry 1.md";
		await t.run(V2);
		expect(t.fm(p).note).toBe("from the CSV");
	});

	it("does not delete a value when the CSV cell becomes empty again", async () => {
		const t = setup({ emptyValues: "omit", keepValuesOnEmpty: false });
		await t.run(V2);
		const p = "Data/hours/Entry 1.md";
		await t.run(V1);
		expect(t.fm(p).note).toBe("from the CSV");
	});
});
