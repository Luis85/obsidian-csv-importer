import { normalizePath } from "obsidian";
import type { App } from "obsidian";
import { parentOf } from "./core/util";
import { sanitizeFingerprint, sanitizeLastRun } from "./import/fingerprint";
import type { ImportMeta, ImportSnapshot, UndoManifest } from "./types";

/** Cheap per-CSV entry of imports/index.json: what exists, without reading the (large) state files. */
interface IndexEntry {
	/** Hash used in the file names `<file>.json` (snapshot) and `<file>.undo.json`. */
	file: string;
	hasUndo: boolean;
	/** Folders of the notes in the snapshot / undo manifest, or null when there are too many to list. */
	snapDirs: string[] | null;
	undoDirs: string[] | null;
	/** Fingerprint of the CSV and counts of its last import. Missing for imports from before these were recorded. */
	meta?: ImportMeta;
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
/**
 * Format version of `<hash>.json` and `<hash>.undo.json`. Files without one are version 1 (0.4.1 and earlier); a
 * file from a newer version is not read (treated like an unreadable file) so that it is never misread or overwritten
 * without a warning.
 */
export const STATE_VERSION = 1;
/** Suffix of the copy written before a state file is replaced; read when the file itself is incomplete. */
const TEMP_SUFFIX = ".tmp";
/** Suffix of the copy kept of a state file that could not be read, before it is overwritten. */
const UNREADABLE_SUFFIX = ".unreadable";

/** Which part of a CSV's import state could not be read. */
export type StatePart = "snapshot" | "undo";

/** Thrown by readState for a file this version cannot read. */
class UnreadableState extends Error {}

/** Parses a state file; throws UnreadableState for invalid JSON, a non-object or a newer format version. */
function parseState<T>(text: string): T {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (e) {
		throw new UnreadableState(`invalid JSON (${e instanceof Error ? e.message : String(e)})`);
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new UnreadableState("not an object");
	const version = (data as { version?: unknown }).version;
	if (typeof version === "number" && version > STATE_VERSION) {
		throw new UnreadableState(`written by a newer version of the plugin (format ${version})`);
	}
	return data as T;
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

function sanitizeMeta(raw: unknown): ImportMeta | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const r = raw as Record<string, unknown>;
	const meta: ImportMeta = {};
	const fingerprint = sanitizeFingerprint(r["fingerprint"]);
	const lastRun = sanitizeLastRun(r["lastRun"]);
	if (fingerprint) meta.fingerprint = fingerprint;
	if (lastRun) meta.lastRun = lastRun;
	return meta.fingerprint || meta.lastRun ? meta : undefined;
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

/** Moves every reference to a note in an undo manifest to its new path (in place). Returns true when the note was listed. */
function rekeyUndo(manifest: UndoManifest, oldPath: string, newPath: string): boolean {
	let hit = manifest.created.includes(oldPath);
	manifest.created = manifest.created.map((p) => (p === oldPath ? newPath : p));
	for (const m of manifest.modified) {
		if (m.path === oldPath) {
			m.path = newPath;
			hit = true;
		}
	}
	if (manifest.writtenHashes) rekeyEntry(manifest.writtenHashes, oldPath, newPath);
	if (manifest.snapshotBefore) rekeyEntry(manifest.snapshotBefore, oldPath, newPath);
	return hit;
}

/** Moves the entry of `oldKey` to `newKey` (in place). Returns true when there was one. */
function rekeyEntry<T>(map: Record<string, T>, oldKey: string, newKey: string): boolean {
	if (!Object.prototype.hasOwnProperty.call(map, oldKey)) return false;
	const v = map[oldKey];
	if (v !== undefined) map[newKey] = v;
	delete map[oldKey];
	return true;
}

/** A note rename: old and new path, and their folders. */
interface NoteMove {
	from: string;
	to: string;
	fromDir: string;
	toDir: string;
}

/** Whether a folder list of the index (null: not tracked, anything may be listed) may hold notes in `dir`. */
function mayList(dirs: string[] | null, dir: string): boolean {
	return dirs === null || dirs.includes(dir);
}

/** Adds `dir` to a folder list of the index (null: not tracked). Returns true when the list changed. */
function addDir(dirs: string[] | null, dir: string): boolean {
	if (!dirs || dirs.includes(dir)) return false;
	dirs.push(dir);
	return true;
}

/** An undo manifest without the format version of its file. */
function withoutVersion(data: UndoManifest & { version?: unknown }): UndoManifest {
	const { version: _version, ...manifest } = data;
	return manifest;
}

/** Legacy `<hash>.json` files: not undo files and not the index. */
function isStateFile(path: string): boolean {
	return path.endsWith(".json") && !path.endsWith(".undo.json") && !path.endsWith(`/${INDEX_FILE}`);
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
	/** CSVs whose snapshot or undo file existed but could not be read, until that part is saved again. */
	private unreadable = new Map<string, Set<StatePart>>();

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
				let data: Record<string, Partial<IndexEntry>>;
				try {
					data = JSON.parse(await adapter.read(indexPath)) as Record<string, Partial<IndexEntry>>;
				} catch (e) {
					// Corrupt or half-written index: rebuild it from the state files.
					console.error("CSV Importer: import index is unreadable, rebuilding it", e);
					await this.rebuildIndex();
					return;
				}
				for (const [csvPath, e] of Object.entries(data)) {
					this.index.set(csvPath, {
						file: e.file ?? hashPath(csvPath),
						hasUndo: e.hasUndo === true,
						snapDirs: e.snapDirs === undefined ? null : e.snapDirs,
						undoDirs: e.undoDirs === undefined ? null : e.undoDirs,
						meta: sanitizeMeta(e.meta),
					});
				}
				return;
			}
			await this.migrateLegacy();
		} catch (e) {
			console.error("CSV Importer: could not read stored import state", e);
		}
	}

	/** Rebuilds a corrupt index from the state files (current and old layout alike). */
	private async rebuildIndex(): Promise<void> {
		this.index.clear();
		await this.scanStateFiles();
		await this.flushScanned();
	}

	/** Old layout (no index yet): `<hash>.json` held {csvPath, snapshot, undo}. Reads it and writes the new layout. */
	private async migrateLegacy(): Promise<void> {
		await this.scanStateFiles();
		await this.flushScanned();
	}

	/** Reads every `<hash>.json` in the imports folder into the index and the cache (marked dirty). */
	private async scanStateFiles(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const listing = await adapter.list(this.dir);
		for (const path of listing.files.filter(isStateFile)) {
			try {
				const data = parseState<{
					csvPath?: string;
					snapshot?: ImportSnapshot;
					undo?: UndoManifest | null;
				}>(await adapter.read(path));
				if (typeof data.csvPath !== "string") continue;
				let undo = data.undo ?? null;
				if (!undo) undo = (await this.readUndoFile(data.csvPath)) ?? undo;
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
	}

	/** The separate `<hash>.undo.json` of a CSV, or null when there is none. */
	private async readUndoFile(csvPath: string): Promise<UndoManifest | null> {
		return this.readState<UndoManifest>(csvPath, "undo", this.undoFile(hashPath(csvPath)));
	}

	/** Writes the scanned state files and the index in the new layout. */
	private async flushScanned(): Promise<void> {
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
			if (entry.snapDirty) {
				entry.snapDirty = false;
				try {
					await this.writeState(this.snapFile(idx.file), { version: STATE_VERSION, csvPath, snapshot: entry.snapshot ?? {} });
				} catch (e) {
					entry.snapDirty = true; // retried by the next save
					throw e;
				}
			}
			if (entry.undoDirty) {
				entry.undoDirty = false;
				try {
					const f = this.undoFile(idx.file);
					if (entry.undo) await this.writeState(f, { ...entry.undo, version: STATE_VERSION });
					else await this.removeState(f);
				} catch (e) {
					entry.undoDirty = true;
					throw e;
				}
			}
		});
	}

	/**
	 * Replaces a state file so that a crash or a full disk never leaves only a half-written copy: the new content is
	 * first written to `<file>.tmp`, then to the file, then the temporary copy is removed. readState falls back to
	 * the temporary copy when the file itself cannot be read.
	 */
	private async writeState(path: string, data: object): Promise<void> {
		const adapter = this.app.vault.adapter;
		const text = JSON.stringify(data);
		await adapter.write(path + TEMP_SUFFIX, text);
		await adapter.write(path, text);
		await adapter.remove(path + TEMP_SUFFIX);
	}

	private async removeState(path: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		for (const f of [path, path + TEMP_SUFFIX]) if (await adapter.exists(f)) await adapter.remove(f);
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

	/**
	 * Reads a state file, or its temporary copy when the file is missing or unreadable (a write was interrupted).
	 * Returns null when neither exists. When one exists but neither can be read, the CSV's part is marked
	 * unreadable (see unreadableState), a copy of the file is kept as `<file>.unreadable`, and null is returned.
	 */
	private async readState<T>(csvPath: string, part: StatePart, path: string): Promise<T | null> {
		const adapter = this.app.vault.adapter;
		let failure: unknown = null;
		for (const f of [path, path + TEMP_SUFFIX]) {
			try {
				if (!(await adapter.exists(f))) continue;
				return parseState<T>(await adapter.read(f));
			} catch (e) {
				failure ??= e;
			}
		}
		if (failure === null) return null;
		console.error("CSV Importer: could not read import state", path, failure);
		this.markUnreadable(csvPath, part);
		await this.keepUnreadableCopy(path);
		return null;
	}

	private markUnreadable(csvPath: string, part: StatePart): void {
		let parts = this.unreadable.get(csvPath);
		if (!parts) this.unreadable.set(csvPath, (parts = new Set()));
		parts.add(part);
	}

	/** Copies an unreadable state file to `<file>.unreadable`, so the next save does not destroy it. */
	private async keepUnreadableCopy(path: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		try {
			if (await adapter.exists(path)) await adapter.write(path + UNREADABLE_SUFFIX, await adapter.read(path));
		} catch (e) {
			console.error("CSV Importer: could not keep a copy of unreadable import state", path, e);
		}
	}

	/**
	 * The parts of a CSV's import state that existed but could not be read (corrupt, or from a newer version of the
	 * plugin) since they were last saved. Without the snapshot, values edited in Obsidian are not recognized as edits.
	 */
	unreadableState(csvPath: string): StatePart[] {
		return [...(this.unreadable.get(csvPath) ?? [])];
	}

	private clearUnreadable(csvPath: string, part: StatePart): void {
		const parts = this.unreadable.get(csvPath);
		parts?.delete(part);
		if (parts?.size === 0) this.unreadable.delete(csvPath);
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
			const file = this.index.get(csvPath)?.file ?? hashPath(csvPath);
			const data = await this.readState<{ snapshot?: ImportSnapshot }>(csvPath, "snapshot", this.snapFile(file));
			l.snapshot ??= data?.snapshot ?? {};
		}
		return l.snapshot;
	}

	async loadUndo(csvPath: string): Promise<UndoManifest | null> {
		await this.init();
		const l = this.slot(csvPath);
		if (l.undo === undefined) {
			const idx = this.index.get(csvPath);
			const data = !idx || idx.hasUndo ? await this.readState<UndoManifest>(csvPath, "undo", this.undoFile(idx?.file ?? hashPath(csvPath))) : null;
			if (l.undo === undefined) l.undo = data === null ? null : withoutVersion(data);
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
		this.clearUnreadable(csvPath, "snapshot");
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
		this.clearUnreadable(csvPath, "undo");
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
	getMeta(csvPath: string): ImportMeta | undefined {
		return this.index.get(csvPath)?.meta;
	}

	/** Records the fingerprint and/or last-run counts of a CSV (merged over what is stored). */
	async setMeta(csvPath: string, meta: ImportMeta): Promise<void> {
		await this.init();
		const idx = this.indexEntry(csvPath);
		idx.meta = { ...idx.meta, ...meta };
		await this.persistIndex();
	}

	/** Synchronous, from the index (needs init() to have completed). */
	hasUndo(csvPath: string): boolean {
		return this.index.get(csvPath)?.hasUndo === true;
	}

	async rename(oldCsvPath: string, newCsvPath: string): Promise<void> {
		await this.init();
		if (oldCsvPath === newCsvPath || !this.index.has(oldCsvPath)) return;
		const { snapshot, undo } = await this.load(oldCsvPath);
		const old = this.index.get(oldCsvPath)!;
		this.index.delete(oldCsvPath);
		this.cache.delete(oldCsvPath);
		const unreadable = this.unreadable.get(oldCsvPath);
		this.unreadable.delete(oldCsvPath);
		if (unreadable) this.unreadable.set(newCsvPath, unreadable);
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
		this.unreadable.delete(csvPath);
		await this.removeFiles(idx.file);
		await this.persistIndex();
	}

	/** Forgets the snapshot and undo state of a CSV but keeps it as a known (empty) entry. */
	async clearImportState(csvPath: string): Promise<void> {
		await this.init();
		await this.saveUndo(csvPath, null);
		await this.saveSnapshot(csvPath, {});
		const idx = this.index.get(csvPath);
		if (idx?.meta) {
			delete idx.meta;
			await this.persistIndex();
		}
	}

	/** Re-keys snapshot entries and undo references after a note was renamed or moved. */
	async renameNote(oldNotePath: string, newNotePath: string): Promise<void> {
		await this.init();
		const move: NoteMove = { from: oldNotePath, to: newNotePath, fromDir: parentOf(oldNotePath), toDir: parentOf(newNotePath) };
		const pending: Promise<void>[] = [];
		let indexChanged = false;
		for (const [csvPath, idx] of [...this.index]) {
			if (await this.rekeyNoteOf(csvPath, idx, move, pending)) indexChanged = true;
		}
		if (indexChanged) pending.push(this.persistIndex());
		await Promise.all(pending);
	}

	/**
	 * Re-keys a renamed note in the snapshot and undo manifest of one CSV, when its folder lists say they may hold it,
	 * and adds the save of a changed state to `pending`. Returns true when the index's folder lists changed.
	 */
	private async rekeyNoteOf(csvPath: string, idx: IndexEntry, move: NoteMove, pending: Promise<void>[]): Promise<boolean> {
		const snapMaybe = mayList(idx.snapDirs, move.fromDir);
		const undoMaybe = idx.hasUndo && mayList(idx.undoDirs, move.fromDir);
		if (!snapMaybe && !undoMaybe) return false;
		const l = this.slot(csvPath);
		const snapDirsChanged = snapMaybe && (await this.rekeySnapshotOf(csvPath, l, idx, move));
		const undoDirsChanged = undoMaybe && (await this.rekeyUndoOf(csvPath, l, idx, move));
		if (l.snapDirty || l.undoDirty) pending.push(this.persist(csvPath));
		return snapDirsChanged || undoDirsChanged;
	}

	/** Re-keys a renamed note in the snapshot of `csvPath`. Returns true when the index's snapshot folders changed. */
	private async rekeySnapshotOf(csvPath: string, l: Loaded, idx: IndexEntry, move: NoteMove): Promise<boolean> {
		if (!rekeyEntry(await this.loadSnapshot(csvPath), move.from, move.to)) return false;
		l.snapDirty = true;
		return addDir(idx.snapDirs, move.toDir);
	}

	/** Re-keys a renamed note in the undo manifest of `csvPath`. Returns true when the index's undo folders changed. */
	private async rekeyUndoOf(csvPath: string, l: Loaded, idx: IndexEntry, move: NoteMove): Promise<boolean> {
		const undo = await this.loadUndo(csvPath);
		if (undo === null || !rekeyUndo(undo, move.from, move.to)) return false;
		l.undoDirty = true;
		return addDir(idx.undoDirs, move.toDir);
	}

	/** Drops a deleted note from every snapshot that lists it. */
	async deleteNote(notePath: string): Promise<void> {
		await this.init();
		const dir = parentOf(notePath);
		const pending: Promise<void>[] = [];
		for (const [csvPath, idx] of [...this.index]) {
			if (idx.snapDirs !== null && !idx.snapDirs.includes(dir)) continue;
			const snap = await this.loadSnapshot(csvPath);
			if (!Object.prototype.hasOwnProperty.call(snap, notePath)) continue;
			delete snap[notePath];
			this.slot(csvPath).snapDirty = true;
			pending.push(this.persist(csvPath));
		}
		await Promise.all(pending);
	}

	private async removeFiles(file: string): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			for (const base of [this.snapFile(file), this.undoFile(file)]) {
				for (const f of [base, base + TEMP_SUFFIX]) if (await adapter.exists(f)) await adapter.remove(f);
			}
		} catch (e) {
			console.error("CSV Importer: could not remove import state", e);
		}
	}
}
