import { normalizePath, TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import type {
	ColumnConfig,
	FileImportConfig,
	ImportResult,
	PlannedNote,
	PropertyType,
	TypeRegistrationResult,
} from "../types";
import { serializeNote } from "./noteBuilder";

const YIELD_EVERY = 50;

function tick(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function ensureFolder(app: App, folder: string, known: Set<string>): Promise<void> {
	if (!folder || folder === "/" || known.has(folder)) return;
	const parts = folder.split("/").filter((p) => p.length > 0);
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (known.has(current)) continue;
		if (!app.vault.getAbstractFileByPath(current)) {
			try {
				await app.vault.createFolder(current);
			} catch (e) {
				// Might have been created concurrently.
				if (!app.vault.getAbstractFileByPath(current)) throw e;
			}
		}
		known.add(current);
	}
}

function parentOf(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? "" : path.slice(0, i);
}

function freePath(app: App, path: string): string {
	const dot = path.lastIndexOf(".");
	const base = dot < 0 ? path : path.slice(0, dot);
	const ext = dot < 0 ? "" : path.slice(dot);
	for (let n = 1; n < 100000; n++) {
		const candidate = `${base} ${n}${ext}`;
		if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
	}
	throw new Error("No free file name found");
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

/** Maps String(frontmatter[property]) -> file for all markdown files under the given folders (recursive). */
function buildKeyIndex(app: App, folders: Set<string>, property: string): Map<string, TFile> {
	const index = new Map<string, TFile>();
	const files: TFile[] = [];
	const seen = new Set<string>();
	for (const folder of folders) {
		// Skip folders already covered by a seen ancestor.
		const f = folder === "" || folder === "/" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(folder);
		if (f instanceof TFolder) collectMarkdown(f, files);
	}
	for (const file of files) {
		if (seen.has(file.path)) continue;
		seen.add(file.path);
		const v: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[property];
		if (v === undefined || v === null) continue;
		const key = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
		if (!index.has(key)) index.set(key, file);
	}
	return index;
}

/**
 * Writes planned notes into the vault honoring the conflict strategy.
 *
 * When notes carry a `key`, existing notes are matched by that property's value (within the target folders,
 * recursively) regardless of their path. A key match is treated as the "existing" note and the strategy applies
 * to it; "rename" is treated as "update" for key matches (a new suffixed note would duplicate the record).
 * Without a match, or without key, existing notes are detected by path. Duplicate keys inside one run:
 * the first row wins, later rows are skipped with an error message.
 */
export async function writeNotes(
	app: App,
	notes: PlannedNote[],
	config: FileImportConfig,
	onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
	const result: ImportResult = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
	const folders = new Set<string>();
	const total = notes.length;

	const keyProperty = notes.find((n) => n.key)?.key?.property ?? null;
	let keyIndex = new Map<string, TFile>();
	if (keyProperty) {
		try {
			const targetFolders = new Set(notes.map((n) => parentOf(normalizePath(n.path))));
			keyIndex = buildKeyIndex(app, targetFolders, keyProperty);
		} catch (e) {
			console.warn("CSV Importer: could not index existing notes", e);
		}
	}
	const seenKeys = new Set<string>();

	for (let i = 0; i < total; i++) {
		const note = notes[i];
		try {
			const path = normalizePath(note.path);
			const content = (): string => serializeNote(note.frontmatter, note.body, note.types);

			let keyMatch: TFile | null = null;
			if (note.key) {
				if (seenKeys.has(note.key.value)) {
					result.skipped++;
					result.errors.push({ row: note.row, message: `duplicate key "${note.key.value}"` });
					onProgress?.(i + 1, total);
					continue;
				}
				seenKeys.add(note.key.value);
				keyMatch = keyIndex.get(note.key.value) ?? null;
			}

			let existing: TFile | null = keyMatch;
			let strategy = config.conflict;
			if (keyMatch) {
				if (strategy === "rename") strategy = "update";
			} else {
				await ensureFolder(app, parentOf(path), folders);
				const atPath = app.vault.getAbstractFileByPath(path);
				if (atPath && !(atPath instanceof TFile)) throw new Error(`"${path}" exists and is a folder`);
				existing = atPath;
			}

			if (!existing) {
				const created = await app.vault.create(path, content());
				if (note.key) keyIndex.set(note.key.value, created);
				result.created++;
			} else {
				switch (strategy) {
					case "skip":
						result.skipped++;
						break;
					case "overwrite":
						await app.vault.modify(existing, content());
						result.updated++;
						break;
					case "update":
						await app.fileManager.processFrontMatter(existing, (fm: Record<string, unknown>) => {
							for (const [key, value] of Object.entries(note.frontmatter)) {
								fm[key] = value;
							}
						});
						result.updated++;
						break;
					case "rename": {
						const created = await app.vault.create(freePath(app, path), content());
						if (note.key) keyIndex.set(note.key.value, created);
						result.created++;
						break;
					}
				}
			}
		} catch (e) {
			result.failed++;
			result.errors.push({ row: note.row, message: e instanceof Error ? e.message : String(e) });
		}
		const done = i + 1;
		onProgress?.(done, total);
		if (done % YIELD_EVERY === 0) await tick();
	}
	return result;
}

interface MetadataTypeManagerLike {
	setType?: (name: string, type: string) => unknown;
	getAssignedType?: (name: string) => string | null | undefined;
	types?: Record<string, { type?: string } | undefined>;
}

const OBSIDIAN_TYPES: Record<PropertyType, string> = {
	text: "text",
	number: "number",
	checkbox: "checkbox",
	date: "date",
	datetime: "datetime",
	list: "multitext",
};

const SKIPPED_PROPERTIES = new Set(["tags", "aliases", "cssclasses"]);

function normalizeType(t: string): string {
	return t === "tags" || t === "aliases" ? "multitext" : t;
}

function existingType(mgr: MetadataTypeManagerLike, name: string): string | null {
	let t: string | null | undefined;
	if (typeof mgr.getAssignedType === "function") t = mgr.getAssignedType(name);
	if (!t && mgr.types) t = mgr.types[name]?.type ?? mgr.types[name.toLowerCase()]?.type;
	return t ? t : null;
}

/**
 * Best-effort: merge column types into Obsidian's property type registry (undocumented metadataTypeManager).
 * Never overwrites a property that already has a different type; those are returned as conflicts. Never throws.
 */
export function registerPropertyTypes(app: App, columns: ColumnConfig[]): TypeRegistrationResult {
	const out: TypeRegistrationResult = { registered: [], conflicts: [] };
	try {
		const mgr = (app as unknown as { metadataTypeManager?: MetadataTypeManagerLike }).metadataTypeManager;
		if (!mgr || typeof mgr.setType !== "function") return out;
		for (const col of columns) {
			if (!col.include) continue;
			const name = col.property;
			if (!name || SKIPPED_PROPERTIES.has(name.toLowerCase())) continue;
			try {
				const wanted =
					col.valueTemplate && col.type !== "list" ? OBSIDIAN_TYPES.text : OBSIDIAN_TYPES[col.type];
				const existing = existingType(mgr, name);
				if (existing) {
					if (normalizeType(existing) !== wanted) {
						out.conflicts.push({ property: name, existing, wanted });
					}
					continue;
				}
				void mgr.setType(name, wanted);
				out.registered.push(name);
			} catch (e) {
				console.warn("CSV Importer: could not register property type", name, e);
			}
		}
	} catch (e) {
		console.warn("CSV Importer: property type registration unavailable", e);
	}
	return out;
}
