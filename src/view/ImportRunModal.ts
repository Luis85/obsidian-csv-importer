import { Menu, Modal, Notice, Platform, normalizePath, setIcon } from "obsidian";
import type { App } from "obsidian";
import type { HeaderDrift, ImportResult, NoteOutcome, RowOutcome } from "../types";
import { ROW_REASON, emptyResult } from "../core/result";
import { errorMessage } from "../core/util";
import { iconButton, relPath, renderCallout } from "./dom";
import { CLOSE, IMPORT_FINISHED, driftMessage } from "./labels";
import {
	CANCEL, CHECKING_ROWS, IMPORTING_TITLE, MORE_ACTIONS, NOTHING_TO_CHANGE, NO_DATA_ROWS, OPEN_BASE, OPEN_FIRST_NOTE, OUTCOME_LABEL,
	OUTCOME_ORDER, PREVIEW_TITLE, SAVE_REPORT, STARTING, STOPPING, STOP_IMPORT, UNDO_IMPORT, countsLine, moreRows, previewImportLabel,
	rowsProgress, targetLine,
} from "./runCopy";

export type { HeaderDrift };

/** What the dialog needs from the plugin; keeps it free of vault logic. */
export interface ImportRunControls {
	csvPath: string;
	csvBasename: string;
	/** Folder where the report note is written. */
	reportFolder: string;
	drift: HeaderDrift | null;
	/** Dry run: computes outcomes without writing. */
	preview(): Promise<ImportResult>;
	/** Real run. `undoable` is true only when THIS run created or modified notes (so undo targets this run). */
	execute(opts: {
		onProgress: (done: number, total: number) => void;
		shouldStop: () => boolean;
	}): Promise<{ result: ImportResult; undoable: boolean }>;
	canUndo(): boolean;
	undo(): Promise<void>;
	/** Target folder shown in the preview header (static prefix when it has placeholders). */
	targetFolder: string;
	/** Open a note (vault path) in a new tab. */
	openNote(path: string): void;
	/** Path of the .base file for these notes if it exists (after a run), else null. */
	basePath(): string | null;
	/** Open the .base file in a new tab. */
	openBase(): void;
}

const LIST_LIMIT = 200;
/** New and Updated groups start open up to this many rows. */
const OPEN_LIMIT = 10;

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

function stamp(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

export class ImportRunModal extends Modal {
	private stop = false;
	private running = false;
	private finished: ImportResult | null = null;
	private undoable = false;
	private latest: ImportResult | null = null;
	private resolveClosed!: (r: ImportResult) => void;
	readonly closed: Promise<ImportResult>;

	constructor(
		app: App,
		private readonly ctl: ImportRunControls,
	) {
		super(app);
		this.closed = new Promise((resolve) => (this.resolveClosed = resolve));
		this.modalEl.addClass("csv-importer-run");
	}

	onOpen(): void {
		void this.showPreview();
	}

	close(): void {
		if (this.running) {
			new Notice("Use the stop button to end the import.");
			return;
		}
		super.close();
	}

	onClose(): void {
		this.stop = true;
		this.contentEl.empty();
		this.resolveClosed(this.finished ?? this.latest ?? emptyResult(true));
	}

	// --- phases ---

	private async showPreview(): Promise<void> {
		this.setTitle(PREVIEW_TITLE);
		this.reset().createDiv({ cls: "csv-importer-run-note", text: CHECKING_ROWS });
		let result: ImportResult;
		try {
			result = await this.ctl.preview();
		} catch (e) {
			renderCallout(this.reset(), "error", { title: "Preview failed", items: [errorMessage(e)] });
			this.buttons([{ text: CLOSE, cta: true, onClick: () => this.close() }]);
			return;
		}
		this.latest = result;
		const el = this.reset();
		this.renderHead(result);
		this.renderWarnings(el, result, true);
		this.renderGroups(el, result.rows);
		const actionable = result.created + result.updated;
		this.buttons([
			{
				text: previewImportLabel(actionable),
				cta: true,
				disabled: result.rows.length === 0,
				onClick: () => void this.runImport(),
			},
			{ text: CANCEL, onClick: () => this.close() },
		]);
	}

	private async runImport(): Promise<void> {
		this.running = true;
		this.stop = false;
		this.setTitle(IMPORTING_TITLE);
		const el = this.reset();
		this.renderHead(null);
		const bar = el.createEl("progress", { cls: "csv-importer-run-progress" });
		bar.max = 1;
		bar.value = 0;
		const label = el.createDiv({ cls: "csv-importer-run-note", text: STARTING, attr: { "aria-live": "polite" } });
		const stopBtn = this.buttons([
			{
				text: STOP_IMPORT,
				onClick: () => {
					this.stop = true;
					label.setText(STOPPING);
				},
			},
		])[0];
		let lastPaint = 0;
		try {
			const outcome = await this.ctl.execute({
				onProgress: (done, total) => {
					const now = Date.now();
					if (now - lastPaint < 80 && done < total) return;
					lastPaint = now;
					bar.max = Math.max(total, 1);
					bar.value = done;
					label.setText(rowsProgress(done, total));
				},
				shouldStop: () => this.stop,
			});
			this.running = false;
			this.finished = outcome.result;
			this.undoable = outcome.undoable;
			this.showDone(outcome.result);
		} catch (e) {
			this.running = false;
			stopBtn.disabled = true;
			renderCallout(this.reset(), "error", { title: "Import failed", items: [errorMessage(e)] });
			this.buttons([{ text: CLOSE, cta: true, onClick: () => this.close() }]);
		}
	}

	private showDone(result: ImportResult): void {
		this.setTitle(result.cancelled ? "Import stopped" : IMPORT_FINISHED);
		const el = this.reset();
		this.renderHead(result, true);
		this.renderWarnings(el, result, false);
		this.renderGroups(el, result.rows);

		const first = result.rows.find((r) => r.outcome === "created" || r.outcome === "updated");
		const hasBase = this.ctl.basePath() !== null;
		const canUndo = this.undoable && this.ctl.canUndo();
		const undo = (): void => {
			void this.ctl
				.undo()
				.then(() => {
					this.undoable = false;
					if (!this.ctl.canUndo()) this.close();
				})
				.catch((e: unknown) => new Notice(`Undo failed: ${errorMessage(e)}`));
		};

		const row = this.footer();
		const close = row.createEl("button", { text: CLOSE, cls: "mod-cta csv-importer-run-close", attr: { type: "button" } });
		close.addEventListener("click", () => this.close());
		if (hasBase) {
			const base = row.createEl("button", { text: OPEN_BASE, cls: "csv-importer-run-base", attr: { type: "button" } });
			base.addEventListener("click", () => this.ctl.openBase());
		}
		iconButton(row, {
			icon: "more-horizontal",
			label: MORE_ACTIONS,
			cls: "csv-importer-run-more",
			onClick: (ev) => {
				const menu = new Menu();
				if (first) menu.addItem((i) => i.setTitle(OPEN_FIRST_NOTE).setIcon("file-text").onClick(() => this.ctl.openNote(first.path)));
				// On phone the footer only has Close and this menu.
				if (hasBase && Platform.isPhone) menu.addItem((i) => i.setTitle(OPEN_BASE).setIcon("layout-list").onClick(() => this.ctl.openBase()));
				menu.addItem((i) => i.setTitle(SAVE_REPORT).setIcon("file-plus").onClick(() => void this.saveReport(result)));
				if (canUndo) {
					menu.addSeparator();
					menu.addItem((i) => i.setTitle(UNDO_IMPORT).setIcon("undo-2").setWarning(true).onClick(undo));
				}
				menu.showAtMouseEvent(ev);
			},
		});
	}

	// --- rendering helpers ---

	private headEl: HTMLElement | null = null;

	/** Clears the dialog and returns the scrolling body. Header and footer sit outside of it. */
	private reset(): HTMLElement {
		this.contentEl.empty();
		this.headEl = this.contentEl.createDiv({ cls: "csv-importer-run-head" });
		return this.contentEl.createDiv({ cls: "csv-importer-run-body" });
	}

	/** Sticky header: target folder and the one-line counts. */
	private renderHead(result: ImportResult | null, live = false): void {
		const head = this.headEl;
		if (!head) return;
		const target = this.ctl.targetFolder;
		if (target) head.createDiv({ cls: "csv-importer-run-target", text: targetLine(target) });
		if (result) {
			const line = head.createDiv({ cls: "csv-importer-run-counts", text: countsLine(result) });
			if (live) line.setAttr("role", "status");
		}
	}

	private footer(): HTMLElement {
		this.contentEl.find(".csv-importer-run-buttons")?.remove();
		return this.contentEl.createDiv({ cls: "modal-button-container csv-importer-run-buttons" });
	}

	private buttons(defs: { text: string; cta?: boolean; disabled?: boolean; onClick: () => void }[]): HTMLButtonElement[] {
		const row = this.footer();
		return defs.map((d) => {
			const b = row.createEl("button", { text: d.text, cls: d.cta ? "mod-cta" : "", attr: { type: "button" } });
			b.disabled = d.disabled === true;
			b.addEventListener("click", d.onClick);
			return b;
		});
	}

	/** One callout: the column drift (preview only) and the import warnings together. */
	private renderWarnings(el: HTMLElement, r: ImportResult, withDrift: boolean): void {
		const items: string[] = [];
		const d = withDrift ? this.ctl.drift : null;
		if (d && (d.added.length > 0 || d.removed.length > 0)) items.push(driftMessage(d.added, d.removed));
		items.push(...(r.warnings ?? []));
		if (items.length > 0) renderCallout(el, "warning", { items });
	}

	/** Rows grouped by outcome: failed and skipped open, new and updated open when short, unchanged closed. */
	private renderGroups(el: HTMLElement, rows: RowOutcome[]): void {
		if (rows.length === 0) {
			el.createDiv({ cls: "csv-importer-run-note", text: NO_DATA_ROWS });
			return;
		}
		const folder = this.ctl.targetFolder;
		let any = false;
		for (const outcome of OUTCOME_ORDER) {
			const group = rows.filter((r) => r.outcome === outcome);
			if (group.length === 0) continue;
			any = true;
			const open = outcome === "failed" || outcome === "skipped" || ((outcome === "created" || outcome === "updated") && group.length <= OPEN_LIMIT);
			const details = el.createEl("details", { cls: `csv-importer-run-group is-${outcome}` });
			details.open = open;
			const summary = details.createEl("summary", { cls: "csv-importer-run-group-title" });
			setIcon(summary.createSpan({ cls: "csv-importer-run-chevron" }), "chevron-right");
			summary.createSpan({ cls: "csv-importer-run-group-name", text: OUTCOME_LABEL[outcome] });
			summary.createSpan({ cls: "csv-importer-run-group-count", text: String(group.length) });
			const list = details.createDiv({ cls: "csv-importer-run-list" });
			for (const r of group.slice(0, LIST_LIMIT)) {
				const item = list.createDiv({ cls: "csv-importer-run-item" });
				const line = item.createDiv({ cls: "csv-importer-run-path" });
				line.createSpan({ text: relPath(r.path, folder) });
				line.createSpan({ cls: "csv-importer-run-row", text: ` \u00b7 row ${r.row}` });
				const detail: string[] = [];
				if (r.reason && r.reason !== ROW_REASON.wouldCreate) detail.push(r.reason);
				if (r.outcome === "updated" && r.changed?.length) detail.push(`changes ${r.changed.join(", ")}`);
				if (r.preserved?.length) detail.push(`keeps your edits to ${r.preserved.join(", ")}`);
				if (detail.length > 0) item.createDiv({ cls: "csv-importer-run-detail", text: detail.join(" \u00b7 ") });
			}
			if (group.length > LIST_LIMIT) list.createDiv({ cls: "csv-importer-run-note", text: moreRows(group.length - LIST_LIMIT) });
		}
		if (!any) el.createDiv({ cls: "csv-importer-run-note", text: NOTHING_TO_CHANGE });
	}

	// --- report ---

	private async saveReport(result: ImportResult): Promise<void> {
		try {
			const now = new Date();
			const folder = this.ctl.reportFolder;
			const name = `${stamp(now)} ${this.ctl.csvBasename} import report.md`.replace(/[\\/:*?"<>|#^[\]]/g, "-");
			const path = normalizePath(folder ? `${folder}/${name}` : name);
			const lines: string[] = [
				`# Import report: ${this.ctl.csvBasename}`,
				"",
				`- Source: [[${this.ctl.csvPath}]]`,
				`- Date: ${now.toISOString()}`,
				`- Status: ${result.cancelled ? "stopped by user" : "finished"}`,
				"",
				"## Summary",
				"",
				`- New: ${result.created}`,
				`- Updated: ${result.updated}`,
				`- Unchanged: ${result.unchanged}`,
				`- Skipped: ${result.skipped}`,
				`- Failed: ${result.failed}`,
			];
			const section = (title: string, outcome: NoteOutcome, extra: (r: RowOutcome) => string): void => {
				const rows = result.rows.filter((r) => r.outcome === outcome);
				if (rows.length === 0) return;
				lines.push("", `## ${title}`, "");
				for (const r of rows) lines.push(`- Row ${r.row}: [[${r.path.replace(/\.md$/i, "")}]]${extra(r)}`);
			};
			section("Created", "created", () => "");
			section("Updated", "updated", (r) => {
				const parts: string[] = [];
				if (r.changed?.length) parts.push(`changed ${r.changed.join(", ")}`);
				if (r.preserved?.length) parts.push(`kept ${r.preserved.join(", ")}`);
				return parts.length ? ` (${parts.join("; ")})` : "";
			});
			section("Skipped", "skipped", (r) => (r.reason ? ` (${r.reason})` : ""));
			section("Failed", "failed", (r) => (r.reason ? ` (${r.reason})` : ""));
			const content = lines.join("\n") + "\n";
			if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
			const file = await this.app.vault.create(path, content);
			await this.app.workspace.getLeaf("tab").openFile(file);
			this.close();
		} catch (e) {
			new Notice(`Could not save the report: ${errorMessage(e)}`);
		}
	}
}
