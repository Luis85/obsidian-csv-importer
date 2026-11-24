import { browser, expect } from "@wdio/globals";
import { describe, it, before, beforeEach, after } from "mocha";
import { chooseAddCsv, hasIndexRow, indexRow, openIndex, shot } from "../flows";
import { activeViewType, clickButton, installConsoleSpy, pluginProblems, resetEverything, waitForModal, waitForNoModal } from "../support";

const SPEC = "index-add-outside";
const MODAL = "[data-testid=add-csv-modal]";

/**
 * Chooses a file in the dialog's native file input the way the picker would: a File with these bytes is put on the
 * input and its change event fires (the OS dialog itself cannot be driven from the page).
 */
const pickFile = (name: string, bytes: number[]) =>
	browser.execute(
		(n, b) => {
			const input = document.querySelector("[data-testid=add-csv-input]") as HTMLInputElement;
			const dt = new DataTransfer();
			dt.items.add(new File([new Uint8Array(b)], n, { type: "text/csv" }));
			input.files = dt.files;
			input.dispatchEvent(new Event("change", { bubbles: true }));
		},
		name,
		bytes,
	);

const readBytes = (path: string) =>
	browser.executeObsidian(async ({ app }, p) => Array.from(new Uint8Array(await app.vault.adapter.readBinary(p))), path);

const bytesOf = (s: string) => [...new TextEncoder().encode(s)];
// "Strasse;Grosse" with sharp s as the single Windows-1252 byte 0xDF: not valid UTF-8, so a re-encoding copy would change it.
const LATIN1 = [0x53, 0x74, 0x72, 0x61, 0xdf, 0x65, 0x3b, 0x47, 0x72, 0xf6, 0xdf, 0x65, 0x0a, 0x31, 0x3b, 0x32, 0x0a];

const setFolder = (v: string) => browser.$(`${MODAL} [data-testid=add-csv-folder]`).setValue(v);

describe("Index: add a CSV file from outside the vault", function () {
	before(installConsoleSpy);
	beforeEach(resetEverything);
	after(async function () {
		expect(await pluginProblems()).toEqual([]);
	});

	const open = async () => {
		await openIndex();
		await chooseAddCsv("device");
		await waitForModal("Add CSV file");
		await expect(browser.$(`${MODAL} [data-testid=add-csv-input]`)).toHaveAttribute("accept", ".csv,text/csv");
	};

	it("copies the picked file's bytes into the chosen folder, adds it to the index and opens it", async function () {
		await open();
		await shot(SPEC, "dialog-empty", true);
		await expect(browser.$(`${MODAL} [data-testid=add-csv-submit]`)).toBeDisabled();
		await expect(browser.$(MODAL)).toHaveText(expect.stringContaining("cannot follow the original file"));
		await pickFile("Outside.csv", LATIN1);
		await expect(browser.$(`${MODAL} [data-testid=add-csv-name]`)).toHaveValue("Outside.csv");
		await setFolder("Inbox/2026");
		await shot(SPEC, "dialog-filled", true);
		await clickButton("Add to vault");
		await waitForNoModal();
		expect(await readBytes("Inbox/2026/Outside.csv")).toEqual(LATIN1);
		await browser.waitUntil(async () => (await activeViewType()) === "csv-importer-view", { timeoutMsg: "the CSV did not open in the table view" });
		await openIndex();
		await browser.waitUntil(() => hasIndexRow("Outside.csv"), { timeoutMsg: "not in the index" });
		await expect(await indexRow("Outside.csv")).toHaveText(expect.stringContaining("Never imported"));
	});

	it("asks what to do when the file exists: keep both uses a free name, replace overwrites", async function () {
		await open();
		await pickFile("timesheet.csv", bytesOf("a,b\n1,2\n"));
		await setFolder("Data");
		const conflict = browser.$(`${MODAL} [data-testid=add-csv-conflict]`);
		await expect(conflict).toBeDisplayed();
		await expect(conflict).toHaveText(expect.stringContaining("Data/timesheet.csv already exists."));
		await shot(SPEC, "conflict", true);
		await browser.$(`${MODAL} [data-testid=add-csv-keep]`).click();
		await clickButton("Add to vault");
		await waitForNoModal();
		expect(await readBytes("Data/timesheet 1.csv")).toEqual(bytesOf("a,b\n1,2\n"));

		await open();
		await pickFile("timesheet.csv", bytesOf("x\n9\n"));
		await setFolder("Data");
		await browser.$(`${MODAL} [data-testid=add-csv-replace]`).click();
		await clickButton("Add to vault");
		await waitForNoModal();
		expect(await readBytes("Data/timesheet.csv")).toEqual(bytesOf("x\n9\n"));
	});
});
