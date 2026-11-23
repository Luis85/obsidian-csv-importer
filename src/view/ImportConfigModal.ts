import { Modal, Notice } from "obsidian";
import type { App, TFile } from "obsidian";
import type { CsvImporterHost } from "../host";
import type { ConflictStrategy, FileImportConfig } from "../types";
import { errorMessage, plural } from "../core/util";
import { confirmDialog } from "./ConfirmModal";

import { countMatching } from "../import/noteBuilder";
import { createDefaultFileConfig } from "../defaults";
import { renderCallout, safeTargetFolder } from "./dom";
import { CANCEL, CONFIG_TABS, IMPORT_NOW, OVERWRITE_CONFIRM, SAVE, delimiterLabel } from "./labels";
import { KEY_NONE, PREVIEW, PREVIEW_TOGGLE_TITLE, REVIEW_FILE_SETTINGS, SUMMARY_LABEL, filteredSummary } from "./config/copy";
import { Tabs } from "./config/Tabs";
import { AdvancedSection } from "./config/AdvancedSection";
import { ColumnsSection } from "./config/ColumnsSection";
import { ExtraPropertiesSection } from "./config/ExtraPropertiesSection";
import { ConfigDraft } from "./config/ConfigDraft";
import { OutputSection } from "./config/OutputSection";
import { PreviewPane } from "./config/PreviewPane";

const TAB_DEFS = [
	{ id: "columns", label: CONFIG_TABS.columns },
	{ id: "notes", label: CONFIG_TABS.notes },
	{ id: "reimport", label: CONFIG_TABS.reimport },
	{ id: "file", label: CONFIG_TABS.file },
];

/** Per-file import settings dialog. Composes the section modules around a shared `ConfigDraft`. */
export class ImportConfigModal extends Modal {
	private readonly draft: ConfigDraft;
	private readonly initialConflict: ConflictStrategy;
	private saving = false;

	private warningsEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private tabs!: Tabs;
	private previewToggle: HTMLButtonElement | null = null;
	private readonly columns: ColumnsSection;
	private readonly extras: ExtraPropertiesSection;
	private readonly output: OutputSection;
	private readonly preview: PreviewPane;
	private readonly advanced: AdvancedSection;

	constructor(
		app: App,
		private host: CsvImporterHost,
		private file: TFile,
		text: string,
		private onSaved?: (cfg: FileImportConfig) => void,
		/** Tab to open first ("columns", "notes", "reimport" or "file"); overrides the default choice. */
		private readonly initialTab?: string,
	) {
		super(app);
		this.draft = new ConfigDraft(host, file, text);
		this.initialConflict = this.draft.cfg.conflict;
		this.columns = new ColumnsSection(this.draft);
		this.extras = new ExtraPropertiesSection(this.draft);
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
		renderCallout(this.warningsEl, "warning", { items: warnings, action: { label: REVIEW_FILE_SETTINGS, onClick: () => this.tabs.select("file", true) } });
	}

	/** Tabs whose settings differ from the defaults get a dot. */
	private updateDots(): void {
		const cfg = this.draft.cfg;
		const d = createDefaultFileConfig(this.host.settings);
		const differs = (keys: (keyof FileImportConfig)[]): boolean => keys.some((k) => JSON.stringify(cfg[k]) !== JSON.stringify(d[k]));
		const columnsChanged = cfg.extraProperties.length > 0 || cfg.columns.some((c) => !c.include || !!c.valueTemplate || !!c.stripUnits);
		this.tabs.setChanged("columns", columnsChanged);
		this.tabs.setChanged("notes", differs(["targetFolder", "fileNameTemplate", "bodyTemplate", "tags", "addSourceLink", "createBase"]));
		this.tabs.setChanged("reimport", differs(["conflict", "protectEdits", "keepValuesOnEmpty", "adoptExistingNotes", "keyColumn", "keyColumns"]));
		this.tabs.setChanged(
			"file",
			differs(["encoding", "delimiter", "hasHeader", "decimalSeparator", "dateOrder", "listSeparator", "emptyValues", "numberPrecision", "rowFilter"]),
		);
	}

	/** `6 rows · comma · → Data/timesheet/ · key: Datum + Rolle · filter: 4 of 6 rows`, each part linking to its tab. */
	private renderSummary(): void {
		const el = this.summaryEl;
		el.empty();
		const { parsed, cfg, file } = this.draft;
		const parts: { text: string; tab: string; muted?: boolean }[] = [];
		if (parsed) {
			parts.push({ text: plural(parsed.rows.length, "row", "rows"), tab: "file" });
			parts.push({ text: delimiterLabel(parsed.delimiter), tab: "file" });
		} else {
			parts.push({ text: "No table", tab: "file" });
		}
		const folder = safeTargetFolder(cfg, file.path);
		if (folder) parts.push({ text: `\u2192 ${folder}/`, tab: "notes" });
		const keys = cfg.keyColumns.length > 0 ? cfg.keyColumns : cfg.keyColumn ? [cfg.keyColumn] : [];
		parts.push(keys.length > 0 ? { text: `key: ${keys.join(" + ")}`, tab: "reimport" } : { text: KEY_NONE, tab: "reimport", muted: true });
		if (cfg.rowFilter && parsed) {
			let matching = 0;
			try {
				matching = countMatching(parsed, cfg);
			} catch {
				matching = 0;
			}
			parts.push({ text: filteredSummary(matching, parsed.rows.length), tab: "file" });
		}
		parts.forEach((part, i) => {
			if (i > 0) el.createSpan({ cls: "csv-importer-summary-sep", text: "\u00b7", attr: { "aria-hidden": "true" } });
			const btn = el.createEl("button", { cls: "csv-importer-summary-link", text: part.text, attr: { type: "button" } });
			btn.toggleClass("is-muted", part.muted === true);
			btn.addEventListener("click", () => {
				this.setPreviewOpen(false);
				this.tabs.select(part.tab, true);
			});
		});
	}

	private setPreviewOpen(open: boolean): void {
		this.contentEl.toggleClass("is-preview-open", open);
		this.previewToggle?.setAttr("aria-pressed", String(open));
	}

	private build(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("csv-importer-config-root");

		this.summaryEl = root.createDiv({ cls: "csv-importer-summary", attr: { role: "group", "aria-label": SUMMARY_LABEL } });
		this.tabs = new Tabs(root, createDiv(), TAB_DEFS, "csv-importer-config", () => this.setPreviewOpen(false));
		// The tab bar sits under the summary; the panels live in the scroll area next to the preview pane.
		const main = root.createDiv({ cls: "csv-importer-config-main" });
		const scroll = main.createDiv({ cls: "csv-importer-config" });
		this.warningsEl = scroll.createDiv();
		for (const panel of this.tabs.panels.values()) scroll.appendChild(panel);
		const pane = main.createDiv({ cls: "csv-importer-preview-pane" });
		this.preview.build(pane);

		const panel = (id: string): HTMLElement => this.tabs.panels.get(id) as HTMLElement;
		this.columns.build(panel("columns"));
		this.extras.build(panel("columns"));
		this.output.buildNotes(panel("notes"));
		this.advanced.buildNotesContent(panel("notes"));
		this.output.buildReimport(panel("reimport"));
		this.advanced.buildAdopt(panel("reimport"));
		this.advanced.buildFile(panel("file"));

		this.renderWarnings();
		this.draft.on("parsing", () => this.renderWarnings());
		this.draft.on("preview", () => {
			this.renderSummary();
			this.updateDots();
		});
		// Settings that do not refresh the preview (toggles, dropdowns) still change the dots.
		scroll.addEventListener("change", () => this.updateDots());
		scroll.addEventListener("input", () => this.updateDots());
		if (this.initialTab) this.tabs.select(this.initialTab);
		else if (this.draft.looksWrong()) this.tabs.select("file");
		this.renderSummary();
		this.updateDots();

		// Footer, outside the scroll area
		const footer = root.createDiv({ cls: "csv-importer-footer modal-button-container" });
		const toggle = footer.createEl("button", { cls: "csv-importer-preview-toggle", text: PREVIEW, attr: { type: "button", "aria-pressed": "false", title: PREVIEW_TOGGLE_TITLE } });
		toggle.addEventListener("click", () => this.setPreviewOpen(!root.hasClass("is-preview-open")));
		this.previewToggle = toggle;
		footer.createEl("button", { cls: "mod-cta", text: IMPORT_NOW }).addEventListener("click", () => void this.save(true));
		footer.createEl("button", { text: SAVE }).addEventListener("click", () => void this.save(false));
		footer.createEl("button", { cls: "csv-importer-cancel", text: CANCEL }).addEventListener("click", () => this.close());
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
