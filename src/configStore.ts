import type { FileImportConfig } from "./types";

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/** In-memory store of per-file import configs keyed by vault path. Values are deep-cloned in and out. */
export class ConfigStore {
	private files: Record<string, FileImportConfig>;

	constructor(
		initial: Record<string, FileImportConfig> | undefined,
		private readonly persist: () => Promise<void>,
	) {
		this.files = initial ? clone(initial) : {};
	}

	has(path: string): boolean {
		return Object.prototype.hasOwnProperty.call(this.files, path);
	}

	get(path: string): FileImportConfig | undefined {
		return this.has(path) ? clone(this.files[path]) : undefined;
	}

	async set(path: string, cfg: FileImportConfig): Promise<void> {
		this.files[path] = clone(cfg);
		await this.persist();
	}

	/** Moves a config to a new path. Returns true when something changed. */
	async rename(oldPath: string, newPath: string): Promise<boolean> {
		if (oldPath === newPath || !this.has(oldPath)) return false;
		const cfg = this.files[oldPath];
		if (!cfg) return false;
		this.files[newPath] = cfg;
		delete this.files[oldPath];
		await this.persist();
		return true;
	}

	/** Moves all configs located under a renamed folder. */
	async renameFolder(oldFolder: string, newFolder: string): Promise<boolean> {
		const prefix = oldFolder + "/";
		const moved = Object.keys(this.files).filter((p) => p.startsWith(prefix));
		if (moved.length === 0) return false;
		for (const p of moved) {
			const cfg = this.files[p];
			if (!cfg) continue;
			this.files[newFolder + "/" + p.slice(prefix.length)] = cfg;
			delete this.files[p];
		}
		await this.persist();
		return true;
	}

	async delete(path: string): Promise<boolean> {
		if (!this.has(path)) return false;
		delete this.files[path];
		await this.persist();
		return true;
	}

	async clear(): Promise<void> {
		this.files = {};
		await this.persist();
	}

	/** Vault paths of all stored file configs. */
	paths(): string[] {
		return Object.keys(this.files);
	}

	/** Snapshot for serialization. */
	toRecord(): Record<string, FileImportConfig> {
		return clone(this.files);
	}
}
