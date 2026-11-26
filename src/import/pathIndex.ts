import { parentOf } from "../core/util";
import { isFolder } from "./vaultGateway";
import type { VaultGateway } from "./vaultGateway";
import type { TAbstractFile } from "obsidian";

/**
 * The form names are compared in: case-insensitive, and with composed Unicode (NFC), so "é" typed as one character
 * and as "e" plus an accent (as macOS and some sync tools write names) are the same name.
 */
function fold(name: string): string {
	return name.normalize("NFC").toLowerCase();
}

/**
 * Case-insensitive view of the vault paths an import touches: existence lookups, the casing of existing
 * folders, free file names and the paths this run has already claimed.
 */
export class PathIndex {
	private readonly childMaps = new Map<string, Map<string, TAbstractFile>>();
	private readonly knownFolders = new Set<string>();
	/** Paths written or merged by this run, folded (see fold). */
	private readonly claimed = new Set<string>();

	constructor(private readonly vault: VaultGateway) {}

	private childMap(folderPath: string): Map<string, TAbstractFile> | null {
		let m = this.childMaps.get(folderPath);
		if (m) return m;
		const children = this.vault.childrenOf(folderPath);
		if (!children) return null;
		m = new Map();
		for (const c of children) {
			const k = fold(c.name);
			if (!m.has(k)) m.set(k, c);
		}
		this.childMaps.set(folderPath, m);
		return m;
	}

	/** File or folder at the path, matching names case-insensitively when there is no exact match. */
	lookup(path: string): TAbstractFile | null {
		const exact = this.vault.getAbstract(path);
		if (exact) return exact;
		const i = path.lastIndexOf("/");
		return this.childMap(i < 0 ? "" : path.slice(0, i))?.get(fold(path.slice(i + 1))) ?? null;
	}

	/** Folder path with the casing of the folders that already exist. */
	resolveFolder(folder: string): string {
		let current = "";
		const parts = folder.split("/").filter((p) => p.length > 0);
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i] ?? "";
			const next = current ? `${current}/${part}` : part;
			const found = this.lookup(next);
			if (isFolder(found)) current = found.path;
			else return [next, ...parts.slice(i + 1)].join("/");
		}
		return current;
	}

	/** File path with the casing of the folders that already exist. */
	resolvePath(path: string): string {
		const parent = this.resolveFolder(parentOf(path));
		const name = path.slice(path.lastIndexOf("/") + 1);
		return parent ? `${parent}/${name}` : name;
	}

	/** Creates the folder and its missing parents. */
	async ensureFolder(folder: string): Promise<void> {
		if (!folder || this.knownFolders.has(folder)) return;
		let current = "";
		for (const part of folder.split("/").filter((p) => p.length > 0)) {
			current = current ? `${current}/${part}` : part;
			if (this.knownFolders.has(current)) continue;
			if (!this.vault.getAbstract(current)) await this.createFolder(current);
			this.knownFolders.add(current);
		}
	}

	/** Creates one folder; fine when it appeared meanwhile (created concurrently). */
	private async createFolder(path: string): Promise<void> {
		try {
			await this.vault.createFolder(path);
			this.childMaps.clear();
		} catch (e) {
			if (!this.vault.getAbstract(path)) throw e;
		}
	}

	/** Marks a path as written or merged by this run. */
	claim(path: string): void {
		this.claimed.add(fold(path));
	}

	isClaimed(path: string): boolean {
		return this.claimed.has(fold(path));
	}

	/** True when something exists at the path or this run has claimed it. */
	isTaken(path: string): boolean {
		return this.lookup(path) !== null || this.isClaimed(path);
	}

	/** First "name 1.ext", "name 2.ext", ... that is neither in the vault nor claimed. */
	free(path: string): string {
		const dot = path.lastIndexOf(".");
		const base = dot < 0 ? path : path.slice(0, dot);
		const ext = dot < 0 ? "" : path.slice(dot);
		for (let n = 1; n < 100000; n++) {
			const c = `${base} ${n}${ext}`;
			if (!this.isTaken(c)) return c;
		}
		throw new Error("No free file name found");
	}

	/** Records a file this run created so later lookups in its folder see it without rebuilding the map. */
	added(file: TAbstractFile): void {
		this.childMaps.get(parentOf(file.path))?.set(fold(file.name), file);
	}
}
