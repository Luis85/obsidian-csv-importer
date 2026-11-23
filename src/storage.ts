import { normalizePath } from "obsidian";
import type { App } from "obsidian";
import type { ImportSnapshot, UndoManifest } from "./types";

/** Cheap per-CSV entry of imports/index.json: what exists, without reading the (large) state files. */
interface IndexEntry {
	/** Hash used in the file names `<file>.json` (snapshot) and `<file>.undo.json`. */
	file: string;
	hasUndo: boolean;
	/** Folders of the notes in the snapshot / undo manifest, or null when there are too many to list. */
	snapDirs: string[] | null;
	undoDirs: string[] | null;
}

interface Loaded {
	csvPath: string;
	snapshot: ImportSnapshot | null;
	undo: UndoManifest | null | undefined; // undefined = not loaded yet
	snapDirty: boolean;
	undoDirty: boolean;
}

const MAX_DIRS = 200;
const INDEX_FILE = "index.json";

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

function parentOf(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? "" : path.slice(0, i);
}

function dirsOf(paths: Iterable<string>): string[] | null {
	const set = new Set<string>();
	for (const p of paths) {
		set.add(parentOf(p));
		if (set.size > MAX_DIRS) return null;
	}
	return [...set];
}

function undoPaths(u: UndoManifest | null): string[] {
	return u ? [...u.created, ...u.modified.map((m) => m.path)] : [];
}

/**
 * Persists per-CSV import state under `<pluginDir>/imports/`: `index.json` (which CSVs have state, and whether
 * they can be undone), `<hash>.json` (snapshot of last imported value hashes) and `<hash>.undo.json` (undo
 * manifest). Only the index is read on startup; a CSV's files are loaded on first use and then cached.
 */
export class ImportStorage {
	private readonly dir: string;
	private index = new Map<string, IndexEntry>();
	private cache = new Map<string, Loaded>();
	private ready: Promise<void> | null = null;
	private writes = new Map<string, { tail: Promise<void>; queued: Promise<void> | null }>();

	constructor(
		private readonly app: App,
		pluginDir: string,
	) {
		this.dir = normalizePath(`${pluginDir}/imports`);
	}

	/** Reads the index (migrating the old one-file-per-CSV layout once). Safe to call repeatedly. */
	init(): Promise<void> {
		if (!this.ready) this.ready = this.loadIndex();
		return this.ready;
	}

	private snapFile(file: string): string {
		return `${this.dir}/${file}.json`;
	}

	private undoFile(file: string): string {
		return `${this.dir}/${file}.undo.json`;
	}

	private async loadIndex(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(this.dir))) return;
			const indexPath = `${this.dir}/${INDEX_FILE}`;
			if (await adapter.exists(indexPath)) {
				const data = JSON.parse(await adapter.read(indexPath)) as Record<string, Partial<IndexEntry>>;
				for (const [csvPath, e] of Object.entries(data)) {
					this.index.set(csvPath, {
						file: e.file ?? hashPath(csvPath),
						hasUndo: e.hasUndo === true,
						snapDirs: e.snapDirs === undefined ? null : e.snapDirs,
						undoDirs: e.undoDirs === undefined ? null : e.undoDirs,
					});
				}
				return;
			}
			await this.migrate();
		} catch (e) {
			console.error("CSV Importer: could not read stored import state", e);
		}
	}

	/** Old layout: `<hash>.json` held {csvPath, snapshot, undo}. Also rebuilds a lost index. */
	private async migrate(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const listing = await adapter.list(this.dir);
		for (const path of listing.files) {
			if (!path.endsWith(".json") || path.endsWith(".undo.json") || path.endsWith(`/${INDEX_FILE}`)) continue;
			try {
				const data = JSON.parse(await adapter.read(path)) as {
					csvPath?: string;
					snapshot?: ImportSnapshot;
					undo?: UndoManifest | null;
				};
				if (typeof data.csvPath !== "string") continue;
				let undo = data.undo ?? null;
				if (!undo) {
					const f = this.undoFile(hashPath(data.csvPath));
					if (await adapter.exists(f)) undo = JSON.parse(await adapter.read(f)) as UndoManifest;
				}
				const snapshot = data.snapshot ?? {};
				this.index.set(data.csvPath, {
					file: hashPath(data.csvPath),
					hasUndo: undo !== null,
					snapDirs: dirsOf(Object.keys(snapshot)),
					undoDirs: dirsOf(undoPaths(undo)),
				});
				this.cache.set(data.csvPath, { csvPath: data.csvPath, snapshot, undo, snapDirty: true, undoDirty: undo !== null });
			} catch {
				// Unreadable state of one CSV: that CSV starts fresh.
			}
		}
		for (const csvPath of [...this.cache.keys()]) void this.persist(csvPath).catch(() => undefined);
		await this.persistIndex();
	}

	/**
	 * Writes are serialized per key and coalesced: while one write is in flight, further requests share a single
	 * follow-up write that serializes the latest in-memory state.
	 */
	private queue(key: string, run: () => Promise<void>): Promise<void> {
		let st = this.writes.get(key);
		if (!st) {
			st = { tail: Promise.resolve(), queued: null };
			this.writes.set(key, st);
		}
		if (st.queued) return st.queued;
		const state = st;
		const p = state.tail.then(() => {
			state.queued = null;
			return run();
		});
		state.queued = p;
		state.tail = p.catch(() => undefined);
		return p;
	}

	private persist(csvPath: string): Promise<void> {
		return this.queue(`c:${csvPath}`, async () => {
			const entry = this.cache.get(csvPath);
			const idx = this.index.get(csvPath);
			if (!entry || !idx) return; // deleted or renamed meanwhile
			await this.ensureDir();
			const adapter = this.app.vault.adapter;
			if (entry.snapDirty) {
				entry.snapDirty = false;
				await adapter.write(this.snapFile(idx.file), JSON.stringify({ csvPath, snapshot: entry.snapshot ?? {} }));
			}
			if (entry.undoDirty) {
				entry.undoDirty = false;
				const f = this.undoFile(idx.file);
				if (entry.undo) await adapter.write(f, JSON.stringify(entry.undo));
				else if (await adapter.exists(f)) await adapter.remove(f);
			}
		});
	}

	private persistIndex(): Promise<void> {
		return this.queue("index", async () => {
			await this.ensureDir();
			await this.app.vault.adapter.write(`${this.dir}/${INDEX_FILE}`, JSON.stringify(Object.fromEntries(this.index)));
		});
	}

	private async ensureDir(): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.dir))) {
			try {
				await adapter.mkdir(this.dir);
			} catch (e) {
				if (!(await adapter.exists(this.dir))) throw e;
			}
		}
	}

	private indexEntry(csvPath: string): IndexEntry {
		let e = this.index.get(csvPath);
		if (!e) {
			e = { file: hashPath(csvPath), hasUndo: false, snapDirs: [], undoDirs: [] };
			this.index.set(csvPath, e);
		}
		return e;
	}

	private async readJson<T>(path: string): Promise<T | null> {
		try {
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(path))) return null;
			return JSON.parse(await adapter.read(path)) as T;
		} catch (e) {
			console.error("CSV Importer: ignoring unreadable import state", path, e);
			return null;
		}
	}

	private slot(csvPath: string): Loaded {
		let l = this.cache.get(csvPath);
		if (!l) {
			l = { csvPath, snapshot: null, undo: undefined, snapDirty: false, undoDirty: false };
			this.cache.set(csvPath, l);
		}
		return l;
	}

	async loadSnapshot(csvPath: string): Promise<ImportSnapshot> {
		await this.init();
		const l = this.slot(csvPath);
		if (l.snapshot === null) {
			const idx = this.index.get(csvPath);
			const data = idx ? await this.readJson<{ snapshot?: ImportSnapshot }>(this.snapFile(idx.file)) : null;
			l.snapshot ??= data?.snapshot ?? {};
		}
		return l.snapshot;
	}

	async loadUndo(csvPath: string): Promise<UndoManifest | null> {
		await this.init();
		const l = this.slot(csvPath);
		if (l.undo === undefined) {
			const idx = this.index.get(csvPath);
			const data = idx?.hasUndo ? await this.readJson<UndoManifest>(this.undoFile(idx.file)) : null;
			if (l.undo === undefined) l.undo = data;
		}
		return l.undo ?? null;
	}

	/** Loads both parts of a CSV's state. */
	async load(csvPath: string): Promise<{ snapshot: ImportSnapshot; undo: UndoManifest | null }> {
		return { snapshot: await this.loadSnapshot(csvPath), undo: await this.loadUndo(csvPath) };
	}

	async saveSnapshot(csvPath: string, snapshot: ImportSnapshot): Promise<void> {
		await this.init();
		const l = this.slot(csvPath);
		const isNew = !this.index.has(csvPath);
		const idx = this.indexEntry(csvPath);
		const dirs = dirsOf(Object.keys(snapshot));
		const dirsChanged = JSON.stringify(dirs) !== JSON.stringify(idx.snapDirs);
		l.snapshot = snapshot;
		l.snapDirty = true;
		idx.snapDirs = dirs;
		const writes = [this.persist(csvPath)];
		if (dirsChanged || isNew) writes.push(this.persistIndex());
		await Promise.all(writes);
	}

	async saveUndo(csvPath: string, manifest: UndoManifest | null): Promise<void> {
		await this.init();
		const l = this.slot(csvPath);
		const isNew = !this.index.has(csvPath);
		const idx = this.indexEntry(csvPath);
		l.undo = manifest;
		l.undoDirty = true;
		const hasUndo = manifest !== null;
		const dirs = dirsOf(undoPaths(manifest));
		const changed = isNew || idx.hasUndo !== hasUndo || JSON.stringify(dirs) !== JSON.stringify(idx.undoDirs);
		idx.hasUndo = hasUndo;
		idx.undoDirs = dirs;
		const writes = [this.persist(csvPath)];
		if (changed) writes.push(this.persistIndex());
		await Promise.all(writes);
	}

	/** Synchronous, from the index (needs init() to have completed). */
	hasUndo(csvPath: string): boolean {
		return this.index.get(csvPath)?.hasUndo === true;
	}

	/** Synchronous; only returns a manifest that has been loaded or saved already. */
	getUndo(csvPath: string): UndoManifest | null {
		return this.cache.get(csvPath)?.undo ?? null;
	}

	async rename(oldCsvPath: string, newCsvPath: string): Promise<void> {
		await this.init();
		if (oldCsvPath === newCsvPath || !this.index.has(oldCsvPath)) return;
		const { snapshot, undo } = await this.load(oldCsvPath);
		const old = this.index.get(oldCsvPath)!;
		this.index.delete(oldCsvPath);
		this.cache.delete(oldCsvPath);
		await this.removeFiles(old.file);
		const moved = undo ? { ...undo, csvPath: newCsvPath } : null;
		this.index.set(newCsvPath, { ...old, file: hashPath(newCsvPath) });
		this.cache.set(newCsvPath, { csvPath: newCsvPath, snapshot, undo: moved, snapDirty: true, undoDirty: moved !== null });
		await Promise.all([this.persist(newCsvPath), this.persistIndex()]);
	}

	async delete(csvPath: string): Promise<void> {
		await this.init();
		const idx = this.index.get(csvPath);
		if (!idx) return;
		this.index.delete(csvPath);
		this.cache.delete(csvPath);
		await this.removeFiles(idx.file);
		await this.persistIndex();
	}

	/** Re-keys snapshot entries and undo references after a note was renamed or moved. */
	async renameNote(oldNotePath: string, newNotePath: string): Promise<void> {
		await this.init();
		const oldDir = parentOf(oldNotePath);
		const newDir = parentOf(newNotePath);
		const pending: Promise<void>[] = [];
		let indexChanged = false;
		for (const [csvPath, idx] of [...this.index]) {
			const snapMaybe = idx.snapDirs === null || idx.snapDirs.includes(oldDir);
			const undoMaybe = idx.hasUndo && (idx.undoDirs === null || idx.undoDirs.includes(oldDir));
			if (!snapMaybe && !undoMaybe) continue;
			const l = this.slot(csvPath);
			if (snapMaybe) {
				const snap = await this.loadSnapshot(csvPath);
				if (Object.prototype.hasOwnProperty.call(snap, oldNotePath)) {
					snap[newNotePath] = snap[oldNotePath];
					delete snap[oldNotePath];
					l.snapDirty = true;
					if (idx.snapDirs && !idx.snapDirs.includes(newDir)) {
						idx.snapDirs.push(newDir);
						indexChanged = true;
					}
				}
			}
			if (undoMaybe) {
				const undo = await this.loadUndo(csvPath);
				if (undo) {
					let hit = undo.created.includes(oldNotePath);
					undo.created = undo.created.map((p) => (p === oldNotePath ? newNotePath : p));
					for (const m of undo.modified) {
						if (m.path === oldNotePath) {
							m.path = newNotePath;
							hit = true;
						}
					}
					if (undo.writtenHashes && Object.prototype.hasOwnProperty.call(undo.writtenHashes, oldNotePath)) {
						undo.writtenHashes[newNotePath] = undo.writtenHashes[oldNotePath];
						delete undo.writtenHashes[oldNotePath];
					}
					if (undo.snapshotBefore && Object.prototype.hasOwnProperty.call(undo.snapshotBefore, oldNotePath)) {
						undo.snapshotBefore[newNotePath] = undo.snapshotBefore[oldNotePath];
						delete undo.snapshotBefore[oldNotePath];
					}
					if (hit) {
						l.undoDirty = true;
						if (idx.undoDirs && !idx.undoDirs.includes(newDir)) {
							idx.undoDirs.push(newDir);
							indexChanged = true;
						}
					}
				}
			}
			if (l.snapDirty || l.undoDirty) pending.push(this.persist(csvPath));
		}
		if (indexChanged) pending.push(this.persistIndex());
		await Promise.all(pending);
	}

	private async removeFiles(file: string): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			for (const f of [this.snapFile(file), this.undoFile(file)]) {
				if (await adapter.exists(f)) await adapter.remove(f);
			}
		} catch (e) {
			console.error("CSV Importer: could not remove import state", e);
		}
	}
}
