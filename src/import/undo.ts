import type { App, TFile } from "obsidian";
import type { ImportSnapshot, UndoManifest } from "../types";
import { valueHash } from "./merge";
import { ObsidianVaultGateway } from "./vaultGateway";
import type { VaultGateway } from "./vaultGateway";

/** Maximum total size of previous note contents kept for undo. */
export const UNDO_CAP_CHARS = 20 * 1024 * 1024;

export const UNDO_TRUNCATED_WARNING = "The import is too large to undo completely.";

/**
 * Builds the undo manifest of one run: created paths, previous contents of modified notes (up to a size cap),
 * the snapshot entries those notes had, and a hash of what the run wrote to each note.
 */
export class UndoRecorder {
	readonly manifest: UndoManifest;
	private readonly snapshotBefore: Record<string, Record<string, string>> = {};
	private readonly writtenHashes: Record<string, string> = {};
	private readonly touched = new Set<string>();
	private chars = 0;
	private truncated = false;

	constructor(
		private readonly snapshot: ImportSnapshot,
		private readonly cap: number = UNDO_CAP_CHARS,
	) {
		this.manifest = {
			csvPath: "",
			timestamp: Date.now(),
			created: [],
			modified: [],
			snapshotBefore: this.snapshotBefore,
			writtenHashes: this.writtenHashes,
		};
	}

	/** Records a note this run created. */
	created(path: string, text: string): void {
		this.manifest.created.push(path);
		this.writtenHashes[path] = valueHash(text);
		this.touched.add(path);
	}

	/** Records the text a note holds after this run changed it. */
	written(path: string, text: string): void {
		this.writtenHashes[path] = valueHash(text);
	}

	/** Keeps the note's previous content (once per path) unless the cap is exceeded, then marks undo partial. */
	async remember(file: TFile, read: () => Promise<string>): Promise<void> {
		if (this.touched.has(file.path)) return;
		this.touched.add(file.path);
		const text = await read();
		if (this.truncated || this.chars + text.length > this.cap) {
			this.truncated = true;
			return;
		}
		this.chars += text.length;
		this.manifest.modified.push({ path: file.path, content: text });
		if (Object.prototype.hasOwnProperty.call(this.snapshot, file.path)) {
			this.snapshotBefore[file.path] = { ...this.snapshot[file.path] };
		}
	}

	/** Sets `manifest.truncated` when content was dropped; returns whether it was. */
	finish(): boolean {
		if (this.truncated) this.manifest.truncated = true;
		return this.truncated;
	}
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
export function applyUndo(app: App, manifest: UndoManifest): Promise<UndoOutcome> {
	return applyUndoWith(new ObsidianVaultGateway(app), manifest);
}

/** `applyUndo` over any vault gateway. */
// fallow-ignore-next-line unused-export -- test seam: applies undo against a fake VaultGateway
export async function applyUndoWith(vault: VaultGateway, manifest: UndoManifest): Promise<UndoOutcome> {
	const out: UndoOutcome = { trashed: 0, restored: 0, failed: 0, changed: [] };
	const hashes = manifest.writtenHashes;
	const unchanged = async (file: TFile): Promise<boolean> => {
		const expected = hashes?.[file.path];
		if (expected === undefined) return true;
		return valueHash(await vault.read(file)) === expected;
	};
	for (const path of manifest.created) {
		try {
			const f = vault.getFile(path);
			if (!f) continue;
			if (!(await unchanged(f))) {
				out.changed.push(path);
				continue;
			}
			await vault.trash(f);
			out.trashed++;
		} catch (e) {
			out.failed++;
			console.error("CSV Importer: could not trash note", path, e);
		}
	}
	for (const m of manifest.modified) {
		try {
			const f = vault.getFile(m.path);
			if (!f) continue;
			if (!(await unchanged(f))) {
				out.changed.push(m.path);
				continue;
			}
			await vault.process(f, () => m.content);
			out.restored++;
		} catch (e) {
			out.failed++;
			console.error("CSV Importer: could not restore note", m.path, e);
		}
	}
	return out;
}
