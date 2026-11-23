import { normalizePath, TFile, TFolder } from "obsidian";
import type { App, TAbstractFile } from "obsidian";
import type {
	FileImportConfig,
	FrontmatterValue,
	ImportResult,
	ImportSnapshot,
	PlannedNote,
	RowOutcome,
	UndoManifest,
} from "../types";
import { mergeFrontmatter, valueHash } from "./merge";
import { formatValue, ownedLinkProperties, serializeNote, sourceLinkProperty } from "./noteBuilder";

/** Time budget between two yields to the UI. */
const SLICE_MS = 12;
/** Checkpoint (persist snapshot + undo) after this many written rows, at most every CHECKPOINT_MIN_MS. */
const CHECKPOINT_ROWS = 200;
const CHECKPOINT_MIN_MS = 2000;
/** Never checkpoint more often than this, not even the early one after the first written note. */
const CHECKPOINT_FLOOR_MS = 500;
/** Maximum total size of previous note contents kept for undo. */
export const UNDO_CAP_CHARS = 20 * 1024 * 1024;

export const KEY_WARNING =
	"No key column: notes are matched by file name. If rows are inserted or re-sorted, the wrong notes are updated. Choose a key column in the import settings.";
export const NOT_OWNED_WARNING =
	'Some notes were skipped because this import did not create them. If you created them with an earlier version or another tool, turn on "Update existing notes not created by this import" in the import settings.';
export const UNDO_TRUNCATED_WARNING = "The import is too large to undo completely.";

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

let channel: MessageChannel | null = null;
/** Yields to the event loop (UI, input) without the 4 ms clamp of nested timers. */
function yieldToUi(): Promise<void> {
	if (typeof MessageChannel === "undefined") return new Promise((resolve) => window.setTimeout(resolve, 0));
	return new Promise((resolve) => {
		channel ??= new MessageChannel();
		const c = channel;
		c.port1.onmessage = () => {
			c.port1.onmessage = null;
			resolve();
		};
		c.port2.postMessage(null);
	});
}

function parentOf(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? "" : path.slice(0, i);
}

function collectMarkdown(folder: TFolder, out: TFile[]): void {
	for (const child of folder.children) {
		if (child instanceof TFile) {
			if (child.extension.toLowerCase() === "md") out.push(child);
		} else if (child instanceof TFolder) {
			collectMarkdown(child, out);
		}
	}
}

function isEmptyValue(v: unknown): boolean {
	return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/** "[[Data/x.csv|alias]]" / "Data/X" -> "data/x" for comparing links to the CSV. */
function normalizeLink(v: unknown): string | null {
	if (typeof v !== "string") return null;
	let s = v.trim();
	if (s.startsWith("[[") && s.endsWith("]]")) s = s.slice(2, -2);
	const bar = s.indexOf("|");
	if (bar >= 0) s = s.slice(0, bar);
	const hash = s.indexOf("#");
	if (hash >= 0) s = s.slice(0, hash);
	s = normalizePath(s.trim()).toLowerCase();
	return s.endsWith(".csv") ? s.slice(0, -4) : s;
}

/**
 * Snapshot after undoing a run: entries of created notes are dropped; modified notes get the entry they had
 * before the run back (or none if they had none). Manifests without `snapshotBefore` drop modified entries.
 * Paths in `skip` (left as they are because they changed after the import) keep their entries.
 */
export function applyUndoToSnapshot(snapshot: ImportSnapshot, manifest: UndoManifest, skip?: ReadonlySet<string>): ImportSnapshot {
	const out: ImportSnapshot = {};
	for (const [p, v] of Object.entries(snapshot)) out[p] = { ...v };
	for (const p of manifest.created) if (!skip?.has(p)) delete out[p];
	for (const m of manifest.modified) {
		if (skip?.has(m.path)) continue;
		const before = manifest.snapshotBefore;
		if (before && Object.prototype.hasOwnProperty.call(before, m.path)) out[m.path] = { ...before[m.path] };
		else delete out[m.path];
	}
	return out;
}

export interface UndoOutcome {
	trashed: number;
	restored: number;
	failed: number;
	/** Notes changed after the import; left as they are. */
	changed: string[];
}

/** Reverts an import: trashes created notes, restores modified ones. Notes edited since the import are skipped. */
export async function applyUndo(app: App, manifest: UndoManifest): Promise<UndoOutcome> {
	const out: UndoOutcome = { trashed: 0, restored: 0, failed: 0, changed: [] };
	const hashes = manifest.writtenHashes;
	const unchanged = async (file: TFile): Promise<boolean> => {
		const expected = hashes?.[file.path];
		if (expected === undefined) return true;
		return valueHash(await app.vault.read(file)) === expected;
	};
	for (const path of manifest.created) {
		try {
			const f = app.vault.getAbstractFileByPath(path);
			if (!(f instanceof TFile)) continue;
			if (!(await unchanged(f))) {
				out.changed.push(path);
				continue;
			}
			await app.fileManager.trashFile(f);
			out.trashed++;
		} catch (e) {
			out.failed++;
			console.error("CSV Importer: could not trash note", path, e);
		}
	}
	for (const m of manifest.modified) {
		try {
			const f = app.vault.getAbstractFileByPath(m.path);
			if (!(f instanceof TFile)) continue;
			if (!(await unchanged(f))) {
				out.changed.push(m.path);
				continue;
			}
			await app.vault.process(f, () => m.content);
			out.restored++;
		} catch (e) {
			out.failed++;
			console.error("CSV Importer: could not restore note", m.path, e);
		}
	}
	return out;
}

export interface WriteOptions {
	/** Compute outcomes without writing anything or changing the snapshot. */
	dryRun?: boolean;
	/** Hashes of the last imported values per note path (from a previous run). */
	snapshot?: ImportSnapshot;
	/** Called once per yield to the UI and once at the end. */
	onProgress?: (done: number, total: number) => void;
	/** Checked between rows; returning true stops the run (result.cancelled = true). */
	shouldStop?: () => boolean;
	/** Parser warnings, passed through to result.warnings. */
	warnings?: string[];
	/** Called every ~200 written rows and when the run is stopped, so state survives a crash. Real runs only. */
	onCheckpoint?: (snapshot: ImportSnapshot, undo: UndoManifest) => void | Promise<void>;
	/** Cap for the previous contents kept for undo (characters). Default UNDO_CAP_CHARS. */
	undoCap?: number;
}

export interface WriteOutput {
	result: ImportResult;
	snapshot: ImportSnapshot;
	undo: UndoManifest;
}

function plannedSnapshot(note: PlannedNote): Record<string, string> {
	const out: Record<string, string> = {};
	for (const key of Object.keys(note.types)) out[key] = valueHash(note.frontmatter[key] ?? null);
	return out;
}

/**
 * Writes planned notes into the vault honoring the conflict strategy.
 *
 * Ownership: an existing note (found by key or by path) is only updated or overwritten when this import owns it:
 * it has an entry in the snapshot, or its source link points at this CSV, or config.adoptExistingNotes is on.
 * Other notes are skipped ("not created by this import"); with "rename" a copy is created instead.
 *
 * When notes carry a `key`, existing notes are matched by that property's value (within the target folders,
 * recursively) regardless of their path. A path match whose note has a different key belongs to another record
 * and is never merged. Without a match, existing notes are detected by path (case-insensitive). Duplicate keys
 * inside one run: the first row wins, later rows are skipped. Two rows planning the same path: the later one
 * gets a free suffixed path.
 *
 * "update" merges per property (see mergeFrontmatter): properties added in Obsidian are never touched,
 * edited values are kept when protectEdits is on, and the body is never changed.
 */
export async function writeNotes(
	app: App,
	notes: PlannedNote[],
	config: FileImportConfig,
	opts: WriteOptions = {},
): Promise<WriteOutput> {
	const dryRun = opts.dryRun === true;
	const result: ImportResult = {
		created: 0,
		updated: 0,
		unchanged: 0,
		skipped: 0,
		failed: 0,
		cancelled: false,
		dryRun,
		rows: [],
		warnings: [...(opts.warnings ?? [])],
		errors: [],
	};
	const snapshot: ImportSnapshot = {};
	for (const [p, v] of Object.entries(opts.snapshot ?? {})) snapshot[p] = { ...v };
	const hadPreviousImport = Object.keys(snapshot).length > 0;
	const undo: UndoManifest = {
		csvPath: "",
		timestamp: Date.now(),
		created: [],
		modified: [],
		snapshotBefore: {},
		writtenHashes: {},
	};
	const undoCap = opts.undoCap ?? UNDO_CAP_CHARS;
	let undoChars = 0;
	let undoTruncated = false;
	const touched = new Set<string>();
	/** Lower-cased paths written or merged by this run. */
	const claimed = new Set<string>();
	const total = notes.length;
	const linkProperty = sourceLinkProperty(config);

	if (!config.keyColumn && (config.conflict === "update" || config.conflict === "overwrite") && hadPreviousImport) {
		result.warnings.push(KEY_WARNING);
	}

	// --- case-insensitive lookups ---
	const childMaps = new Map<string, Map<string, TAbstractFile>>();
	const childMap = (folderPath: string): Map<string, TAbstractFile> | null => {
		let m = childMaps.get(folderPath);
		if (m) return m;
		const folder = folderPath === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) return null;
		m = new Map();
		for (const c of folder.children) {
			const k = c.name.toLowerCase();
			if (!m.has(k)) m.set(k, c);
		}
		childMaps.set(folderPath, m);
		return m;
	};
	const lookup = (path: string): TAbstractFile | null => {
		const exact = app.vault.getAbstractFileByPath(path);
		if (exact) return exact;
		const i = path.lastIndexOf("/");
		return childMap(i < 0 ? "" : path.slice(0, i))?.get(path.slice(i + 1).toLowerCase()) ?? null;
	};
	/** Folder path with the casing of the folders that already exist. */
	const resolveFolder = (folder: string): string => {
		let current = "";
		const parts = folder.split("/").filter((p) => p.length > 0);
		for (let i = 0; i < parts.length; i++) {
			const next = current ? `${current}/${parts[i]}` : parts[i];
			const found = lookup(next);
			if (found instanceof TFolder) current = found.path;
			else return [next, ...parts.slice(i + 1)].join("/");
		}
		return current;
	};
	const resolvePath = (path: string): string => {
		const parent = resolveFolder(parentOf(path));
		const name = path.slice(path.lastIndexOf("/") + 1);
		return parent ? `${parent}/${name}` : name;
	};
	const knownFolders = new Set<string>();
	const ensureFolder = async (folder: string): Promise<void> => {
		if (!folder || knownFolders.has(folder)) return;
		let current = "";
		for (const part of folder.split("/").filter((p) => p.length > 0)) {
			current = current ? `${current}/${part}` : part;
			if (knownFolders.has(current)) continue;
			if (!app.vault.getAbstractFileByPath(current)) {
				try {
					await app.vault.createFolder(current);
					childMaps.clear();
				} catch (e) {
					// Might have been created concurrently.
					if (!app.vault.getAbstractFileByPath(current)) throw e;
				}
			}
			knownFolders.add(current);
		}
	};

	// --- key index ---
	const keyProperty = notes.find((n) => n.key)?.key?.property ?? null;
	const keyIndex = new Map<string, TFile[]>();
	if (keyProperty) {
		try {
			const folders = new Set(notes.map((n) => resolveFolder(parentOf(normalizePath(n.path)))));
			const files: TFile[] = [];
			for (const folder of folders) {
				const f = folder === "" || folder === "/" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(folder);
				if (f instanceof TFolder) collectMarkdown(f, files);
			}
			const seen = new Set<string>();
			for (const file of files) {
				if (seen.has(file.path)) continue;
				seen.add(file.path);
				const v: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[keyProperty];
				if (v === undefined || v === null || Array.isArray(v) || typeof v === "object") continue;
				const key = formatValue(v as FrontmatterValue);
				const list = keyIndex.get(key);
				if (list) list.push(file);
				else keyIndex.set(key, [file]);
			}
		} catch (e) {
			console.error("CSV Importer: could not index existing notes", e);
		}
	}
	const seenKeys = new Set<string>();

	const record = (o: RowOutcome): void => {
		result.rows.push(o);
		if (o.outcome === "created") result.created++;
		else if (o.outcome === "updated") result.updated++;
		else if (o.outcome === "unchanged") result.unchanged++;
		else if (o.outcome === "skipped") result.skipped++;
		else result.failed++;
	};
	const remember = async (file: TFile): Promise<void> => {
		if (touched.has(file.path)) return;
		touched.add(file.path);
		const text = await app.vault.read(file);
		if (undoTruncated || undoChars + text.length > undoCap) {
			undoTruncated = true;
			return;
		}
		undoChars += text.length;
		undo.modified.push({ path: file.path, content: text });
		if (Object.prototype.hasOwnProperty.call(snapshot, file.path)) {
			(undo.snapshotBefore ??= {})[file.path] = { ...snapshot[file.path] };
		}
	};
	const free = (path: string): string => {
		const dot = path.lastIndexOf(".");
		const base = dot < 0 ? path : path.slice(0, dot);
		const ext = dot < 0 ? "" : path.slice(dot);
		for (let n = 1; n < 100000; n++) {
			const c = `${base} ${n}${ext}`;
			if (!lookup(c) && !claimed.has(c.toLowerCase())) return c;
		}
		throw new Error("No free file name found");
	};
	const isTaken = (path: string): boolean => lookup(path) !== null || claimed.has(path.toLowerCase());

	const createNote = async (note: PlannedNote, target: string): Promise<void> => {
		if (!dryRun) {
			await ensureFolder(parentOf(target));
			const text = serializeNote(note.frontmatter, note.body, note.types);
			const created = await app.vault.create(target, text);
			undo.created.push(created.path);
			(undo.writtenHashes ??= {})[created.path] = valueHash(text);
			touched.add(created.path);
			snapshot[created.path] = plannedSnapshot(note);
			if (note.key) {
				const list = keyIndex.get(note.key.value);
				if (list) list.unshift(created);
				else keyIndex.set(note.key.value, [created]);
			}
			childMaps.get(parentOf(created.path))?.set(created.name.toLowerCase(), created);
		}
		claimed.add(target.toLowerCase());
		record({
			row: note.row,
			path: target,
			outcome: "created",
			reason: dryRun ? "would create" : undefined,
			changed: Object.keys(note.frontmatter),
		});
	};

	const owns = (file: TFile, note: PlannedNote): boolean => {
		if (config.adoptExistingNotes) return true;
		if (Object.prototype.hasOwnProperty.call(snapshot, file.path)) return true;
		if (!linkProperty) return false;
		const planned = normalizeLink(note.frontmatter[linkProperty]);
		if (planned === null) return false;
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		return ownedProps.some((p) => normalizeLink(fm?.[p]) === planned);
	};
	const ownedProps = ownedLinkProperties(config);
	let skippedNotOwned = 0;
	const hasOtherKey = (file: TFile, note: PlannedNote): boolean => {
		if (!note.key) return false;
		const v: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[note.key.property];
		if (isEmptyValue(v) || Array.isArray(v) || typeof v === "object") return false;
		return formatValue(v as FrontmatterValue) !== note.key.value;
	};

	let lastYield = now();
	let lastCheckpoint = now();
	let sinceCheckpoint = 0;
	let checkpointed = false;
	let pendingCheckpoint: Promise<unknown> = Promise.resolve();
	const checkpoint = async (wait: boolean): Promise<void> => {
		if (dryRun || !opts.onCheckpoint) return;
		checkpointed = true;
		sinceCheckpoint = 0;
		lastCheckpoint = now();
		// Chained so checkpoints never overlap, and awaited before returning so a late one cannot
		// overwrite the caller's final save.
		const cb = opts.onCheckpoint;
		const p = pendingCheckpoint.then(() => cb(snapshot, undo)).catch(() => undefined); // best effort; the final save reports problems
		pendingCheckpoint = p;
		if (wait) await p;
	};
	const afterRow = async (done: number, wrote: number): Promise<void> => {
		sinceCheckpoint += wrote;
		const since = now() - lastCheckpoint;
		const first = !checkpointed && wrote > 0;
		if (first || (since >= CHECKPOINT_FLOOR_MS && sinceCheckpoint > 0 && (sinceCheckpoint >= CHECKPOINT_ROWS || since >= CHECKPOINT_MIN_MS))) {
			await checkpoint(false);
		}
		if (now() - lastYield > SLICE_MS) {
			opts.onProgress?.(done, total);
			await yieldToUi();
			lastYield = now();
		}
	};

	let done = 0;
	for (let i = 0; i < total; i++) {
		if (opts.shouldStop?.()) {
			result.cancelled = true;
			break;
		}
		const note = notes[i];
		const written0 = result.created + result.updated;
		const path = resolvePath(normalizePath(note.path));
		try {
			let keyMatch: TFile | null = null;
			if (note.key) {
				if (seenKeys.has(note.key.value)) {
					record({ row: note.row, path, outcome: "skipped", reason: "duplicate key" });
					result.errors.push({ row: note.row, message: `duplicate key "${note.key.value}"` });
					done = i + 1;
					await afterRow(done, 0);
					continue;
				}
				seenKeys.add(note.key.value);
				// Only a note this import owns counts as the existing note for this key; foreign notes sharing
				// the key (hand-made, or created by another CSV) never shadow it.
				keyMatch = (keyIndex.get(note.key.value) ?? []).find((f) => owns(f, note)) ?? null;
			}

			let existing: TFile | null = keyMatch;
			let copy = false;
			if (!existing) {
				if (claimed.has(path.toLowerCase())) {
					copy = true; // another row of this run already wrote this name
				} else {
					const atPath = lookup(path);
					if (atPath && !(atPath instanceof TFile)) throw new Error(`"${path}" exists and is a folder`);
					existing = atPath;
				}
			}
			const copyPath = (): string => (isTaken(path) ? free(path) : path);

			if (copy) {
				await createNote(note, free(path));
			} else if (!existing) {
				await createNote(note, path);
			} else if (!owns(existing, note)) {
				if (config.conflict === "rename") await createNote(note, copyPath());
				else {
					skippedNotOwned++;
					record({ row: note.row, path: existing.path, outcome: "skipped", reason: "not created by this import" });
				}
			} else if (!keyMatch && hasOtherKey(existing, note)) {
				if (config.conflict === "rename") await createNote(note, copyPath());
				else record({ row: note.row, path: existing.path, outcome: "skipped", reason: "file name taken by another record" });
			} else {
				const strategy = keyMatch && config.conflict === "rename" ? "update" : config.conflict;
				switch (strategy) {
					case "skip":
						record({ row: note.row, path: existing.path, outcome: "skipped", reason: "already exists" });
						break;
					case "overwrite": {
						claimed.add(existing.path.toLowerCase());
						const next = serializeNote(note.frontmatter, note.body, note.types);
						const current = await app.vault.read(existing);
						if (next === current) {
							record({ row: note.row, path: existing.path, outcome: "unchanged" });
						} else {
							if (!dryRun) {
								await remember(existing);
								await app.vault.process(existing, () => next);
								(undo.writtenHashes ??= {})[existing.path] = valueHash(next);
								snapshot[existing.path] = plannedSnapshot(note);
							}
							record({ row: note.row, path: existing.path, outcome: "updated", changed: Object.keys(note.frontmatter) });
						}
						break;
					}
					case "update": {
						claimed.add(existing.path.toLowerCase());
						const current = (app.metadataCache.getFileCache(existing)?.frontmatter ?? {}) as Record<string, unknown>;
						const merged = mergeFrontmatter({
							existing: current,
							planned: note.frontmatter,
							managed: Object.keys(note.types),
							snapshot: snapshot[existing.path],
							protectEdits: config.protectEdits,
							keepValuesOnEmpty: config.keepValuesOnEmpty,
						});
						const changed = Object.keys(merged.set);
						const preserved = merged.preserved.length > 0 ? merged.preserved : undefined;
						if (changed.length === 0) {
							if (!dryRun) snapshot[existing.path] = merged.snapshot;
							record({ row: note.row, path: existing.path, outcome: "unchanged", preserved });
						} else {
							if (!dryRun) {
								await remember(existing);
								await app.fileManager.processFrontMatter(existing, (fm: Record<string, unknown>) => {
									for (const [k, v] of Object.entries(merged.set)) fm[k] = v;
								});
								(undo.writtenHashes ??= {})[existing.path] = valueHash(await app.vault.read(existing));
								snapshot[existing.path] = merged.snapshot;
							}
							record({ row: note.row, path: existing.path, outcome: "updated", changed, preserved });
						}
						break;
					}
					case "rename":
						await createNote(note, free(path));
						break;
				}
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			record({ row: note.row, path, outcome: "failed", reason: message });
			result.errors.push({ row: note.row, message });
		}
		done = i + 1;
		await afterRow(done, result.created + result.updated - written0);
	}
	if (skippedNotOwned > 0 && result.updated + result.unchanged === 0) result.warnings.push(NOT_OWNED_WARNING);
	if (result.cancelled) await checkpoint(true);
	await pendingCheckpoint;
	opts.onProgress?.(done, total);
	if (undoTruncated && !dryRun) {
		(undo as UndoManifest & { truncated?: boolean }).truncated = true;
		result.warnings.push(UNDO_TRUNCATED_WARNING);
	}
	return { result, snapshot: dryRun ? { ...(opts.snapshot ?? {}) } : snapshot, undo };
}
