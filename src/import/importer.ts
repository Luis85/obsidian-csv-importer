import { normalizePath } from "obsidian";
import type { App, TFile } from "obsidian";
import { ROW_REASON, emptyResult } from "../core/result";
import { errorMessage, parentOf, plural } from "../core/util";
import type { FileImportConfig, FrontmatterValue, ImportResult, ImportSnapshot, PlannedNote, RowOutcome, UndoManifest } from "../types";
import { Checkpointer } from "./checkpointer";
import { mergeFrontmatter, valueHash } from "./merge";
import { effectiveKeyColumns, extraPropertyConflicts, formatValue, ownedLinkProperties, serializeNote, sourceLinkProperty } from "./noteBuilder";
import { hasOtherKey, isOwned } from "./ownership";
import { PathIndex } from "./pathIndex";
import { UNDO_CAP_CHARS, UNDO_TRUNCATED_WARNING, UndoRecorder } from "./undo";
import { isFile, ObsidianVaultGateway } from "./vaultGateway";
import type { VaultGateway } from "./vaultGateway";

export { applyUndo, applyUndoToSnapshot, UNDO_TRUNCATED_WARNING } from "./undo";

/** Time budget between two yields to the UI. */
const SLICE_MS = 12;

export const KEY_WARNING =
	"No key column: notes are matched by file name. If rows are inserted or re-sorted, the wrong notes are updated. Choose a key column in the import settings.";
const NOT_OWNED_WARNING =
	'Some notes were skipped because this import did not create them. If you created them with an earlier version or another tool, turn on "Update existing notes not created by this import" in the import settings.';

const LARGE_IMPORT_THRESHOLD = 5000;
const DUPLICATE_KEYS_IN_CSV_WARNING = (n: number, example: string): string =>
	`${plural(n, "row shares", "rows share")} a key with another row (e.g. "${example}"). Only the first is imported.`;
const DUPLICATE_NOTES_IN_VAULT_WARNING = (n: number, example: string): string =>
	`${plural(n, "note in the target folder shares", "notes in the target folder share")} a key with another note (e.g. "${example}"), for example sync conflict copies. Check them before importing.`;
const LARGE_IMPORT_WARNING = (n: number): string =>
	`This import creates or updates ${n} notes. Very large numbers of notes can slow down the vault and Bases.`;
export const ROW_FILTER_WARNING = (matching: number, total: number): string => `Row filter: ${matching} of ${total} rows are imported.`;
const EXTRA_PROPERTY_CONFLICT_WARNING = (name: string): string =>
	`Extra property "${name}" has the same name as a CSV column and is ignored.`;
export const HISTORY_NOT_SAVED_WARNING =
	"The notes were written, but the import history could not be saved. Undo and edit protection may not work for this import.";

const CONFLICT_COPY = /\(conflicted copy|\.sync-conflict-|conflict\)/i;
const isConflictCopy = (f: TFile): boolean => CONFLICT_COPY.test(f.basename ?? f.path);

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

/** Existing notes by the value of the key property, searched in the target folders (recursively). */
class KeyIndex {
	private readonly byKey = new Map<string, TFile[]>();

	constructor(
		private readonly vault: VaultGateway,
		property: string | null,
		notes: PlannedNote[],
		paths: PathIndex,
	) {
		if (property) this.build(property, notes, paths);
	}

	private build(property: string, notes: PlannedNote[], paths: PathIndex): void {
		try {
			const folders = new Set(notes.map((n) => paths.resolveFolder(parentOf(normalizePath(n.path)))));
			const seen = new Set<string>();
			for (const folder of folders) {
				for (const file of this.vault.listMarkdown(folder)) {
					if (seen.has(file.path)) continue;
					seen.add(file.path);
					const v: unknown = this.vault.frontmatter(file)?.[property];
					if (v === undefined || v === null || Array.isArray(v) || typeof v === "object") continue;
					this.add(formatValue(v as FrontmatterValue), file, false);
				}
			}
		} catch (e) {
			console.error("CSV Importer: could not index existing notes", e);
		}
	}

	candidates(key: string): readonly TFile[] {
		return this.byKey.get(key) ?? [];
	}

	/** Number of notes sharing a key value with another note, and one example value, for the given keys. */
	duplicates(keys: Iterable<string>): { count: number; example: string } | null {
		let count = 0;
		let example = "";
		for (const k of new Set(keys)) {
			const n = this.byKey.get(k)?.length ?? 0;
			if (n < 2) continue;
			count += n;
			if (!example) example = k;
		}
		return count > 0 ? { count, example } : null;
	}

	add(key: string, file: TFile, first: boolean): void {
		const list = this.byKey.get(key);
		if (!list) this.byKey.set(key, [file]);
		else if (first) list.unshift(file);
		else list.push(file);
	}
}

/** One write run: carries the state shared by the per-row steps. */
class NoteWriter {
	readonly result: ImportResult;
	readonly snapshot: ImportSnapshot = {};
	readonly undo: UndoRecorder;
	private readonly paths: PathIndex;
	private readonly keys: KeyIndex;
	private readonly seenKeys = new Set<string>();
	private readonly dryRun: boolean;
	private readonly linkProperty: string | null;
	private readonly ownedProps: string[];
	skippedNotOwned = 0;

	constructor(
		private readonly vault: VaultGateway,
		notes: PlannedNote[],
		private readonly config: FileImportConfig,
		opts: WriteOptions,
	) {
		this.dryRun = opts.dryRun === true;
		this.result = emptyResult(this.dryRun);
		this.result.warnings.push(...(opts.warnings ?? []));
		for (const [p, v] of Object.entries(opts.snapshot ?? {})) this.snapshot[p] = { ...v };
		this.undo = new UndoRecorder(this.snapshot, opts.undoCap ?? UNDO_CAP_CHARS);
		this.linkProperty = sourceLinkProperty(config);
		this.ownedProps = ownedLinkProperties(config);
		this.paths = new PathIndex(vault);
		this.keys = new KeyIndex(vault, notes.find((n) => n.key)?.key?.property ?? null, notes, this.paths);
		this.planWarnings(notes);
		const hadPreviousImport = Object.keys(this.snapshot).length > 0;
		if (effectiveKeyColumns(config).length === 0 && (config.conflict === "update" || config.conflict === "overwrite") && hadPreviousImport) {
			this.result.warnings.push(KEY_WARNING);
		}
	}

	private planWarnings(notes: PlannedNote[]): void {
		const w = this.result.warnings;
		const seen = new Set<string>();
		let dupes = 0;
		let example = "";
		for (const n of notes) {
			if (!n.key) continue;
			if (seen.has(n.key.value)) {
				dupes++;
				example ||= n.key.value;
			} else seen.add(n.key.value);
		}
		if (dupes > 0) w.push(DUPLICATE_KEYS_IN_CSV_WARNING(dupes, example));
		const inVault = this.keys.duplicates(seen);
		if (inVault) w.push(DUPLICATE_NOTES_IN_VAULT_WARNING(inVault.count, inVault.example));
		if (notes.length > LARGE_IMPORT_THRESHOLD) w.push(LARGE_IMPORT_WARNING(notes.length));
		for (const name of extraPropertyConflicts(this.config)) w.push(EXTRA_PROPERTY_CONFLICT_WARNING(name));
	}

	get written(): number {
		return this.result.created + this.result.updated;
	}

	private record(o: RowOutcome): void {
		this.result.rows.push(o);
		if (o.outcome === "created") this.result.created++;
		else if (o.outcome === "updated") this.result.updated++;
		else if (o.outcome === "unchanged") this.result.unchanged++;
		else if (o.outcome === "skipped") this.result.skipped++;
		else this.result.failed++;
	}

	private owns(file: TFile, note: PlannedNote): boolean {
		return isOwned({
			hasSnapshotEntry: Object.prototype.hasOwnProperty.call(this.snapshot, file.path),
			frontmatter: this.vault.frontmatter(file),
			plannedLink: this.linkProperty ? note.frontmatter[this.linkProperty] : undefined,
			ownedLinkProps: this.ownedProps,
			adopt: this.config.adoptExistingNotes,
		});
	}

	private skip(note: PlannedNote, path: string, reason: string): void {
		this.record({ row: note.row, path, outcome: "skipped", reason });
	}

	private async createNote(note: PlannedNote, target: string): Promise<void> {
		if (!this.dryRun) {
			await this.paths.ensureFolder(parentOf(target));
			const text = serializeNote(note.frontmatter, note.body, note.types);
			const created = await this.vault.create(target, text);
			this.undo.created(created.path, text);
			this.snapshot[created.path] = plannedSnapshot(note);
			if (note.key) this.keys.add(note.key.value, created, true);
			this.paths.added(created);
		}
		this.paths.claim(target);
		this.record({
			row: note.row,
			path: target,
			outcome: "created",
			reason: this.dryRun ? ROW_REASON.wouldCreate : undefined,
			changed: Object.keys(note.frontmatter),
		});
	}

	/** Writes the note under a free "name N.md" instead of touching an existing one. */
	private createCopy(note: PlannedNote, path: string): Promise<void> {
		return this.createNote(note, this.paths.isTaken(path) ? this.paths.free(path) : path);
	}

	private async overwrite(note: PlannedNote, existing: TFile): Promise<void> {
		this.paths.claim(existing.path);
		const next = serializeNote(note.frontmatter, note.body, note.types);
		const current = await this.vault.read(existing);
		if (next === current) {
			this.record({ row: note.row, path: existing.path, outcome: "unchanged" });
			return;
		}
		if (!this.dryRun) {
			await this.undo.remember(existing, () => this.vault.read(existing));
			await this.vault.process(existing, () => next);
			this.undo.written(existing.path, next);
			this.snapshot[existing.path] = plannedSnapshot(note);
		}
		this.record({ row: note.row, path: existing.path, outcome: "updated", changed: Object.keys(note.frontmatter) });
	}

	private async update(note: PlannedNote, existing: TFile): Promise<void> {
		this.paths.claim(existing.path);
		const merged = mergeFrontmatter({
			existing: this.vault.frontmatter(existing) ?? {},
			planned: note.frontmatter,
			managed: Object.keys(note.types),
			snapshot: this.snapshot[existing.path],
			protectEdits: this.config.protectEdits,
			keepValuesOnEmpty: this.config.keepValuesOnEmpty,
			fillOnly: note.fillOnly,
		});
		const changed = Object.keys(merged.set);
		const preserved = merged.preserved.length > 0 ? merged.preserved : undefined;
		if (changed.length === 0) {
			if (!this.dryRun) this.snapshot[existing.path] = merged.snapshot;
			this.record({ row: note.row, path: existing.path, outcome: "unchanged", preserved });
			return;
		}
		if (!this.dryRun) {
			await this.undo.remember(existing, () => this.vault.read(existing));
			await this.vault.processFrontMatter(existing, (fm) => {
				for (const [k, v] of Object.entries(merged.set)) fm[k] = v;
			});
			this.undo.written(existing.path, await this.vault.read(existing));
			this.snapshot[existing.path] = merged.snapshot;
		}
		this.record({ row: note.row, path: existing.path, outcome: "updated", changed, preserved });
	}

	/** Applies the conflict strategy to a note this import owns. */
	private async resolveConflict(note: PlannedNote, existing: TFile, keyMatch: boolean, path: string): Promise<void> {
		const strategy = keyMatch && this.config.conflict === "rename" ? "update" : this.config.conflict;
		switch (strategy) {
			case "skip":
				this.skip(note, existing.path, ROW_REASON.alreadyExists);
				break;
			case "overwrite":
				await this.overwrite(note, existing);
				break;
			case "update":
				await this.update(note, existing);
				break;
			case "rename":
				await this.createNote(note, this.paths.free(path));
				break;
		}
	}

	/** Plans and performs the write of one note. Throws on vault errors; the caller records them. */
	private async writeOne(note: PlannedNote, path: string): Promise<void> {
		let keyMatch: TFile | null = null;
		if (note.key) {
			if (this.seenKeys.has(note.key.value)) {
				this.skip(note, path, ROW_REASON.duplicateKey);
				this.result.errors.push({ row: note.row, message: `duplicate key "${note.key.value}"` });
				return;
			}
			this.seenKeys.add(note.key.value);
			// Only a note this import owns counts as the existing note for this key; foreign notes sharing
			// the key (hand-made, or created by another CSV) never shadow it.
			const owned = this.keys.candidates(note.key.value).filter((f) => this.owns(f, note));
			keyMatch = owned.find((f) => !isConflictCopy(f)) ?? owned[0] ?? null;
		}

		let existing: TFile | null = keyMatch;
		if (!existing) {
			if (this.paths.isClaimed(path)) {
				// another row of this run already wrote this name
				await this.createNote(note, this.paths.free(path));
				return;
			}
			const atPath = this.paths.lookup(path);
			if (atPath && !isFile(atPath)) throw new Error(`"${path}" exists and is a folder`);
			existing = atPath;
		}

		if (!existing) {
			await this.createNote(note, path);
		} else if (!this.owns(existing, note)) {
			if (this.config.conflict === "rename") await this.createCopy(note, path);
			else {
				this.skippedNotOwned++;
				this.skip(note, existing.path, ROW_REASON.notOwned);
			}
		} else if (!keyMatch && hasOtherKey(this.vault.frontmatter(existing), note.key)) {
			if (this.config.conflict === "rename") await this.createCopy(note, path);
			else this.skip(note, existing.path, ROW_REASON.fileNameTaken);
		} else {
			await this.resolveConflict(note, existing, keyMatch !== null, path);
		}
	}

	/** Writes one row; failures become a "failed" outcome. */
	async writeRow(note: PlannedNote): Promise<void> {
		const path = this.paths.resolvePath(normalizePath(note.path));
		try {
			await this.writeOne(note, path);
		} catch (e) {
			const message = errorMessage(e);
			this.record({ row: note.row, path, outcome: "failed", reason: message });
			this.result.errors.push({ row: note.row, message });
		}
	}
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
export function writeNotes(app: App, notes: PlannedNote[], config: FileImportConfig, opts: WriteOptions = {}): Promise<WriteOutput> {
	return writeNotesWith(new ObsidianVaultGateway(app), notes, config, opts);
}

/** `writeNotes` over any vault gateway. */
// fallow-ignore-next-line unused-export -- test seam: runs the importer against a fake VaultGateway
export async function writeNotesWith(
	vault: VaultGateway,
	notes: PlannedNote[],
	config: FileImportConfig,
	opts: WriteOptions = {},
): Promise<WriteOutput> {
	const dryRun = opts.dryRun === true;
	const writer = new NoteWriter(vault, notes, config, opts);
	const { result, snapshot } = writer;
	const onCheckpoint = opts.onCheckpoint;
	const checkpointer = new Checkpointer(dryRun || !onCheckpoint ? undefined : () => onCheckpoint(snapshot, writer.undo.manifest));
	const total = notes.length;

	let lastYield = now();
	let done = 0;
	for (let i = 0; i < total; i++) {
		if (opts.shouldStop?.()) {
			result.cancelled = true;
			break;
		}
		const written0 = writer.written;
		const note = notes[i];
		if (!note) continue;
		await writer.writeRow(note);
		done = i + 1;
		await checkpointer.afterRow(writer.written - written0);
		if (now() - lastYield > SLICE_MS) {
			opts.onProgress?.(done, total);
			await yieldToUi();
			lastYield = now();
		}
	}
	if (writer.skippedNotOwned > 0 && result.updated + result.unchanged === 0) result.warnings.push(NOT_OWNED_WARNING);
	if (result.cancelled) await checkpointer.flush();
	await checkpointer.settled();
	opts.onProgress?.(done, total);
	if (writer.undo.finish() && !dryRun) result.warnings.push(UNDO_TRUNCATED_WARNING);
	return { result, snapshot: dryRun ? { ...(opts.snapshot ?? {}) } : snapshot, undo: writer.undo.manifest };
}
