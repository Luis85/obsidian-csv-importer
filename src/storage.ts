import { normalizePath } from "obsidian";
import type { App } from "obsidian";
import type { ImportSnapshot, UndoManifest } from "./types";

interface StoredImport {
	csvPath: string;
	snapshot: ImportSnapshot;
	undo: UndoManifest | null;
}

/** Stable 53-bit string hash (cyrb53), hex encoded. */
function hashPath(s: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < s.length; i++) {
		const ch = s.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/**
 * Persists per-CSV import state (last imported value hashes and the undo manifest) as JSON files under
 * `<pluginDir>/imports/`. Everything is cached in memory so reads after `init()` are synchronous.
 */
export class ImportStorage {
	private readonly dir: string;
	private cache = new Map<string, StoredImport>();
	private ready: Promise<void> | null = null;
	private writes = new Map<string, { tail: Promise<void>; queued: Promise<void> | null }>();

	constructor(
		private readonly app: App,
		pluginDir: string,
	) {
		this.dir = normalizePath(`${pluginDir}/imports`);
	}

	/** Loads all stored imports into memory. Safe to call repeatedly. */
	init(): Promise<void> {
		if (!this.ready) this.ready = this.loadAll();
		return this.ready;
	}

	private fileFor(csvPath: string): string {
		return `${this.dir}/${hashPath(csvPath)}.json`;
	}

	private async loadAll(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(this.dir))) return;
			const listing = await adapter.list(this.dir);
			for (const path of listing.files) {
				if (!path.endsWith(".json")) continue;
				try {
					const data = JSON.parse(await adapter.read(path)) as Partial<StoredImport>;
					if (typeof data.csvPath !== "string") continue;
					this.cache.set(data.csvPath, {
						csvPath: data.csvPath,
						snapshot: data.snapshot ?? {},
						undo: data.undo ?? null,
					});
				} catch (e) {
					console.warn("CSV Importer: ignoring unreadable import state", path, e);
				}
			}
		} catch (e) {
			console.warn("CSV Importer: could not read stored import state", e);
		}
	}

	/**
	 * Writes are serialized per CSV and coalesced: while one write is in flight, further requests share a single
	 * follow-up write that serializes the latest in-memory state.
	 */
	private persist(entry: StoredImport): Promise<void> {
		const key = entry.csvPath;
		let st = this.writes.get(key);
		if (!st) {
			st = { tail: Promise.resolve(), queued: null };
			this.writes.set(key, st);
		}
		if (st.queued) return st.queued;
		const state = st;
		const p = state.tail.then(() => {
			state.queued = null;
			return this.writeEntry(key);
		});
		state.queued = p;
		state.tail = p.catch(() => undefined);
		return p;
	}

	private async writeEntry(csvPath: string): Promise<void> {
		const entry = this.cache.get(csvPath);
		if (!entry) return; // deleted or renamed meanwhile
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.dir))) {
			try {
				await adapter.mkdir(this.dir);
			} catch (e) {
				if (!(await adapter.exists(this.dir))) throw e;
			}
		}
		await adapter.write(this.fileFor(csvPath), JSON.stringify(entry));
	}

	private entry(csvPath: string): StoredImport {
		let e = this.cache.get(csvPath);
		if (!e) {
			e = { csvPath, snapshot: {}, undo: null };
			this.cache.set(csvPath, e);
		}
		return e;
	}

	async load(csvPath: string): Promise<{ snapshot: ImportSnapshot; undo: UndoManifest | null }> {
		await this.init();
		const e = this.cache.get(csvPath);
		return { snapshot: e?.snapshot ?? {}, undo: e?.undo ?? null };
	}

	async saveSnapshot(csvPath: string, snapshot: ImportSnapshot): Promise<void> {
		await this.init();
		const e = this.entry(csvPath);
		e.snapshot = snapshot;
		await this.persist(e);
	}

	async saveUndo(csvPath: string, manifest: UndoManifest | null): Promise<void> {
		await this.init();
		const e = this.entry(csvPath);
		e.undo = manifest;
		await this.persist(e);
	}

	/** Synchronous; relies on init() having completed (otherwise returns null). */
	getUndo(csvPath: string): UndoManifest | null {
		return this.cache.get(csvPath)?.undo ?? null;
	}

	async rename(oldCsvPath: string, newCsvPath: string): Promise<void> {
		await this.init();
		const e = this.cache.get(oldCsvPath);
		if (!e || oldCsvPath === newCsvPath) return;
		this.cache.delete(oldCsvPath);
		await this.removeFile(oldCsvPath);
		e.csvPath = newCsvPath;
		if (e.undo) e.undo = { ...e.undo, csvPath: newCsvPath };
		this.cache.set(newCsvPath, e);
		await this.persist(e);
	}

	async delete(csvPath: string): Promise<void> {
		await this.init();
		if (!this.cache.delete(csvPath)) return;
		await this.removeFile(csvPath);
	}

	/** Re-keys snapshot entries and undo references after a note was renamed or moved. */
	async renameNote(oldNotePath: string, newNotePath: string): Promise<void> {
		await this.init();
		for (const e of this.cache.values()) {
			let changed = false;
			if (Object.prototype.hasOwnProperty.call(e.snapshot, oldNotePath)) {
				e.snapshot[newNotePath] = e.snapshot[oldNotePath];
				delete e.snapshot[oldNotePath];
				changed = true;
			}
			if (e.undo) {
				e.undo.created = e.undo.created.map((p) => (p === oldNotePath ? newNotePath : p));
				for (const m of e.undo.modified) if (m.path === oldNotePath) m.path = newNotePath;
				if (e.undo.created.includes(newNotePath) || e.undo.modified.some((m) => m.path === newNotePath)) changed = true;
			}
			if (changed) await this.persist(e);
		}
	}

	private async removeFile(csvPath: string): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			const f = this.fileFor(csvPath);
			if (await adapter.exists(f)) await adapter.remove(f);
		} catch (e) {
			console.warn("CSV Importer: could not remove import state", e);
		}
	}
}
