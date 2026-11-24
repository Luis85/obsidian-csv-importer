import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { ConfigStore } from "../../src/configStore";
import { ImportService } from "../../src/obsidian/importService";
import { ImportStorage } from "../../src/storage";
import { DEFAULT_SETTINGS } from "../../src/defaults";
import { relativeTime } from "../../src/view/relativeTime";
import type { FileImportConfig } from "../../src/types";
import { cfg } from "./helpers/harness";
import { MockApp, Notice } from "./mocks/obsidian";

vi.mock("../../src/view/CsvView", () => ({ CsvView: class {} }));
vi.mock("../../src/view/ImportRunModal", () => ({ ImportRunModal: class {} }));

const confirms = vi.hoisted(() => ({ answer: true, checked: false, calls: [] as string[] }));
vi.mock("../../src/view/ConfirmModal", () => ({
	confirmDialog: async (_a: unknown, title: string, message: string) => {
		confirms.calls.push(`${title}|${message}`);
		return confirms.answer;
	},
	confirmDialogWithOption: async (_a: unknown, title: string, message: string) => {
		confirms.calls.push(`${title}|${message}`);
		return { ok: confirms.answer, checked: confirms.checked };
	},
}));

async function put(app: MockApp, path: string, text = "x"): Promise<void> {
	let cur = "";
	for (const p of path.split("/").slice(0, -1)) {
		cur = cur ? `${cur}/${p}` : p;
		if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur);
	}
	await app.vault.create(path, text);
}

function make() {
	const app = new MockApp();
	const configs: Record<string, FileImportConfig> = {};
	const store = new ConfigStore(configs, async () => undefined);
	const storage = new ImportStorage(app as unknown as App, "plugins/csv");
	const service = new ImportService(app as unknown as App, storage, store, () => DEFAULT_SETTINGS);
	return { app, store, storage, service };
}

beforeEach(() => {
	confirms.answer = true;
	confirms.checked = false;
	confirms.calls = [];
	Notice.messages = [];
});

describe("deleteImportedNotes", () => {
	async function seeded() {
		const t = make();
		await put(t.app, "Data/hours.csv");
		await put(t.app, "Data/hours/Entry 1.md");
		await put(t.app, "Data/hours/Entry 2.md");
		await put(t.app, "Data/hours/Mine.md");
		await put(t.app, "Data/hours.base");
		await t.store.set("Data/hours.csv", cfg({ lastImport: 123 }));
		await t.storage.saveSnapshot("Data/hours.csv", {
			"Data/hours/Entry 1.md": { a: "1" },
			"Data/hours/Entry 2.md": { a: "2" },
			"Data/hours/Gone.md": { a: "3" },
		});
		await t.storage.saveUndo("Data/hours.csv", { csvPath: "Data/hours.csv", timestamp: 1, created: ["Data/hours/Entry 1.md"], modified: [] });
		return t;
	}

	it("trashes only owned notes, clears state and keeps the config", async () => {
		const { app, store, storage, service } = await seeded();
		expect(await service.deleteImportedNotes("Data/hours.csv")).toBe(2);
		expect(confirms.calls[0]).toContain("This moves 2 notes created by importing hours.csv to the trash. Notes you created yourself are not affected.");
		expect(app.vault.getAbstractFileByPath("Data/hours/Entry 1.md")).toBeNull();
		expect(app.vault.getAbstractFileByPath("Data/hours/Entry 2.md")).toBeNull();
		expect(app.vault.getAbstractFileByPath("Data/hours/Mine.md")).not.toBeNull();
		expect(app.vault.getAbstractFileByPath("Data/hours.base")).not.toBeNull();
		expect(await storage.loadSnapshot("Data/hours.csv")).toEqual({});
		expect(storage.hasUndo("Data/hours.csv")).toBe(false);
		expect(await storage.loadUndo("Data/hours.csv")).toBeNull();
		expect(store.has("Data/hours.csv")).toBe(true);
		expect(store.get("Data/hours.csv")!.lastImport).toBeNull();
		expect(Notice.messages).toContain("Moved 2 notes to the trash.");
	});

	it("also deletes the base file when asked", async () => {
		const { app, service } = await seeded();
		confirms.checked = true;
		await service.deleteImportedNotes("Data/hours.csv");
		expect(app.vault.getAbstractFileByPath("Data/hours.base")).toBeNull();
	});

	it("does nothing when cancelled", async () => {
		const { app, storage, service } = await seeded();
		confirms.answer = false;
		expect(await service.deleteImportedNotes("Data/hours.csv")).toBe(0);
		expect(app.vault.getAbstractFileByPath("Data/hours/Entry 1.md")).not.toBeNull();
		expect(Object.keys(await storage.loadSnapshot("Data/hours.csv"))).toHaveLength(3);
	});

	it("works when the CSV file is missing", async () => {
		const { app, service } = await seeded();
		app.vault.remove("Data/hours.csv");
		expect(await service.deleteImportedNotes("Data/hours.csv")).toBe(2);
	});
});

describe("removeFromIndex", () => {
	it("deletes config and state but not the notes", async () => {
		const t = make();
		await put(t.app, "Data/hours.csv");
		await put(t.app, "Data/hours/Entry 1.md");
		await t.store.set("Data/hours.csv", cfg());
		await t.storage.saveSnapshot("Data/hours.csv", { "Data/hours/Entry 1.md": { a: "1" } });
		await t.storage.saveUndo("Data/hours.csv", { csvPath: "Data/hours.csv", timestamp: 1, created: ["Data/hours/Entry 1.md"], modified: [] });
		expect(await t.service.removeFromIndex("Data/hours.csv")).toBe(true);
		expect(confirms.calls[0]).toContain("Remove hours.csv from CSV imports? Its import settings and import history are deleted. Imported notes stay.");
		expect(t.store.has("Data/hours.csv")).toBe(false);
		expect(t.storage.hasUndo("Data/hours.csv")).toBe(false);
		expect(await t.storage.loadSnapshot("Data/hours.csv")).toEqual({});
		expect(t.app.vault.getAbstractFileByPath("Data/hours/Entry 1.md")).not.toBeNull();
	});

	it("keeps everything when cancelled", async () => {
		const t = make();
		await t.store.set("a.csv", cfg());
		confirms.answer = false;
		expect(await t.service.removeFromIndex("a.csv")).toBe(false);
		expect(t.store.has("a.csv")).toBe(true);
	});
});

describe("listImports", () => {
	it("sorts by last import desc then name and flags missing CSVs", async () => {
		const t = make();
		await put(t.app, "b.csv");
		await put(t.app, "a.csv");
		await put(t.app, "c.csv");
		await t.store.set("b.csv", cfg({ lastImport: 100 }));
		await t.store.set("a.csv", cfg({ lastImport: null }));
		await t.store.set("c.csv", cfg({ lastImport: 200 }));
		await t.store.set("gone.csv", cfg({ lastImport: null }));
		await put(t.app, "c.base");
		await t.storage.saveUndo("b.csv", { csvPath: "b.csv", timestamp: 1, created: ["b/1.md"], modified: [] });
		await t.storage.saveSnapshot("b.csv", { "b/1.md": {}, "b/2.md": {} });
		const list = await t.service.listImports();
		expect(list.map((i) => i.csvPath)).toEqual(["c.csv", "b.csv", "a.csv", "gone.csv"]);
		expect(list.find((i) => i.csvPath === "gone.csv")!.exists).toBe(false);
		expect(list.find((i) => i.csvPath === "a.csv")!.exists).toBe(true);
		expect(list.find((i) => i.csvPath === "b.csv")!.hasUndo).toBe(true);
		expect(list.find((i) => i.csvPath === "c.csv")!.basePath).toBe("c.base");
		expect(list.find((i) => i.csvPath === "b.csv")!.targetFolder).toBe("b");
		expect(await t.service.countImportedNotes("b.csv")).toBe(2);
	});
});

describe("relativeTime", () => {
	it("formats past times", () => {
		const now = 1_000_000_000_000;
		expect(relativeTime(now - 10_000, now)).toBe("just now");
		expect(relativeTime(now - 2 * 3600_000, now)).toBe("2 hours ago");
		expect(relativeTime(now - 60_000, now)).toBe("1 minute ago");
		expect(relativeTime(now - 3 * 86400_000, now)).toBe("3 days ago");
	});
});
