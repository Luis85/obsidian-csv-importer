// Case-insensitive vault paths for one import run: lookups, folder casing, folder creation, claims and free names.
import type { App, TAbstractFile } from "obsidian";
import { describe, expect, it } from "vitest";
import { PathIndex } from "../../src/import/pathIndex";
import { ObsidianVaultGateway } from "../../src/import/vaultGateway";
import { MockApp } from "./mocks/obsidian";

async function vault(paths: string[] = [], folders: string[] = []) {
	const app = new MockApp();
	for (const f of folders) await app.vault.createFolder(f);
	for (const p of paths) await app.vault.create(p, "");
	const gateway = new ObsidianVaultGateway(app as unknown as App);
	return { app, gateway, index: new PathIndex(gateway) };
}

describe("lookup", () => {
	it("prefers the exact path, else the first case-insensitive match", async () => {
		const { index } = await vault(["d/A.md", "d/a.md"], ["d"]);
		expect(index.lookup("d/a.md")?.path).toBe("d/a.md");
		expect(index.lookup("d/A.MD")?.path).toBe("d/A.md");
		expect(index.lookup("d/b.md")).toBeNull();
	});

	it("sees files this run created once they are added", async () => {
		const { app, index } = await vault([], ["d"]);
		expect(index.lookup("d/new.md")).toBeNull();
		const created = await app.vault.create("d/New.md", "");
		expect(index.lookup("d/new.md")).toBeNull(); // folder listing is cached
		index.added(created as unknown as TAbstractFile);
		expect(index.lookup("d/new.md")?.path).toBe("d/New.md");
	});
});

describe("resolveFolder / resolvePath", () => {
	it("uses the casing of existing folders and ignores empty segments", async () => {
		const { index } = await vault([], ["Data", "Data/Sub"]);
		expect(index.resolveFolder("data/sub/new")).toBe("Data/Sub/new");
		expect(index.resolveFolder("data//sub")).toBe("Data/Sub");
		expect(index.resolvePath("data/x.md")).toBe("Data/x.md");
		expect(index.resolvePath("x.md")).toBe("x.md");
	});
});

describe("ensureFolder", () => {
	it("creates missing parents and later lookups see the new folders", async () => {
		const { app, index } = await vault([], ["x"]);
		expect(index.resolveFolder("x/y/z")).toBe("x/y/z");
		await index.ensureFolder("x/Y");
		expect(app.vault.getAbstractFileByPath("x/Y")).not.toBeNull();
		expect(index.resolveFolder("x/y/z")).toBe("x/Y/z");
	});

	it("tolerates a folder created concurrently, rethrows real failures", async () => {
		const { app, gateway, index } = await vault();
		gateway.createFolder = async (p) => {
			await app.vault.createFolder(p);
			throw new Error("Folder already exists.");
		};
		await expect(index.ensureFolder("a/b")).resolves.toBeUndefined();
		expect(app.vault.getAbstractFileByPath("a/b")).not.toBeNull();

		const broken = await vault();
		broken.gateway.createFolder = () => Promise.reject(new Error("read-only vault"));
		await expect(broken.index.ensureFolder("c")).rejects.toThrow("read-only vault");
	});
});

describe("claims and free names", () => {
	it("claims are case-insensitive", async () => {
		const { index } = await vault();
		index.claim("Data/Note.md");
		expect(index.isClaimed("data/note.md")).toBe(true);
		expect(index.isClaimed("DATA/NOTE.MD")).toBe(true);
		expect(index.isClaimed("data/other.md")).toBe(false);
	});

	it("free picks the first 'name N.ext' neither in the vault nor claimed", async () => {
		const { index } = await vault(["d/x.md", "d/x 1.md"], ["d"]);
		index.claim("d/X 2.md");
		expect(index.free("d/x.md")).toBe("d/x 3.md");
		expect(index.free("d/noext")).toBe("d/noext 1");
	});

	it("gives up when every name is taken", async () => {
		const { gateway, index } = await vault();
		gateway.getAbstract = (p) => ({ path: p, name: p }) as unknown as TAbstractFile;
		expect(() => index.free("x.md")).toThrow("No free file name found");
	});
});
