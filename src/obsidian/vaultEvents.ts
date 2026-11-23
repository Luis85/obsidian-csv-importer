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
			if (isCsv(file)) {
				store.delete(file.path).catch(logFailure("could not remove the config of a deleted CSV"));
				storage.delete(file.path).catch(logFailure("could not remove the import state of a deleted CSV"));
			} else if (isMarkdown(file)) {
				storage.deleteNote(file.path).catch(logFailure("could not update history for a deleted note"));
			}
		}),
	);
}
