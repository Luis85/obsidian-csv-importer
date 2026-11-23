import { Modal, Notice, normalizePath } from "obsidian";
import type { App } from "obsidian";
import type { ImportResult, NoteOutcome, RowOutcome } from "../types";

export interface HeaderDrift {
	added: string[];
	removed: string[];
}

/** What the dialog needs from the plugin; keeps it free of vault logic. */
export interface ImportRunControls {
	csvPath: string;
	csvBasename: string;
	/** Folder where the report note is written. */
	reportFolder: string;
	drift: HeaderDrift | null;
	/** Dry run: computes outcomes without writing. */
	preview(): Promise<ImportResult>;
	/** Real run. */
	execute(opts: { onProgress: (done: number, total: number) => void; shouldStop: () => boolean }): Promise<ImportResult>;
	canUndo(): boolean;
	undo(): Promise<void>;
}

const LIST_LIMIT = 200;
const OUTCOME_LABEL: Record<NoteOutcome, string> = {
	created: "New",
	updated: "Update",
	unchanged: "Unchanged",
	skipped: "Skip",
	failed: "Fail",
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

	onClose(): void {
		this.stop = true;
		this.contentEl.empty();
		this.resolveClosed(this.finished ?? this.latest ?? emptyResult());
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
			this.reset().createDiv({ cls: "csv-importer-run-error", text: `Preview failed: ${errText(e)}` });
			this.buttons([{ text: "Close", onClick: () => this.close() }]);
			return;
		}
		this.latest = result;
		const el = this.reset();
		this.renderDrift(el);
		this.renderStats(el, result);
		this.renderRows(el, result.rows, true);
		const actionable = result.created + result.updated;
		this.buttons([
			{
				text: actionable > 0 ? `Import ${actionable} ${actionable === 1 ? "note" : "notes"}` : "Import",
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
		const label = el.createDiv({ cls: "csv-importer-run-note", text: "Starting…" });
		const stopBtn = this.buttons([
			{
				text: "Stop",
				onClick: () => {
					this.stop = true;
					label.setText("Stopping after the current row…");
				},
			},
		])[0];
		let lastPaint = 0;
		try {
			const result = await this.ctl.execute({
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
			this.finished = result;
			this.showDone(result);
		} catch (e) {
			this.running = false;
			stopBtn.disabled = true;
			this.reset().createDiv({ cls: "csv-importer-run-error", text: `Import failed: ${errText(e)}` });
			this.buttons([{ text: "Close", onClick: () => this.close() }]);
		}
	}

	private showDone(result: ImportResult): void {
		this.setTitle(result.cancelled ? "Import stopped" : "Import finished");
		const el = this.reset();
		this.renderStats(el, result);
		const problems = result.rows.filter((r) => r.outcome === "skipped" || r.outcome === "failed");
		if (problems.length > 0) {
			el.createEl("h4", { text: "Skipped and failed rows" });
			this.renderRows(el, problems, false);
		}
		const buttons = [
			{ text: "Save report", cta: true, onClick: () => void this.saveReport(result) },
			...(this.ctl.canUndo()
				? [
						{
							text: "Undo import",
							onClick: () => {
								void this.ctl.undo().then(() => {
									if (!this.ctl.canUndo()) this.close();
								});
							},
						},
					]
				: []),
			{ text: "Close", onClick: () => this.close() },
		];
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

	private renderStats(el: HTMLElement, r: ImportResult): void {
		const grid = el.createDiv({ cls: "csv-importer-run-stats" });
		const tiles: [string, number, string][] = [
			["New", r.created, "created"],
			["Update", r.updated, "updated"],
			["Unchanged", r.unchanged, "unchanged"],
			["Skip", r.skipped, "skipped"],
			["Fail", r.failed, "failed"],
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
			if (r.reason && r.reason !== "would create") detail.push(r.reason);
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
			new Notice(`Could not save the report: ${errText(e)}`);
		}
	}
}

function errText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function emptyResult(): ImportResult {
	return { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, cancelled: false, dryRun: true, rows: [], errors: [] };
}
