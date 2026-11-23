import { normalizePath, TFile } from "obsidian";
import type { App } from "obsidian";
import type { ColumnConfig, FileImportConfig, ImportResult, PlannedNote, PropertyType } from "../types";
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

/** Writes planned notes into the vault honoring the conflict strategy. */
export async function writeNotes(
	app: App,
	notes: PlannedNote[],
	config: FileImportConfig,
	onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
	const result: ImportResult = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
	const folders = new Set<string>();
	const total = notes.length;

	for (let i = 0; i < total; i++) {
		const note = notes[i];
		try {
			const path = normalizePath(note.path);
			await ensureFolder(app, parentOf(path), folders);
			const existing = app.vault.getAbstractFileByPath(path);
			if (!existing) {
				await app.vault.create(path, serializeNote(note.frontmatter, note.body));
				result.created++;
			} else if (!(existing instanceof TFile)) {
				throw new Error(`"${path}" exists and is a folder`);
			} else {
				switch (config.conflict) {
					case "skip":
						result.skipped++;
						break;
					case "overwrite":
						await app.vault.modify(existing, serializeNote(note.frontmatter, note.body));
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
					case "rename":
						await app.vault.create(freePath(app, path), serializeNote(note.frontmatter, note.body));
						result.created++;
						break;
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
}

const OBSIDIAN_TYPES: Record<PropertyType, string> = {
	text: "text",
	number: "number",
	checkbox: "checkbox",
	date: "date",
	datetime: "datetime",
	list: "multitext",
};

/** Best-effort: register column types in Obsidian's property type registry (undocumented metadataTypeManager). Never throws. */
export function registerPropertyTypes(app: App, columns: ColumnConfig[]): void {
	try {
		const mgr = (app as unknown as { metadataTypeManager?: MetadataTypeManagerLike }).metadataTypeManager;
		if (!mgr || typeof mgr.setType !== "function") return;
		for (const col of columns) {
			if (!col.include) continue;
			try {
				void mgr.setType(col.property, OBSIDIAN_TYPES[col.type]);
			} catch (e) {
				console.warn("CSV Importer: could not register property type", col.property, e);
			}
		}
	} catch (e) {
		console.warn("CSV Importer: property type registration unavailable", e);
	}
}
