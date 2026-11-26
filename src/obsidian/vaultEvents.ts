import { TFile, TFolder } from "obsidian";
import type { Plugin, TAbstractFile } from "obsidian";
import type { ConfigStore } from "../configStore";
import type { ImportStorage } from "../storage";

/** True for a `.csv` file. */
export function isCsv(file: TAbstractFile | null): file is TFile {
	return file instanceof TFile && file.extension.toLowerCase() === "csv";
}

function isMarkdown(file: TAbstractFile): file is TFile {
	return file instanceof TFile && file.extension.toLowerCase() === "md";
}

function logFailure(what: string): (e: unknown) => void {
	return (e) => console.error(`CSV Importer: ${what}`, e);
}

/**
 * Keeps stored configs and import state in step with vault renames and deletions: CSV files carry their config and
 * state along, notes keep their place in snapshots and undo manifests. Registered through the plugin so the
 * handlers are removed on unload.
 */
export function registerVaultEvents(plugin: Plugin, store: ConfigStore, storage: ImportStorage): void {
	const { vault } = plugin.app;
	plugin.registerEvent(
		vault.on("rename", (file, oldPath) => {
			if (file instanceof TFolder) {
				store.renameFolder(oldPath, file.path).catch(logFailure("could not update configs of a renamed folder"));
			} else if (isCsv(file)) {
				store.rename(oldPath, file.path).catch(logFailure("could not move the config of a renamed CSV"));
				storage.rename(oldPath, file.path).catch(logFailure("could not move the import state of a renamed CSV"));
			} else if (isMarkdown(file)) {
				storage.renameNote(oldPath, file.path).catch(logFailure("could not update history for a renamed note"));
			}
		}),
	);
	plugin.registerEvent(
		vault.on("delete", (file) => {
			// A deleted CSV keeps its config and import state: the CSV imports index shows it as missing, its notes can
			// still be deleted or undone, and restoring the file (from the trash, or by a sync tool that deletes and
			// re-creates it) picks up where it left off. Remove from index forgets it.
			if (isMarkdown(file)) {
				storage.deleteNote(file.path).catch(logFailure("could not update history for a deleted note"));
			}
		}),
	);
}
