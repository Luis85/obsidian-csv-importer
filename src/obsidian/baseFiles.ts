import { normalizePath, Notice, TFile } from "obsidian";
import type { App } from "obsidian";
import { buildBaseFile } from "../import/baseFile";
import type { FileImportConfig } from "../types";

/** Path of the `.base` file next to a notes folder, or null when the folder is dynamic or the file does not exist. */
export function basePath(app: App, staticFolder: string): string | null {
	if (!staticFolder) return null;
	const p = normalizePath(`${staticFolder}.base`);
	return app.vault.getAbstractFileByPath(p) instanceof TFile ? p : null;
}

/** Opens the base file for a notes folder in a new tab (no-op when there is none). */
export function openBase(app: App, staticFolder: string): void {
	const p = basePath(app, staticFolder);
	const f = p ? app.vault.getAbstractFileByPath(p) : null;
	if (f instanceof TFile) void app.workspace.getLeaf("tab").openFile(f);
}

/**
 * Creates the base file next to the notes folder . Never overwrites an existing file.
 * Returns its path and content, or null when nothing was created.
 */
export async function createBaseFile(
	app: App,
	folder: string,
	cfg: FileImportConfig,
	csvBasename: string,
): Promise<{ path: string; content: string } | null> {
	try {
		const path = normalizePath(`${folder}.base`);
		if (app.vault.getAbstractFileByPath(path)) return null;
		const props = cfg.columns.filter((c) => c.include).map((c) => c.property);
		const content = buildBaseFile(folder, props, csvBasename);
		await app.vault.create(path, content);
		new Notice(`Created ${path}.`);
		return { path, content };
	} catch (e) {
		console.error("CSV Importer: could not create base file", e);
		new Notice("Could not create the base file.");
		return null;
	}
}
