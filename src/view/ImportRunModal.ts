import { Menu, Modal, Notice, normalizePath, setIcon } from "obsidian";
import type { App } from "obsidian";
import type { HeaderDrift, ImportResult, NoteOutcome, RowOutcome } from "../types";
import { ROW_REASON, emptyResult } from "../core/result";
import { errorMessage } from "../core/util";
import { iconButton, relPath, renderCallout } from "./dom";
import { CLOSE, IMPORT_FINISHED, driftMessage } from "./labels";
import {
	CANCEL, CHECKING_ROWS, IMPORTING_TITLE, MORE_ACTIONS, NOTHING_TO_CHANGE, NO_DATA_ROWS, OPEN_BASE, OPEN_FIRST_NOTE, OUTCOME_LABEL,
	OUTCOME_ORDER, PREVIEW_TITLE, SAVE_REPORT, STARTING, STOPPING, STOP_IMPORT, UNDO_IMPORT, calloutTitle, countsLine, moreRows,
	previewImportLabel, rowsProgress, runHeadline, selectGroupLabel, selectNoteLabel, targetLine,
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
		/**
		 * Original 1-based data row numbers to import (`ParsedCsv.rowNumbers`). Set only when the user unchecked
		 * rows in the preview: it lists every previewed row that stays checked, plus the rows that need no
		 * decision (unchanged, skipped, failed), so the report still covers them. Undefined means the whole run.
		 */
		rows?: number[];
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

/** Rows that need a look: failed and skipped. */
function attention(r: ImportResult): number {
	return r.failed + r.skipped;
}

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
	/** Row numbers of New and Updated notes the user unchecked in the preview. */
	private readonly excluded = new Set<number>();
	/** Redraw callbacks of the checkboxes (group headers and rows). */
	private syncChecks: (() => void)[] = [];
	private importBtn: HTMLButtonElement | null = null;
	private resolveClosed!: (r: ImportResult) => void;
	readonly closed: Promise<ImportResult>;

	constructor(
		app: App,
		private readonly ctl: ImportRunControls,
	) {
		super(app);
		this.closed = new Promise((resolve) => (this.resolveClosed = resolve));
		this.modalEl.addClass("csv-importer-run");
		this.modalEl.setAttr("data-testid", "import-run-modal");
	}

	override onOpen(): void {
		void this.showPreview();
	}

	override close(): void {
		if (this.running) {
			new Notice("Use the stop button to end the import.");
			return;
		}
		super.close();
	}

	override onClose(): void {
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
		this.excluded.clear();
		this.syncChecks = [];
		const el = this.reset();
		this.renderHead(result, "preview");
		this.renderWarnings(el, result, true);
		this.renderGroups(el, result.rows, true);
		const [importBtn] = this.buttons([
			{
				text: previewImportLabel(result.created + result.updated),
				cta: true,
				disabled: result.rows.length === 0,
				testid: "run-import",
				onClick: () => void this.runImport(),
			},
			{ text: CANCEL, onClick: () => this.close() },
		]);
		this.importBtn = importBtn ?? null;
		this.syncSelection();
	}

	/** Rows that New and Updated groups offer a checkbox for. */
	private actionableRows(): RowOutcome[] {
		return (this.latest?.rows ?? []).filter((r) => r.outcome === "created" || r.outcome === "updated");
	}

	/** Keeps the checkboxes and the import button's label in line with what is unchecked. */
	private syncSelection(): void {
		for (const sync of this.syncChecks) sync();
		const btn = this.importBtn;
		if (!btn || !this.latest) return;
		const total = this.actionableRows().length;
		const selected = total - this.excluded.size;
		btn.setText(previewImportLabel(selected, total));
		this.headlineEl?.setText(runHeadline("preview", selected, attention(this.latest), this.ctl.targetFolder));
		btn.disabled = this.latest.rows.length === 0 || (total > 0 && selected === 0);
	}

	/** The rows to pass to the run, or undefined when everything stays checked. */
	private selectedRows(): number[] | undefined {
		if (this.excluded.size === 0 || !this.latest) return undefined;
		return this.latest.rows.filter((r) => !this.excluded.has(r.row)).map((r) => r.row);
	}

	private async runImport(): Promise<void> {
		this.running = true;
		this.stop = false;
		this.setTitle(IMPORTING_TITLE);
		const el = this.reset();
		this.renderHead(null, "progress");
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
			const rows = this.selectedRows();
			const outcome = await this.ctl.execute({
				...(rows ? { rows } : {}),
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
			if (stopBtn) stopBtn.disabled = true;
			renderCallout(this.reset(), "error", { title: "Import failed", items: [errorMessage(e)] });
			this.buttons([{ text: CLOSE, cta: true, onClick: () => this.close() }]);
		}
	}

	private showDone(result: ImportResult): void {
		this.setTitle(result.cancelled ? "Import stopped" : IMPORT_FINISHED);
		const el = this.reset();
		this.renderHead(result, result.cancelled ? "stopped" : "done");
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
		// Opening the result is where the user is headed: open it and get the dialog out of the way.
		const openBase = (): void => {
			this.ctl.openBase();
			this.close();
		};
		const openFirst = (path: string): void => {
			this.ctl.openNote(path);
			this.close();
		};

		// The next step is the CTA (UX review finding 16): Open base when there is a base, else Open first note.
		// Close is always a plain button. Everything else is in the "More actions" menu.
		const row = this.footer();
		let primary: HTMLButtonElement | null = null;
		if (hasBase) {
			primary = row.createEl("button", {
				text: OPEN_BASE,
				cls: "mod-cta csv-importer-run-primary csv-importer-run-base",
				attr: { type: "button", "data-testid": "run-open-base" },
			});
			primary.addEventListener("click", openBase);
		} else if (first) {
			primary = row.createEl("button", {
				text: OPEN_FIRST_NOTE,
				cls: "mod-cta csv-importer-run-primary csv-importer-run-first",
				attr: { type: "button", "data-testid": "run-open-note" },
			});
			primary.addEventListener("click", () => openFirst(first.path));
		}
		row.toggleClass("has-primary", primary !== null);
		const close = row.createEl("button", { text: CLOSE, cls: "csv-importer-run-close", attr: { type: "button", "data-testid": "run-close" } });
		close.addEventListener("click", () => this.close());
		const more = iconButton(row, {
			icon: "more-horizontal",
			label: MORE_ACTIONS,
			cls: "csv-importer-run-more",
			onClick: (ev) => {
				const menu = new Menu();
				if (first && hasBase) menu.addItem((i) => i.setTitle(OPEN_FIRST_NOTE).setIcon("file-text").onClick(() => openFirst(first.path)));
				menu.addItem((i) => i.setTitle(SAVE_REPORT).setIcon("file-plus").onClick(() => void this.saveReport(result)));
				if (canUndo) {
					menu.addSeparator();
					menu.addItem((i) => i.setTitle(UNDO_IMPORT).setIcon("undo-2").setWarning(true).onClick(undo));
				}
				menu.showAtMouseEvent(ev);
			},
		});
		more.setAttr("data-testid", "run-more");
		(primary ?? close).focus();
	}

	// --- rendering helpers ---

	private headEl: HTMLElement | null = null;
	/** Headline sentence of the preview; follows the checkboxes. */
	private headlineEl: HTMLElement | null = null;

	/** Clears the dialog and returns the scrolling body. Header and footer sit outside of it. */
	private reset(): HTMLElement {
		this.contentEl.empty();
		this.headEl = this.contentEl.createDiv({ cls: "csv-importer-run-head" });
		return this.contentEl.createDiv({ cls: "csv-importer-run-body" });
	}

	/**
	 * Sticky header. With a result: a one-sentence headline (what will be or was written, and where, UX review
	 * finding 15) above the muted counts line. While importing: the target folder.
	 */
	private renderHead(result: ImportResult | null, phase: "preview" | "progress" | "done" | "stopped"): void {
		const head = this.headEl;
		this.headlineEl = null;
		if (!head) return;
		const target = this.ctl.targetFolder;
		if (!result || phase === "progress") {
			if (target) head.createDiv({ cls: "csv-importer-run-target", text: targetLine(target) });
			return;
		}
		const headline = head.createDiv({
			cls: "csv-importer-run-headline",
			text: runHeadline(phase, result.created + result.updated, attention(result), target),
			attr: { "data-testid": "run-headline" },
		});
		if (phase === "preview") this.headlineEl = headline;
		const line = head.createDiv({ cls: "csv-importer-run-counts", text: countsLine(result) });
		if (phase !== "preview") line.setAttr("role", "status");
	}

	private footer(): HTMLElement {
		this.contentEl.find(".csv-importer-run-buttons")?.remove();
		return this.contentEl.createDiv({ cls: "modal-button-container csv-importer-run-buttons" });
	}

	private buttons(defs: { text: string; cta?: boolean; disabled?: boolean; testid?: string; onClick: () => void }[]): HTMLButtonElement[] {
		const row = this.footer();
		return defs.map((d) => {
			const b = row.createEl("button", { text: d.text, cls: d.cta ? "mod-cta" : "", attr: { type: "button" } });
			if (d.testid) b.setAttr("data-testid", d.testid);
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
		// A title that names the problem, or "2 things to check" for unrelated ones (UX review finding 2).
		if (items.length > 0) renderCallout(el, "warning", { title: calloutTitle(items), items });
	}

	/** Rows grouped by outcome: failed and skipped open, new and updated open when short, unchanged closed. */
	private renderGroups(el: HTMLElement, rows: RowOutcome[], selectable = false): void {
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
			const canSelect = selectable && (outcome === "created" || outcome === "updated");
			if (canSelect) this.groupCheckbox(summary, group, OUTCOME_LABEL[outcome]);
			summary.createSpan({ cls: "csv-importer-run-group-name", text: OUTCOME_LABEL[outcome] });
			summary.createSpan({ cls: "csv-importer-run-group-count", text: String(group.length) });
			const list = details.createDiv({ cls: "csv-importer-run-list" });
			for (const r of group.slice(0, LIST_LIMIT)) {
				const item = list.createEl(canSelect ? "label" : "div", { cls: "csv-importer-run-item" });
				if (canSelect) this.rowCheckbox(item, r);
				const text = item.createDiv({ cls: "csv-importer-run-text" });
				const line = text.createDiv({ cls: "csv-importer-run-path" });
				line.createSpan({ text: relPath(r.path, folder) });
				line.createSpan({ cls: "csv-importer-run-row", text: ` \u00b7 row ${r.row}` });
				const detail: string[] = [];
				if (r.reason && r.reason !== ROW_REASON.wouldCreate) detail.push(r.reason);
				if (r.outcome === "updated" && r.changed?.length) detail.push(`changes ${r.changed.join(", ")}`);
				if (r.preserved?.length) detail.push(`keeps your edits to ${r.preserved.join(", ")}`);
				if (detail.length > 0) text.createDiv({ cls: "csv-importer-run-detail", text: detail.join(" \u00b7 ") });
			}
			if (group.length > LIST_LIMIT) list.createDiv({ cls: "csv-importer-run-note", text: moreRows(group.length - LIST_LIMIT) });
		}
		if (!any) el.createDiv({ cls: "csv-importer-run-note", text: NOTHING_TO_CHANGE });
	}

	/** Checkbox in a group header: includes or excludes every row of the group, also those beyond the list limit. */
	private groupCheckbox(summary: HTMLElement, group: RowOutcome[], name: string): void {
		const box = summary.createEl("input", {
			cls: "csv-importer-check csv-importer-run-group-check",
			type: "checkbox",
			attr: { "aria-label": selectGroupLabel(name, group.length), "data-testid": "run-group-check" },
		});
		// A click on the box must not open or close the group.
		box.addEventListener("click", (ev) => {
			ev.stopPropagation();
			for (const r of group) {
				if (box.checked) this.excluded.delete(r.row);
				else this.excluded.add(r.row);
			}
			this.syncSelection();
		});
		this.syncChecks.push(() => {
			const off = group.filter((r) => this.excluded.has(r.row)).length;
			box.checked = off === 0;
			box.indeterminate = off > 0 && off < group.length;
		});
	}

	private rowCheckbox(item: HTMLElement, r: RowOutcome): void {
		// A class instead of `:has(.csv-importer-check)` in CSS, which the review flags for selector invalidation cost.
		item.addClass("mod-selectable");
		const box = item.createEl("input", {
			cls: "csv-importer-check",
			type: "checkbox",
			attr: { "aria-label": selectNoteLabel(r.row), "data-testid": "run-row-check", "data-row": String(r.row) },
		});
		box.checked = !this.excluded.has(r.row);
		box.addEventListener("change", () => {
			if (box.checked) this.excluded.delete(r.row);
			else this.excluded.add(r.row);
			this.syncSelection();
		});
		this.syncChecks.push(() => (box.checked = !this.excluded.has(r.row)));
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
