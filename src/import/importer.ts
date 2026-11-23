import type { App } from "obsidian";
import type { ColumnConfig, FileImportConfig, ImportResult, PlannedNote } from "../types";

/** Writes planned notes into the vault honoring the conflict strategy. */
export async function writeNotes(
	app: App,
	notes: PlannedNote[],
	config: FileImportConfig,
	onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
	throw new Error("not implemented");
}

/** Best-effort: register column types in Obsidian's property type registry (undocumented metadataTypeManager). Never throws. */
export function registerPropertyTypes(app: App, columns: ColumnConfig[]): void {
	throw new Error("not implemented");
}
