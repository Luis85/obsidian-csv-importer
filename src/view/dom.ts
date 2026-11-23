import { Setting, setIcon } from "obsidian";
import type { FileImportConfig } from "../types";
import { resolveTargetFolder } from "../import/noteBuilder";

export type CalloutKind = "warning" | "banner-warning" | "banner-info";

/**
 * Renders an icon plus one line per message. "warning" is the in-dialog callout,
 * the "banner-*" kinds are the table view banners. Returns the box so callers can append controls.
 */
export function renderCallout(el: HTMLElement, kind: CalloutKind, messages: string[]): HTMLElement {
	if (kind === "warning") {
		const box = el.createDiv({ cls: "csv-importer-callout mod-warning", attr: { role: "status" } });
		setIcon(box.createSpan({ cls: "csv-importer-callout-icon" }), "alert-triangle");
		const list = box.createDiv({ cls: "csv-importer-callout-text" });
		for (const m of messages) list.createDiv({ text: m });
		return box;
	}
	const warning = kind === "banner-warning";
	const box = el.createDiv({
		cls: warning ? "csv-importer-banner mod-warning" : "csv-importer-banner is-info",
		attr: warning ? { role: "status" } : {},
	});
	setIcon(box.createSpan({ cls: "csv-importer-banner-icon" }), warning ? "alert-triangle" : "info");
	const text = box.createDiv({ cls: "csv-importer-banner-text" });
	for (const m of messages) text.createDiv({ text: m });
	return box;
}

/** Target folder of a config, or "" when the folder template cannot be resolved. */
export function safeTargetFolder(cfg: FileImportConfig, csvPath: string): string {
	try {
		return resolveTargetFolder(cfg, csvPath);
	} catch {
		return "";
	}
}

/** Section heading in the Obsidian settings style. */
export function sectionHeading(el: HTMLElement, name: string): Setting {
	return new Setting(el).setName(name).setHeading();
}
