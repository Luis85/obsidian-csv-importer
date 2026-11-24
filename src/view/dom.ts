import { setIcon, setTooltip } from "obsidian";
import type { FileImportConfig } from "../types";
import { resolveTargetFolder } from "../import/noteBuilder";

export type CalloutKind = "info" | "warning" | "error";

export interface CalloutOptions {
	/** Heading line. Defaults to the kind name ("Info", "Warning", "Error"). */
	title?: string;
	/** One line each; a single item renders as a paragraph, several as a bullet list. */
	items: string[];
	/** At most one action, rendered as a plain button below the content. */
	action?: { label: string; onClick: () => void };
}

const CALLOUT_ICONS: Record<CalloutKind, string> = { info: "info", warning: "alert-triangle", error: "x-circle" };
const CALLOUT_TITLES: Record<CalloutKind, string> = { info: "Info", warning: "Warning", error: "Error" };

/**
 * The one callout component (UI-SPEC section 7). Emits native `.callout[data-callout]` markup so themes style it.
 * Usage: `renderCallout(el, "warning", { items: parsed.warnings, action: { label: REVIEW_COLUMNS, onClick } })`.
 * Warning and error callouts get role="status" / "alert". Returns the callout element.
 */
export function renderCallout(el: HTMLElement, kind: CalloutKind, opts: CalloutOptions): HTMLElement {
	const box = el.createDiv({
		cls: "callout csv-importer-callout",
		attr: { "data-callout": kind, role: kind === "error" ? "alert" : "status" },
	});
	const title = box.createDiv({ cls: "callout-title" });
	setIcon(title.createDiv({ cls: "callout-icon" }), CALLOUT_ICONS[kind]);
	title.createDiv({ cls: "callout-title-inner", text: opts.title ?? CALLOUT_TITLES[kind] });
	const content = box.createDiv({ cls: "callout-content" });
	if (opts.items.length === 1) {
		content.createEl("p", { text: opts.items[0] });
	} else if (opts.items.length > 1) {
		const list = content.createEl("ul");
		for (const item of opts.items) list.createEl("li", { text: item });
	}
	if (opts.action) {
		const { label, onClick } = opts.action;
		const btn = content.createEl("button", { cls: "csv-importer-callout-action", text: label, attr: { type: "button" } });
		btn.addEventListener("click", onClick);
	}
	return box;
}

/**
 * Small outlined label. `kind` only changes the text color (mod-success / mod-warning / mod-error).
 * Usage: `badge(row, "CSV missing", { kind: "warning" })`. Returns the span.
 */
export function badge(el: HTMLElement, text: string, opts: { kind?: "success" | "warning" | "error"; cls?: string } = {}): HTMLSpanElement {
	const cls = ["csv-importer-badge", opts.kind ? `mod-${opts.kind}` : "", opts.cls ?? ""].filter(Boolean).join(" ");
	return el.createSpan({ cls, text });
}

/**
 * Accessible icon-only button: a native `<button class="clickable-icon">` with aria-label and a tooltip.
 * Usage: `iconButton(toolbar, { icon: "refresh-cw", label: "Refresh", onClick: () => void refresh() })`.
 * Returns the button so callers can toggle `disabled` or add classes.
 */
export function iconButton(
	el: HTMLElement,
	opts: { icon: string; label: string; onClick: (ev: MouseEvent) => void; cls?: string },
): HTMLButtonElement {
	const btn = el.createEl("button", {
		cls: ["clickable-icon", opts.cls ?? ""].filter(Boolean).join(" "),
		attr: { type: "button", "aria-label": opts.label },
	});
	setIcon(btn, opts.icon);
	setTooltip(btn, opts.label);
	btn.addEventListener("click", opts.onClick);
	return btn;
}

/**
 * Path relative to a folder; returns the path unchanged when it is not inside the folder.
 * Usage: `relPath("Data/timesheet/a.md", "Data/timesheet/")` gives "a.md". Trailing slashes on the folder are ignored.
 */
export function relPath(path: string, folder: string): string {
	const base = folder.replace(/\/+$/, "");
	if (!base) return path;
	return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
}

/** Target folder of a config, or "" when the folder template cannot be resolved. */
export function safeTargetFolder(cfg: FileImportConfig, csvPath: string): string {
	try {
		return resolveTargetFolder(cfg, csvPath);
	} catch {
		return "";
	}
}

/** "512 B", "2.1 KB", "3.4 MB". */
export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
