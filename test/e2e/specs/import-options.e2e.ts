import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { openCsv, openPreview, countsLine, patchConfig, shot, writeVault } from "../flows";
import {
	clickButton, findNoteByFrontmatter, importViaDialog, installConsoleSpy, listNotes, pluginProblems, readVaultFile, resetEverything,
	waitForFrontmatter, waitForNoModal,
} from "../support";

const SPEC = "import-options";
const PEOPLE = "Data/people.csv";
const PEOPLE_DIR = "Data/people";

/** Frontmatter of the person with this ID (found by value, so the file name template does not matter). */
const person = async (id: string, folder = PEOPLE_DIR) => {
	const path = await findNoteByFrontmatter(folder, "ID", id);
	return { path, fm: await waitForFrontmatter(path, (f) => f["Name"] !== undefined) };
};

describe("import options: typed values, templates, keys, filters, formats", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("writes typed properties: text IDs stay text, numbers and checkboxes are real, empty cells are empty", async function () {
		await importViaDialog(PEOPLE);
		const anna = (await person("007")).fm;
		expect(anna["ID"]).toBe("007");
		expect(anna["Betrag"]).toBe(12.5);
		expect(anna["Aktiv"]).toBe(true);
		expect(anna["Status"]).toBe("open");
		const ben = (await person("008")).fm;
		expect(ben["Betrag"]).toBe(7);
		expect(ben["Aktiv"]).toBe(false);
		const clara = (await person("009")).fm;
		expect(clara["Betrag"] === null || clara["Betrag"] === undefined).toBe(true);
		expect(JSON.stringify(clara)).not.toContain('"Betrag":""');
	});

	it("uses the file name, body and target folder templates", async function () {
		await patchConfig(PEOPLE, {
			fileNameTemplate: "{{ID}} {{Name}}",
			bodyTemplate: "# {{Name}}\nRow {{row}} of {{file}}",
			targetFolder: "People/{{Status}}",
		});
		await importViaDialog(PEOPLE);
		expect(await listNotes("People/open")).toEqual(["People/open/007 Anna Schmidt.md", "People/open/009 Clara Vogel.md", "People/open/010 Dirk Maier.md"]);
		expect(await listNotes("People/done")).toEqual(["People/done/008 Ben Weber.md"]);
		const body = await readVaultFile("People/open/007 Anna Schmidt.md");
		expect(body).toContain("# Anna Schmidt");
		expect(body).toContain("Row 1 of people");
	});

	it("adds tags and omits the source link when it is switched off", async function () {
		await patchConfig(PEOPLE, { tags: "alpha, beta", addSourceLink: false });
		await importViaDialog(PEOPLE);
		const { fm } = await person("007");
		expect(fm["tags"]).toEqual(["alpha", "beta"]);
		expect(fm["source"]).toBeUndefined();
	});

	it("adds extra properties with {{uuid}} and {{today}}, and never overwrites a value set later", async function () {
		await patchConfig(PEOPLE, {
			extraProperties: [
				{ property: "workflow", type: "text", defaultValue: "open" },
				{ property: "uid", type: "text", defaultValue: "{{uuid}}" },
				{ property: "created", type: "date", defaultValue: "{{today}}" },
			],
		});
		await importViaDialog(PEOPLE);
		const a = await person("007");
		const b = await person("008");
		expect(a.fm["workflow"]).toBe("open");
		expect(String(a.fm["uid"])).toMatch(/^[0-9a-f-]{36}$/);
		expect(a.fm["uid"]).not.toBe(b.fm["uid"]);
		expect(String(a.fm["created"])).toMatch(/^\d{4}-\d{2}-\d{2}$/);

		await browser.executeObsidian(async ({ app }, path) => {
			const f = app.vault.getFileByPath(path);
			if (f) await app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => void (fm["workflow"] = "done"));
		}, a.path);
		await writeVault(PEOPLE, (await readVaultFile(PEOPLE)).replace("Anna Schmidt", "Anna Schmidt-Neu"));
		await importViaDialog(PEOPLE);
		const again = await waitForFrontmatter(a.path, (f) => f["Name"] === "Anna Schmidt-Neu");
		expect(again["workflow"]).toBe("done");
		expect(again["uid"]).toBe(a.fm["uid"]);
	});

	it("matches by a key column: renamed notes are updated, not duplicated", async function () {
		await patchConfig(PEOPLE, { keyColumn: "ID" });
		await importViaDialog(PEOPLE);
		const a = await person("007");
		await browser.executeObsidian(async ({ app }, path) => {
			const f = app.vault.getFileByPath(path);
			if (f) await app.fileManager.renameFile(f, "Data/people/Anna renamed.md");
		}, a.path);
		await writeVault(PEOPLE, (await readVaultFile(PEOPLE)).replace("Anna Schmidt", "Anna Neu"));
		await importViaDialog(PEOPLE);
		expect(await listNotes(PEOPLE_DIR)).toHaveLength(4);
		await waitForFrontmatter("Data/people/Anna renamed.md", (f) => f["Name"] === "Anna Neu");
	});

	it("matches by a composite key stored in the key property", async function () {
		await patchConfig(PEOPLE, { keyColumns: ["Name", "Status"], keyProperty: "import_key" });
		await importViaDialog(PEOPLE);
		const path = await findNoteByFrontmatter(PEOPLE_DIR, "import_key", "Anna Schmidt | open");
		expect(path).toContain(PEOPLE_DIR);
	});

	it("imports only the rows that match the row filter, in the button count and the preview", async function () {
		await patchConfig(PEOPLE, { rowFilter: { column: "Status", op: "equals", value: "open" } });
		await openCsv(PEOPLE);
		await expect(browser.$("[data-testid=csv-import]")).toHaveText("Import 3 rows");
		await expect(browser.$("[data-testid=csv-view]")).toHaveText(expect.stringContaining("3"));
		await shot(SPEC, "row-filter");
		await importViaDialog(PEOPLE);
		expect(await listNotes(PEOPLE_DIR)).toHaveLength(3);
	});

	it("reads German dates, currency amounts and yes/no with the units ignored", async function () {
		await importViaDialog("Data/dates.csv");
		const path = await findNoteByFrontmatter("Data/dates", "Datum", "2026-11-18");
		const fm = await waitForFrontmatter(path, (f) => f["Betrag"] !== undefined);
		expect(fm["Betrag"]).toBe(1234.56);
		expect(fm["Gemeldet"]).toBe(true);
	});

	it("leaves ambiguous slash dates as text unless the date order is chosen", async function () {
		await importViaDialog("Data/slash-dates.csv");
		// 25/03/2026 settles the column as day first, so both rows are dates.
		const dates = await Promise.all(
			(await listNotes("Data/slash-dates")).map(async (p) => String((await waitForFrontmatter(p, (f) => f["Wert"] !== undefined))["Datum"])),
		);
		expect(dates.sort()).toEqual(["2026-03-25", "2026-04-03"]);
	});

	it("skips existing notes with the Skip strategy", async function () {
		await importViaDialog(PEOPLE);
		await patchConfig(PEOPLE, { conflict: "skip" });
		await writeVault(PEOPLE, (await readVaultFile(PEOPLE)).replace("Anna Schmidt", "Anna Changed"));
		await openPreview(PEOPLE);
		expect(await countsLine()).toMatch(/4 skipped/);
		await clickButton("Cancel");
		await waitForNoModal();
		expect((await person("007")).fm["Name"]).toBe("Anna Schmidt");
	});

	it("creates copies with the Create a copy strategy", async function () {
		await importViaDialog(PEOPLE);
		await patchConfig(PEOPLE, { conflict: "rename" });
		await importViaDialog(PEOPLE);
		expect(await listNotes(PEOPLE_DIR)).toHaveLength(8);
		expect((await listNotes(PEOPLE_DIR)).some((p) => / 1\.md$/.test(p))).toBe(true);
	});

	it("skips notes this import did not create, until the setting allows updating them", async function () {
		await writeVault("Data/people/people 1.md", "---\nID: '007'\nMine: yes\n---\nmy note\n");
		await openPreview(PEOPLE);
		const counts = await countsLine();
		expect(counts).toMatch(/1 skipped/);
		await expect(browser.$("[data-testid=import-run-modal]")).toHaveText(expect.stringContaining("not created by this import"));
		await shot(SPEC, "not-created-by-import", true);
		await clickButton("Cancel");
		await waitForNoModal();
		await patchConfig(PEOPLE, { adoptExistingNotes: true });
		await importViaDialog(PEOPLE);
		const fm = await waitForFrontmatter("Data/people/people 1.md", (f) => f["Name"] !== undefined);
		expect(fm["Mine"]).toBeTruthy();
		expect(await readVaultFile("Data/people/people 1.md")).toContain("my note");
	});
});
