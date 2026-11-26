import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { chooseAddCsv, hasIndexRow, indexRow, openIndex, shot, writeVault } from "../flows";
import { CSV, clickButton, importViaDialog, installConsoleSpy, pluginProblems, resetEverything, waitForModal, waitForNoModal } from "../support";

const SPEC = "index-scan";
const MODAL = "[data-testid=scan-vault-modal]";

const scanNames = () => browser.$$(`${MODAL} [data-testid=scan-row] .csv-importer-scan-name`).map((e) => e.getText());

describe("Index: scan vault", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	it("lists CSV files that are not in the index, checked, with size and row count", async function () {
		await importViaDialog(CSV);
		await openIndex();
		await chooseAddCsv("scan");
		await waitForModal("Scan vault");
		const names = await scanNames();
		expect(names).toContain("people.csv");
		expect(names).toContain("timesheet-de.csv");
		expect(names).not.toContain("timesheet.csv");
		for (const box of await browser.$$(`${MODAL} [data-testid=scan-row] input`)) expect(await box.isSelected()).toBe(true);
		// Row counts load as rows scroll into view; bring each one into view so all of them load.
		for (const row of await browser.$$(`${MODAL} [data-testid=scan-row]`)) await row.scrollIntoView({ block: "nearest" });
		await browser.waitUntil(
			async () => {
				const texts = await browser.$$(`${MODAL} .csv-importer-scan-rows`).map((e) => e.getText());
				return texts.every((t) => /\d+ rows?/.test(t));
			},
			{ timeoutMsg: "row counts did not load" },
		);
		await shot(SPEC, "scan-list", true);
		await clickButton("Cancel");
		await waitForNoModal();
	});

	it("adds the checked files with default settings and no import, and a re-scan lists only new ones", async function () {
		await openIndex();
		await chooseAddCsv("scan");
		await waitForModal("Scan vault");
		const total = (await scanNames()).length;
		expect(total).toBeGreaterThanOrEqual(8);
		for (const row of await browser.$$(`${MODAL} [data-testid=scan-row]`)) {
			if ((await row.getText()).includes("people.csv")) await row.$("input").click();
		}
		await clickButton(`Add ${total - 1} to CSV imports`);
		await waitForNoModal();
		await browser.waitUntil(() => hasIndexRow("timesheet.csv"), { timeoutMsg: "scanned CSV not in the index" });
		expect(await hasIndexRow("people.csv")).toBe(false);
		await expect(await indexRow("timesheet.csv")).toHaveText(expect.stringContaining("Never imported"));
		await shot(SPEC, "index-after-scan", true);
		// A new file appears in the next scan, together with the one that was left out.
		await writeVault("Inbox/new-data.csv", "a,b\n1,2\n");
		await chooseAddCsv("scan");
		await waitForModal("Scan vault");
		expect((await scanNames()).sort()).toEqual(["new-data.csv", "people.csv"]);
		await clickButton("Cancel");
		await waitForNoModal();
	});

	it("shows an empty state when every CSV is already in the index", async function () {
		await openIndex();
		await chooseAddCsv("scan");
		await waitForModal("Scan vault");
		await clickButton(/^Add \d+ to CSV imports$/);
		await waitForNoModal();
		await chooseAddCsv("scan");
		await waitForModal("Scan vault");
		await expect(browser.$(`${MODAL} [data-testid=scan-empty]`)).toHaveText(expect.stringContaining("No new CSV files found"));
		await shot(SPEC, "scan-empty", true);
		await clickButton("Close");
		await waitForNoModal();
	});
});
