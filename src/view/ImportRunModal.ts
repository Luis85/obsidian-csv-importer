import { Modal, Notice, normalizePath } from "obsidian";
import type { App } from "obsidian";
import type { HeaderDrift, ImportResult, NoteOutcome, RowOutcome } from "../types";
import { ROW_REASON, emptyResult } from "../core/result";
import { errorMessage, plural } from "../core/util";
import { renderCallout } from "./dom";

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
const OUTCOME_LABEL: Record<NoteOutcome, string> = {
	created: "New",
	updated: "Updated",
	unchanged: "Unchanged",
	skipped: "Skipped",
	failed: "Failed",
};

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
		this.setTitle("Import preview");
		const root = this.reset();
		root.createDiv({ cls: "csv-importer-run-note", text: "Checking rows…" });
		let result: ImportResult;
		try {
			result = await this.ctl.preview();
		} catch (e) {
			this.reset().createDiv({ cls: "csv-importer-run-error", text: `Preview failed: ${errorMessage(e)}` });
			this.buttons([{ text: "Close", onClick: () => this.close() }]);
			return;
		}
		this.latest = result;
		const el = this.reset();
		const target = this.ctl.targetFolder;
		if (target) el.createDiv({ cls: "csv-importer-run-target", text: `Notes go to ${target}` });
		this.renderWarnings(el, result);
		this.renderDrift(el);
		this.renderStats(el, result);
		this.renderRows(el, result.rows, true);
		const actionable = result.created + result.updated;
		this.buttons([
			{
				text: actionable > 0 ? `Import ${plural(actionable, "note", "notes")}` : "Import",
				cta: true,
				disabled: result.rows.length === 0,
				onClick: () => void this.runImport(),
			},
			{ text: "Cancel", onClick: () => this.close() },
		]);
	}

	private async runImport(): Promise<void> {
		this.running = true;
		this.stop = false;
		this.setTitle("Importing");
		const el = this.reset();
		const bar = el.createEl("progress", { cls: "csv-importer-run-progress" });
		bar.max = 1;
		bar.value = 0;
		const label = el.createDiv({ cls: "csv-importer-run-note", text: "Starting…", attr: { "aria-live": "polite" } });
		const stopBtn = this.buttons([
			{
				text: "Stop import",
				onClick: () => {
					this.stop = true;
					label.setText("Stopping after the current row…");
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
					label.setText(`${done} of ${total} rows`);
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
			this.reset().createDiv({ cls: "csv-importer-run-error", text: `Import failed: ${errorMessage(e)}` });
			this.buttons([{ text: "Close", onClick: () => this.close() }]);
		}
	}

	private showDone(result: ImportResult): void {
		this.setTitle(doneTitle(result));
		const el = this.reset();
		el.setAttr("aria-live", "polite");
		this.renderWarnings(el, result);
		this.renderStats(el, result);
		const problems = result.rows.filter((r) => r.outcome === "skipped" || r.outcome === "failed");
		if (problems.length > 0) {
			el.createEl("h4", { text: "Skipped and failed rows" });
			this.renderRows(el, problems, false);
		}
		const buttons: { text: string; cta?: boolean; onClick: () => void }[] = [
			{ text: "Save report as note", onClick: () => void this.saveReport(result) },
		];
		if (this.undoable && this.ctl.canUndo()) {
			buttons.push({
				text: "Undo import",
				onClick: () => {
					void this.ctl
						.undo()
						.then(() => {
							this.undoable = false;
							if (!this.ctl.canUndo()) this.close();
						})
						.catch((e: unknown) => new Notice(`Undo failed: ${errorMessage(e)}`));
				},
			});
		}
		const first = result.rows.find((r) => r.outcome === "created" || r.outcome === "updated");
		if (first) buttons.push({ text: "Open first note", onClick: () => this.ctl.openNote(first.path) });
		if (this.ctl.basePath() !== null) buttons.push({ text: "Open base", onClick: () => this.ctl.openBase() });
		buttons.push({ text: "Close", cta: true, onClick: () => this.close() });
		this.buttons(buttons);
	}

	// --- rendering helpers ---

	private reset(): HTMLElement {
		this.contentEl.empty();
		return this.contentEl.createDiv({ cls: "csv-importer-run-body" });
	}

	private buttons(defs: { text: string; cta?: boolean; disabled?: boolean; onClick: () => void }[]): HTMLButtonElement[] {
		this.contentEl.find(".csv-importer-run-buttons")?.remove();
		const row = this.contentEl.createDiv({ cls: "modal-button-container csv-importer-run-buttons" });
		return defs.map((d) => {
			const b = row.createEl("button", { text: d.text, cls: d.cta ? "mod-cta" : "" });
			b.disabled = d.disabled === true;
			b.addEventListener("click", d.onClick);
			return b;
		});
	}

	private renderDrift(el: HTMLElement): void {
		const d = this.ctl.drift;
		if (!d || (d.added.length === 0 && d.removed.length === 0)) return;
		const box = el.createDiv({ cls: "csv-importer-run-warning" });
		box.createEl("strong", { text: "The columns of this file changed since the last import." });
		if (d.added.length > 0) box.createDiv({ text: `New columns: ${d.added.join(", ")}` });
		if (d.removed.length > 0) box.createDiv({ text: `Missing columns: ${d.removed.join(", ")}` });
	}

	private renderWarnings(el: HTMLElement, r: ImportResult): void {
		if (!r.warnings || r.warnings.length === 0) return;
		renderCallout(el, "warning", r.warnings);
	}

	private renderStats(el: HTMLElement, r: ImportResult): void {
		const grid = el.createDiv({ cls: "csv-importer-run-stats" });
		const tiles: [string, number, string][] = [
			["New", r.created, "created"],
			["Updated", r.updated, "updated"],
			["Unchanged", r.unchanged, "unchanged"],
			["Skipped", r.skipped, "skipped"],
			["Failed", r.failed, "failed"],
		];
		for (const [name, n, cls] of tiles) {
			const t = grid.createDiv({ cls: `csv-importer-run-tile is-${cls}${n === 0 ? " is-zero" : ""}` });
			t.createDiv({ cls: "csv-importer-run-tile-value", text: String(n) });
			t.createDiv({ cls: "csv-importer-run-tile-label", text: name });
		}
	}

	private renderRows(el: HTMLElement, rows: RowOutcome[], hideUnchanged: boolean): void {
		const shown = hideUnchanged ? rows.filter((r) => r.outcome !== "unchanged") : rows;
		if (shown.length === 0) {
			el.createDiv({ cls: "csv-importer-run-note", text: rows.length === 0 ? "The file has no data rows." : "Nothing to change." });
			return;
		}
		const list = el.createDiv({ cls: "csv-importer-run-list" });
		for (const r of shown.slice(0, LIST_LIMIT)) {
			const item = list.createDiv({ cls: "csv-importer-run-item" });
			item.createSpan({ cls: `csv-importer-run-badge is-${r.outcome}`, text: OUTCOME_LABEL[r.outcome] });
			const main = item.createDiv({ cls: "csv-importer-run-item-main" });
			main.createDiv({ cls: "csv-importer-run-path", text: `Row ${r.row}: ${r.path}` });
			const detail: string[] = [];
			if (r.reason && r.reason !== ROW_REASON.wouldCreate) detail.push(r.reason);
			if (r.outcome === "updated" && r.changed?.length) detail.push(`changes ${r.changed.join(", ")}`);
			if (r.preserved?.length) detail.push(`keeps your edits to ${r.preserved.join(", ")}`);
			if (detail.length > 0) main.createDiv({ cls: "csv-importer-run-detail", text: detail.join(" · ") });
		}
		if (shown.length > LIST_LIMIT) {
			el.createDiv({ cls: "csv-importer-run-note", text: `…and ${shown.length - LIST_LIMIT} more rows.` });
		}
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

function doneTitle(r: ImportResult): string {
	const parts: string[] = [];
	if (r.created > 0) parts.push(`${r.created} created`);
	if (r.updated > 0) parts.push(`${r.updated} updated`);
	if (r.skipped > 0) parts.push(`${r.skipped} skipped`);
	if (r.failed > 0) parts.push(`${r.failed} failed`);
	const head = r.cancelled ? "Import stopped" : "Import finished";
	return parts.length > 0 ? `${head}: ${parts.join(", ")}` : `${head}: nothing to change`;
}
