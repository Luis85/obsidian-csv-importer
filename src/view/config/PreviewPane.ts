import { setIcon } from "obsidian";
import type { ParsedCsv } from "../../types";
import { planNotes, serializeNote } from "../../import/noteBuilder";
import { errorMessage, plural } from "../../core/util";
import { safeTargetFolder, sectionHeading } from "../dom";
import { delimiterLabel } from "../labels";
import type { ConfigDraft } from "./ConfigDraft";

/** The status line at the top of the dialog and the "Preview" section with the note of one row. */
export class PreviewPane {
	private statusEl!: HTMLElement;
	private previewEl: HTMLElement | null = null;
	private previewPosEl!: HTMLElement;
	private previewPrevBtn!: HTMLButtonElement;
	private previewNextBtn!: HTMLButtonElement;

	constructor(private readonly draft: ConfigDraft) {}

	buildStatus(parent: HTMLElement): void {
		this.statusEl = parent.createDiv({ cls: "csv-importer-config-status" });
	}

	build(el: HTMLElement): void {
		sectionHeading(el, "Preview");
		const nav = el.createDiv({ cls: "csv-importer-preview-nav" });
		this.previewPrevBtn = nav.createEl("button", { cls: "csv-importer-icon-btn", attr: { type: "button", "aria-label": "Previous row" } });
		setIcon(this.previewPrevBtn, "chevron-left");
		this.previewPosEl = nav.createSpan({ cls: "csv-importer-preview-pos", attr: { "aria-live": "polite" } });
		this.previewNextBtn = nav.createEl("button", { cls: "csv-importer-icon-btn", attr: { type: "button", "aria-label": "Next row" } });
		setIcon(this.previewNextBtn, "chevron-right");
		this.previewPrevBtn.addEventListener("click", () => this.step(-1));
		this.previewNextBtn.addEventListener("click", () => this.step(1));
		this.previewEl = el.createEl("pre", { cls: "csv-importer-preview" });
		this.draft.on("preview", () => this.update());
	}

	private step(delta: number): void {
		const n = this.draft.parsed?.rows.length ?? 0;
		if (n === 0) return;
		this.draft.previewRow = Math.min(n - 1, Math.max(0, this.draft.previewRow + delta));
		this.update();
	}

	update(): void {
		const previewEl = this.previewEl;
		if (!previewEl) return;
		const { parsed, parseError, cfg, file } = this.draft;
		this.statusEl.empty();
		const rowCount = parsed?.rows.length ?? 0;
		const row = Math.min(Math.max(0, this.draft.previewRow), Math.max(0, rowCount - 1));
		this.draft.previewRow = row;
		this.previewPrevBtn.disabled = row <= 0;
		this.previewNextBtn.disabled = row >= rowCount - 1;
		this.previewPosEl.setText(rowCount > 0 ? `Row ${row + 1} of ${rowCount}` : "No rows");
		if (parsed) {
			const folder = safeTargetFolder(cfg, file.path);
			const parts = [plural(rowCount, "row", "rows"), plural(parsed.headers.length, "column", "columns"), delimiterLabel(parsed.delimiter)];
			if (folder) parts.push(`notes go to ${folder}/`);
			this.statusEl.setText(parts.join(" · "));
		}
		if (parseError || !parsed) {
			previewEl.setText(parseError ? `Could not read this file as a table: ${parseError}` : "The file is empty.");
			return;
		}
		if (rowCount === 0) {
			previewEl.setText("The file has no data rows.");
			return;
		}
		try {
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
