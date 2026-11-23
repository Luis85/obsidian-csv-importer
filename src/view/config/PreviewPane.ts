import { setIcon } from "obsidian";
import type { ParsedCsv } from "../../types";
import { planNotes, rowMatches, serializeNote } from "../../import/noteBuilder";
import { errorMessage } from "../../core/util";
import type { ConfigDraft } from "./ConfigDraft";
import { NO_ROWS_MATCH_FILTER, PREVIEW, rowOfFiltered } from "./copy";

/** The "Preview" pane: the note of one row, with a pager that only steps through rows that pass the row filter. */
export class PreviewPane {
	private previewEl: HTMLElement | null = null;
	private previewPosEl!: HTMLElement;
	private previewPrevBtn!: HTMLButtonElement;
	private previewNextBtn!: HTMLButtonElement;

	constructor(private readonly draft: ConfigDraft) {}

	/** Build into `el`, the pane element (its own scroll area). */
	build(el: HTMLElement): void {
		el.createEl("h3", { cls: "csv-importer-pane-title", text: PREVIEW });
		const nav = el.createDiv({ cls: "csv-importer-preview-nav" });
		this.previewPrevBtn = nav.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": "Previous row" } });
		setIcon(this.previewPrevBtn, "chevron-left");
		this.previewPosEl = nav.createSpan({ cls: "csv-importer-preview-pos", attr: { "aria-live": "polite" } });
		this.previewNextBtn = nav.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": "Next row" } });
		setIcon(this.previewNextBtn, "chevron-right");
		this.previewPrevBtn.addEventListener("click", () => this.step(-1));
		this.previewNextBtn.addEventListener("click", () => this.step(1));
		this.previewEl = el.createEl("pre", { cls: "csv-importer-preview" });
		this.draft.on("preview", () => this.update());
	}

	/** Indices (into parsed.rows) of the rows that pass the row filter. */
	private visibleRows(): number[] {
		const { parsed, cfg } = this.draft;
		if (!parsed) return [];
		const out: number[] = [];
		parsed.rows.forEach((r, i) => {
			if (rowMatches(cfg.rowFilter, parsed.headers, r, cfg.decimalSeparator)) out.push(i);
		});
		return out;
	}

	private step(delta: number): void {
		const n = this.visibleRows().length;
		if (n === 0) return;
		this.draft.previewRow = Math.min(n - 1, Math.max(0, this.draft.previewRow + delta));
		this.update();
	}

	/** `draft.previewRow` is a position in the filtered list of rows. */
	update(): void {
		const previewEl = this.previewEl;
		if (!previewEl) return;
		const { parsed, parseError, cfg, file } = this.draft;
		const total = parsed?.rows.length ?? 0;
		const visible = this.visibleRows();
		const pos = Math.min(Math.max(0, this.draft.previewRow), Math.max(0, visible.length - 1));
		this.draft.previewRow = pos;
		this.previewPrevBtn.disabled = pos <= 0;
		this.previewNextBtn.disabled = pos >= visible.length - 1;
		const filtered = cfg.rowFilter !== null;
		this.previewPosEl.setText(visible.length > 0 ? rowOfFiltered(pos + 1, visible.length, filtered) : total > 0 && filtered ? NO_ROWS_MATCH_FILTER : "No rows");
		if (parseError || !parsed) {
			previewEl.setText(parseError ? `Could not read this file as a table: ${parseError}` : "The file is empty.");
			return;
		}
		if (total === 0) {
			previewEl.setText("The file has no data rows.");
			return;
		}
		if (visible.length === 0) {
			previewEl.setText(NO_ROWS_MATCH_FILTER);
			return;
		}
		try {
			const row = visible[pos];
			if (row === undefined) return;
			// Plan the rows up to the selected one so duplicate names and {{row}} match the real import.
			const upTo: ParsedCsv = {
				...parsed,
				rows: parsed.rows.slice(0, row + 1),
				rowNumbers: parsed.rowNumbers.slice(0, row + 1),
			};
			const notes = planNotes(upTo, cfg, { path: file.path, basename: file.basename });
			const wanted = parsed.rowNumbers[row] ?? row + 1;
			const note = notes.find((n) => n.row === wanted);
			previewEl.setText(
				note ? `${note.path}\n\n${serializeNote(note.frontmatter, note.body, note.types)}` : "This row would be skipped because every cell is empty.",
			);
		} catch (e) {
			previewEl.setText(`Preview unavailable: ${errorMessage(e)}`);
		}
	}
}
