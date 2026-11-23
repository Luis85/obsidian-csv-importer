import { Modal, Notice } from "obsidian";
import type { App, TFile } from "obsidian";
import type { CsvImporterHost } from "../host";
import type { ConflictStrategy, FileImportConfig } from "../types";
import { errorMessage } from "../core/util";
import { confirmDialog } from "./ConfirmModal";
import { renderCallout } from "./dom";
import { OVERWRITE_CONFIRM } from "./labels";
import { AdvancedSection } from "./config/AdvancedSection";
import { ColumnsSection } from "./config/ColumnsSection";
import { ConfigDraft } from "./config/ConfigDraft";
import { OutputSection } from "./config/OutputSection";
import { PreviewPane } from "./config/PreviewPane";

/** Per-file import settings dialog. Composes the section modules around a shared `ConfigDraft`. */
export class ImportConfigModal extends Modal {
	private readonly draft: ConfigDraft;
	private readonly initialConflict: ConflictStrategy;
	private saving = false;

	private warningsEl!: HTMLElement;
	private readonly columns: ColumnsSection;
	private readonly output: OutputSection;
	private readonly preview: PreviewPane;
	private readonly advanced: AdvancedSection;

	constructor(
		app: App,
		private host: CsvImporterHost,
		private file: TFile,
		text: string,
		private onSaved?: (cfg: FileImportConfig) => void,
	) {
		super(app);
		this.draft = new ConfigDraft(host, file, text);
		this.initialConflict = this.draft.cfg.conflict;
		this.columns = new ColumnsSection(this.draft);
		this.output = new OutputSection(app, this.draft);
		this.preview = new PreviewPane(this.draft);
		this.advanced = new AdvancedSection(this.draft);
	}

	onOpen(): void {
		this.modalEl.addClass("csv-importer-modal");
		this.setTitle(`Import settings: ${this.file.name}`);
		this.draft.reparse();
		this.build();
		this.draft.emit("preview");
		if (this.draft.cfg.encoding === "auto") void this.advanced.detectEncoding();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderWarnings(): void {
		this.warningsEl.empty();
		const warnings = this.draft.parsed?.warnings ?? [];
		if (warnings.length === 0) return;
		renderCallout(this.warningsEl, "warning", warnings);
	}

	private build(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("csv-importer-config-root");
		const el = root.createDiv({ cls: "csv-importer-config" });

		this.preview.buildStatus(el);
		this.warningsEl = el.createDiv();
		this.renderWarnings();
		this.draft.on("parsing", () => this.renderWarnings());

		this.columns.build(el);
		this.output.build(el);
		this.preview.build(el);
		this.advanced.build(el);

		// Footer, outside the scroll area
		const footer = root.createDiv({ cls: "csv-importer-footer modal-button-container" });
		footer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		footer.createEl("button", { text: "Save" }).addEventListener("click", () => void this.save(false));
		footer.createEl("button", { cls: "mod-cta", text: "Save and import" }).addEventListener("click", () => void this.save(true));
	}

	private async save(thenImport: boolean): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		const { cfg } = this.draft;
		try {
			if (cfg.conflict === "overwrite" && this.initialConflict !== "overwrite") {
				const ok = await confirmDialog(this.app, OVERWRITE_CONFIRM.title, OVERWRITE_CONFIRM.message, OVERWRITE_CONFIRM.confirm, true);
				if (!ok) return;
			}
			try {
				await this.host.saveFileConfig(this.file, cfg);
			} catch (e) {
				new Notice(`Could not save settings: ${errorMessage(e)}`);
				return;
			}
			this.onSaved?.(cfg);
			this.close();
			if (thenImport) {
				try {
					await this.host.importFile(this.file, this.draft.text);
				} catch (e) {
					new Notice(`Import failed: ${errorMessage(e)}`);
				}
			}
		} finally {
			this.saving = false;
		}
	}
}
