import { Menu, TextFileView, WorkspaceLeaf, Notice, setIcon, setTooltip, debounce } from "obsidian";
import type { CsvImporterHost } from "../host";
import type { ColumnConfig, FileImportConfig, ParsedCsv, PropertyType } from "../types";
import { parseCsv } from "../csv/parser";
import { detectHeaderDrift, prepareConfig } from "../csv/typeInference";
import { errorMessage, plural } from "../core/util";
import { countMatching } from "../import/noteBuilder";
import { ImportConfigModal } from "./ImportConfigModal";
import { TableRenderer } from "./TableRenderer";
import { renderCallout, safeTargetFolder } from "./dom";
import { REVIEW_COLUMNS, TYPE_LABELS, delimiterLabel, driftMessage, importRowsLabel, NO_ROWS } from "./labels";
import { relativeTime } from "./relativeTime";
import {
	CHECK_DELIMITER, COLUMNS_CHANGED_TITLE, CONFIGURE_IMPORT, FILTER_LABEL, FILTER_PLACEHOLDER, FIRST_IMPORT_TITLE,
	READ_ERROR_TITLE, ROW_FILTER_TITLE, UNDO, filterBullet, firstImportItems, importedAgo,
} from "./runCopy";
import { LINK_TEMPLATE } from "./shared";

export const VIEW_TYPE_CSV = "csv-importer-view";

/** Parse result cached per (text, delimiter, header, encoding) so renders do not re-parse the file. */
interface ParseCache {
	raw: string;
	delimiter: string;
	hasHeader: boolean;
	encoding: string;
	parsed: ParsedCsv | null;
	error: string | null;
	/** Lowercased text per row, built lazily on the first filter. */
	lowerRows: string[] | null;
}

export class CsvView extends TextFileView {
	/** Decoded text used for display and import (may differ from the bytes Obsidian loaded). */
	private raw = "";
	/** Exact data Obsidian gave us in setViewData; returned from getViewData so nothing is rewritten. */
	private fileData = "";
	private pendingDecode: Promise<void> | null = null;
	private importing = false;
	private parseCache: ParseCache | null = null;
	private readonly table = new TableRenderer({
		pageSize: () => this.host.settings.pageSize || 200,
		lowerRows: (parsed) => this.lowerRows(parsed),
		requestRender: () => this.renderBody(),
		openTypeMenu: (ev, index) => this.openTypeMenu(ev, index),
	});
	private model: { cfg: FileImportConfig; parsed: ParsedCsv | null; columns: ColumnConfig[]; error: string | null } | null = null;

	private toolbarEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private importBtn: HTMLButtonElement | null = null;
	private bannerEl: HTMLElement | null = null;
	private loadCounter = 0;

	private readonly onSearch = debounce((value: string) => {
		this.table.setQuery(value);
		this.renderBody();
	}, 200, true);

	constructor(leaf: WorkspaceLeaf, private host: CsvImporterHost) {
		super(leaf);
		this.addAction("file-plus", "Import rows as notes", () => void this.runImport());
	}

	getViewType(): string {
		return VIEW_TYPE_CSV;
	}

	override getDisplayText(): string {
		return this.file ? this.file.basename : "CSV";
	}

	override getIcon(): string {
		return "table";
	}

	getViewData(): string {
		return this.fileData;
	}

	/** The view is strictly read-only: never write the (possibly re-decoded) text back to the CSV. */
	override save(_clear?: boolean): Promise<void> {
		return Promise.resolve();
	}

	setViewData(data: string, clear: boolean): void {
		this.fileData = data;
		this.raw = data;
		if (clear) {
			this.table.reset();
		}
		this.render();
		const pending = this.redecodeIfNeeded();
		this.pendingDecode = pending;
		void pending.finally(() => {
			if (this.pendingDecode === pending) this.pendingDecode = null;
		});
	}

	/** Obsidian reads text files as UTF-8; re-read with the configured encoding when that is wrong. */
	private async redecodeIfNeeded(): Promise<void> {
		const file = this.file;
		if (!file) return;
		const id = ++this.loadCounter;
		const enc = this.host.getFileConfig(file).encoding;
		const suspicious = enc !== "utf-8" || this.raw.includes("\uFFFD") || this.raw.includes("\u0000");
		if (!suspicious) return;
		try {
			const text = await this.host.readCsv(file);
			if (id !== this.loadCounter || this.file !== file) return;
			if (text !== this.raw) {
				this.raw = text;
				this.render();
			}
		} catch (e) {
			new Notice(`Could not read the file: ${errorMessage(e)}`);
		}
	}

	clear(): void {
		this.loadCounter++;
		this.pendingDecode = null;
		this.fileData = "";
		this.raw = "";
		this.table.reset();
		this.render();
	}

	private ensureSkeleton(): void {
		if (this.toolbarEl && this.toolbarEl.isConnected) return;
		this.contentEl.empty();
		this.contentEl.addClass("csv-importer-view");
		this.toolbarEl = this.contentEl.createDiv({ cls: "csv-importer-toolbar" });
		this.statusEl = this.contentEl.createDiv({ cls: "csv-importer-status" });
		this.bannerEl = this.contentEl.createDiv({ cls: "csv-importer-banner-slot" });
		this.bodyEl = this.contentEl.createDiv({ cls: "csv-importer-body" });
	}

	private openConfig(tab?: string): void {
		if (!this.file) return;
		new ImportConfigModal(this.app, this.host, this.file, this.raw, () => {
			// An encoding change must take effect in the table and in the Import button.
			this.render();
			const pending = this.redecodeIfNeeded();
			this.pendingDecode = pending;
			void pending.finally(() => {
				if (this.pendingDecode === pending) this.pendingDecode = null;
			});
		}, tab).open();
	}

	private async runImport(): Promise<void> {
		if (!this.file || this.importing) return;
		this.importing = true;
		this.updateImportButton();
		try {
			if (this.pendingDecode) await this.pendingDecode;
			if (!this.file) return;
			await this.host.importFile(this.file, this.raw);
		} catch (e) {
			new Notice(`Import failed: ${errorMessage(e)}`);
		} finally {
			this.importing = false;
			this.render();
		}
	}

	private updateImportButton(): void {
		if (this.importBtn) this.importBtn.disabled = this.importing;
	}

	private render(): void {
		this.ensureSkeleton();
		const toolbar = this.toolbarEl;
		const body = this.bodyEl;
		if (!toolbar || !body) return;
		toolbar.empty();
		body.empty();
		this.statusEl?.empty();
		this.bannerEl?.empty();

		const file = this.file;
		if (!file) {
			body.createDiv({ cls: "csv-importer-empty", text: "No file loaded." });
			return;
		}

		const cfg = this.host.getFileConfig(file);
		const cached = this.getParsed(cfg);
		let parsed: ParsedCsv | null = cached.parsed;
		let error: string | null = cached.error;

		const persistedColumns = cfg.columns.map((c) => ({ ...c }));
		let columns: ColumnConfig[] = [];
		if (parsed) {
			try {
				columns = prepareConfig(cfg, parsed, this.host.settings.midnightAsDate).columns;
			} catch (e) {
				error = errorMessage(e);
				parsed = null;
			}
		}

		this.model = { cfg, parsed, columns, error };
		this.renderToolbar(toolbar, cfg, parsed);
		if (this.statusEl) this.renderStatus(this.statusEl, cfg, parsed);
		this.renderBanner(cfg, persistedColumns, parsed, error);
		this.renderBody();
	}

	private getParsed(cfg: FileImportConfig): ParseCache {
		const c = this.parseCache;
		if (c && c.raw === this.raw && c.delimiter === cfg.delimiter && c.hasHeader === cfg.hasHeader && c.encoding === cfg.encoding) return c;
		let parsed: ParsedCsv | null = null;
		let error: string | null = null;
		if (this.raw.trim().length > 0) {
			try {
				parsed = parseCsv(this.raw, { delimiter: cfg.delimiter, hasHeader: cfg.hasHeader });
			} catch (e) {
				error = errorMessage(e);
			}
		}
		const next: ParseCache = { raw: this.raw, delimiter: cfg.delimiter, hasHeader: cfg.hasHeader, encoding: cfg.encoding, parsed, error, lowerRows: null };
		this.parseCache = next;
		return next;
	}

	private lowerRows(parsed: ParsedCsv): string[] {
		const c = this.parseCache;
		if (c && c.parsed === parsed) {
			if (!c.lowerRows) c.lowerRows = parsed.rows.map((r) => r.join("\u0001").toLowerCase());
			return c.lowerRows;
		}
		return parsed.rows.map((r) => r.join("\u0001").toLowerCase());
	}

	/** At most one callout, by severity: read error, then columns changed / parser warnings, then first import / row filter. */
	private renderBanner(cfg: FileImportConfig, persisted: ColumnConfig[], parsed: ParsedCsv | null, error: string | null): void {
		const slot = this.bannerEl;
		if (!slot) return;
		if (error) {
			renderCallout(slot, "error", {
				title: READ_ERROR_TITLE,
				items: [`${error}. ${CHECK_DELIMITER}`],
				action: { label: CONFIGURE_IMPORT, onClick: () => this.openConfig() },
			});
			return;
		}
		if (!parsed) return;
		const filterItem =
			cfg.rowFilter && parsed.rows.length > 0 ? filterBullet(countMatching(parsed, cfg), parsed.rows.length, cfg.rowFilter) : null;
		const drift = persisted.length > 0 ? detectHeaderDrift(persisted, parsed) : null;
		const hasDrift = !!drift && (drift.added.length > 0 || drift.removed.length > 0);
		if (hasDrift || parsed.warnings.length > 0) {
			const items = [...(drift && hasDrift ? [driftMessage(drift.added, drift.removed)] : []), ...parsed.warnings];
			if (filterItem) items.push(filterItem);
			renderCallout(slot, "warning", {
				title: hasDrift ? COLUMNS_CHANGED_TITLE : undefined,
				items,
				action: hasDrift ? { label: REVIEW_COLUMNS, onClick: () => this.openConfig("columns") } : undefined,
			});
			return;
		}
		const firstImport = !cfg.lastImport && parsed.rows.length > 0 && !!this.file;
		if (firstImport || filterItem) {
			const items = firstImport && this.file ? firstImportItems(safeTargetFolder(cfg, this.file.path)) : [];
			if (filterItem) items.push(filterItem);
			renderCallout(slot, "info", { title: firstImport ? FIRST_IMPORT_TITLE : ROW_FILTER_TITLE, items });
		}
	}

	private async runUndo(): Promise<void> {
		const file = this.file;
		if (!file || this.importing) return;
		try {
			await this.host.undoLastImport(file);
		} catch (e) {
			new Notice(`Undo failed: ${errorMessage(e)}`);
		}
		this.render();
	}

	private renderBody(): void {
		const body = this.bodyEl;
		const m = this.model;
		if (!body || !m) return;
		body.empty();
		const { cfg, parsed, columns, error } = m;
		if (error) return; // the error callout above the table explains it
		if (!parsed || parsed.headers.length === 0 || parsed.rows.length === 0) {
			body.createDiv({ cls: "csv-importer-empty", text: NO_ROWS });
			return;
		}
		this.table.render(body, parsed, columns, cfg);
	}

	private renderToolbar(el: HTMLElement, cfg: FileImportConfig, parsed: ParsedCsv | null): void {
		const search = el.createEl("input", {
			cls: "csv-importer-search",
			type: "search",
			attr: { placeholder: FILTER_PLACEHOLDER, "aria-label": FILTER_LABEL },
		});
		search.value = this.table.queryRaw;
		search.addEventListener("input", () => this.onSearch(search.value));

		const configBtn = el.createEl("button", {
			cls: "csv-importer-btn csv-importer-configure",
			attr: { type: "button", "aria-label": "Configure import" },
		});
		setIcon(configBtn.createSpan({ cls: "csv-importer-btn-icon" }), "sliders-horizontal");
		configBtn.createSpan({ cls: "csv-importer-btn-label", text: CONFIGURE_IMPORT });
		setTooltip(configBtn, "Configure import");
		configBtn.addEventListener("click", () => this.openConfig());

		const importCount = parsed ? countMatching(parsed, cfg) : 0;
		const importBtn = el.createEl("button", { cls: "csv-importer-btn mod-cta csv-importer-import", attr: { type: "button" } });
		setIcon(importBtn.createSpan({ cls: "csv-importer-btn-icon" }), "file-plus");
		importBtn.createSpan({ text: importRowsLabel(importCount) });
		importBtn.disabled = this.importing || importCount === 0;
		importBtn.addEventListener("click", () => void this.runImport());
		this.importBtn = importBtn;
	}

	/** Muted line under the toolbar: counts, last import time and Undo. */
	private renderStatus(el: HTMLElement, cfg: FileImportConfig, parsed: ParsedCsv | null): void {
		const parts: string[] = [];
		if (parsed) {
			parts.push(plural(parsed.rows.length, "row", "rows"), plural(parsed.headers.length, "column", "columns"), delimiterLabel(parsed.delimiter));
			const extra = cfg.extraProperties?.length ?? 0;
			if (extra > 0) parts.push(`+ ${plural(extra, "extra property", "extra properties")}`);
		} else {
			parts.push("No data");
		}
		const text = el.createSpan({ text: parts.join(" \u00b7 ") });
		text.setAttr("role", "status");
		if (cfg.lastImport) {
			el.createSpan({ cls: "csv-importer-status-sep", text: " \u00b7 ", attr: { "aria-hidden": "true" } });
			el.createSpan({
				text: importedAgo(relativeTime(cfg.lastImport)),
				attr: { title: new Date(cfg.lastImport).toLocaleString() },
			});
		}
		if (this.file && this.host.canUndo(this.file)) {
			el.createSpan({ cls: "csv-importer-status-sep", text: " \u00b7 ", attr: { "aria-hidden": "true" } });
			const undo = el.createEl("button", { cls: "csv-importer-link-btn", text: UNDO, attr: { type: "button", "aria-label": "Undo last import" } });
			undo.disabled = this.importing;
			undo.addEventListener("click", () => void this.runUndo());
		}
	}

	private openTypeMenu(ev: MouseEvent, index: number): void {
		const col = this.model?.columns[index];
		if (!col) return;
		const menu = new Menu();
		for (const [type, label] of Object.entries(TYPE_LABELS) as [PropertyType, string][]) {
			menu.addItem((item) =>
				item
					.setTitle(label)
					.setChecked(col.type === type)
					.onClick(() => void this.updateColumn(index, (c) => (c.type = type))),
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(col.valueTemplate ? "Unlink values" : "Link values ([[…]])")
				.setIcon("link")
				.onClick(() =>
					void this.updateColumn(index, (c) => {
						c.valueTemplate = c.valueTemplate ? undefined : LINK_TEMPLATE;
					}),
				),
		);
		menu.addItem((item) =>
			item
				.setTitle(col.include ? "Exclude from import" : "Include in import")
				.setIcon(col.include ? "eye-off" : "eye")
				.onClick(() => void this.updateColumn(index, (c) => (c.include = !c.include))),
		);
		menu.showAtMouseEvent(ev);
	}

	private async updateColumn(index: number, mutate: (c: ColumnConfig) => void): Promise<void> {
		const file = this.file;
		if (!file) return;
		try {
			const cfg = this.host.getFileConfig(file);
			const parsed = this.getParsed(cfg).parsed;
			if (!parsed) return;
			prepareConfig(cfg, parsed, this.host.settings.midnightAsDate);
			const col = cfg.columns.find((c) => c.index === index);
			if (!col) return;
			mutate(col);
			await this.host.saveFileConfig(file, cfg);
		} catch (e) {
			new Notice(`Could not save the column setting: ${errorMessage(e)}`);
		}
		this.render();
		// render() rebuilds the header: put keyboard focus back on the badge that was used.
		this.contentEl.querySelector<HTMLElement>(`.csv-importer-badge[data-col="${index}"]`)?.focus();
	}
}
