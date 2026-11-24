import type { App, Component, EventRef } from "obsidian";

/** Workspace event fired after the import settings, import history or the notes of a CSV changed. Argument: the CSV's vault path. */
export const CSV_CHANGED_EVENT = "csv-importer:changed";

/** Announces that something about a CSV's import state changed (settings saved, import, undo, delete, remove). */
export function triggerCsvChanged(app: App, csvPath: string): void {
	app.workspace.trigger(CSV_CHANGED_EVENT, csvPath);
}

/**
 * Listens for `CSV_CHANGED_EVENT`; the handler is removed when the plugin or view unloads.
 * Usage: `onCsvChanged(this, (csvPath) => { if (csvPath === this.file?.path) void this.reload(); })`.
 */
export function onCsvChanged(owner: Component & { app: App }, cb: (csvPath: string) => void): EventRef {
	// Workspace.on only types the built-in event names; custom events go through the same method.
	const workspace = owner.app.workspace as unknown as { on(name: string, callback: (...data: unknown[]) => unknown): EventRef };
	const ref = workspace.on(CSV_CHANGED_EVENT, (...data: unknown[]) => {
		const path = data[0];
		if (typeof path === "string") cb(path);
	});
	owner.registerEvent(ref);
	return ref;
}
