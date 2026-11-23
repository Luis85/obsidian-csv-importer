import { Menu, TextFileView, WorkspaceLeaf, Notice, setIcon, debounce } from "obsidian";
import type { CsvImporterHost } from "../host";
import type { ColumnConfig, FileImportConfig, ParsedCsv, PropertyType } from "../types";
import { parseCsv } from "../csv/parser";
import { detectHeaderDrift, prepareConfig } from "../csv/typeInference";
import { errorMessage, plural } from "../core/util";
import { ImportConfigModal } from "./ImportConfigModal";
import { TableRenderer } from "./TableRenderer";
import { renderCallout, safeTargetFolder } from "./dom";
import { TYPE_LABELS, delimiterLabel } from "./labels";
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
		this.addAction("sliders-horizontal", "Configure import", () => this.openConfig());
		this.addAction("file-plus", "Import rows as notes", () => void this.runImport());
	}

	getViewType(): string {
		return VIEW_TYPE_CSV;
	}

	getDisplayText(): string {
		return this.file ? this.file.basename : "CSV";
	}

	getIcon(): string {
		return "table";
	}

	getViewData(): string {
		return this.fileData;
	}

	/** The view is strictly read-only: never write the (possibly re-decoded) text back to the CSV. */
	save(_clear?: boolean): Promise<void> {
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
		this.bannerEl = this.contentEl.createDiv({ cls: "csv-importer-banner-slot" });
		this.bodyEl = this.contentEl.createDiv({ cls: "csv-importer-body" });
	}

	private openConfig(): void {
		if (!this.file) return;
		new ImportConfigModal(this.app, this.host, this.file, this.raw, () => {
			// An encoding change must take effect in the table and in the Import button.
			this.render();
			const pending = this.redecodeIfNeeded();
			this.pendingDecode = pending;
			void pending.finally(() => {
				if (this.pendingDecode === pending) this.pendingDecode = null;
			});
		}).open();
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
		this.renderDriftBanner(persistedColumns, parsed);
		this.renderParserWarnings(parsed);
		this.renderFirstImportHint(cfg, parsed);
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

	private renderDriftBanner(persisted: ColumnConfig[], parsed: ParsedCsv | null): void {
		const slot = this.bannerEl;
		if (!slot || !parsed || persisted.length === 0) return;
		const drift = detectHeaderDrift(persisted, parsed);
		if (drift.added.length === 0 && drift.removed.length === 0) return;
		const parts: string[] = [];
		if (drift.added.length) parts.push(`Added: ${drift.added.join(", ")}.`);
		if (drift.removed.length) parts.push(`Removed: ${drift.removed.join(", ")}.`);
		renderCallout(slot, "warning", {
			items: [`Columns changed since the import settings were saved. ${parts.join(" ")}`],
			action: { label: "Review", onClick: () => this.openConfig() },
		});
	}

	private renderFirstImportHint(cfg: FileImportConfig, parsed: ParsedCsv | null): void {
		const slot = this.bannerEl;
		if (!slot || !parsed || parsed.rows.length === 0 || cfg.lastImport || !this.file) return;
		const folder = safeTargetFolder(cfg, this.file.path);
		renderCallout(slot, "info", {
			items: [`Notes will be created in ${folder || "a folder next to this file"}. Column types were detected automatically. Click a type to change it.`],
		});
	}

	private renderParserWarnings(parsed: ParsedCsv | null): void {
		const slot = this.bannerEl;
		if (!slot || !parsed || parsed.warnings.length === 0) return;
		renderCallout(slot, "warning", { items: parsed.warnings });
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
				if (error) {
			const box = body.createDiv({ cls: "csv-importer-empty csv-importer-error" });
			box.createDiv({ text: `Could not read this file as a table: ${error}. Try another delimiter or encoding in Configure import.` });
			const btn = box.createEl("button", { cls: "csv-importer-btn", text: "Configure import" });
			btn.addEventListener("click", () => this.openConfig());
			return;
		}
		if (!parsed || parsed.headers.length === 0 || parsed.rows.length === 0) {
			body.createDiv({ cls: "csv-importer-empty", text: "This file has no rows yet. Add data to the CSV, then reopen it." });
			return;
		}
		this.table.render(body, parsed, columns, cfg);
	}

	private renderToolbar(el: HTMLElement, cfg: FileImportConfig, parsed: ParsedCsv | null): void {
		const rowCount = parsed ? parsed.rows.length : 0;
		const colCount = parsed ? parsed.headers.length : 0;

		const stats = el.createDiv({ cls: "csv-importer-stats" });
		stats.setText(
			parsed
				? `${plural(rowCount, "row", "rows")} · ${plural(colCount, "column", "columns")} · ${delimiterLabel(parsed.delimiter)}`
				: "No data",
		);
		const extraCount = cfg.extraProperties?.length ?? 0;
		if (parsed && extraCount > 0) stats.appendText(` · + ${plural(extraCount, "extra property", "extra properties")}`);

		const search = el.createEl("input", {
			cls: "csv-importer-search",
			type: "search",
			attr: { placeholder: "Filter rows in all columns…", "aria-label": "Filter rows" },
		});
		search.value = this.table.query;
		search.addEventListener("input", () => this.onSearch(search.value));

		const spacer = el.createDiv({ cls: "csv-importer-spacer" });
		spacer.setAttr("aria-hidden", "true");

		if (cfg.lastImport) {
			el.createDiv({
				cls: "csv-importer-last-import",
				text: `Last import: ${new Date(cfg.lastImport).toLocaleString()}`,
			});
		}

		const configBtn = el.createEl("button", { cls: "csv-importer-btn" });
		setIcon(configBtn.createSpan({ cls: "csv-importer-btn-icon" }), "sliders-horizontal");
		configBtn.createSpan({ text: "Configure import" });
		configBtn.addEventListener("click", () => this.openConfig());

		if (this.file && this.host.canUndo(this.file)) {
			const undoBtn = el.createEl("button", { cls: "csv-importer-btn" });
			setIcon(undoBtn.createSpan({ cls: "csv-importer-btn-icon" }), "undo-2");
			undoBtn.createSpan({ text: "Undo last import" });
			undoBtn.disabled = this.importing;
			undoBtn.addEventListener("click", () => void this.runUndo());
		}

		const importBtn = el.createEl("button", { cls: "csv-importer-btn mod-cta" });
		setIcon(importBtn.createSpan({ cls: "csv-importer-btn-icon" }), "file-plus");
		importBtn.createSpan({ text: `Import ${plural(rowCount, "row", "rows")} as ${rowCount === 1 ? "note" : "notes"}` });
		importBtn.disabled = this.importing || rowCount === 0;
		importBtn.addEventListener("click", () => void this.runImport());
		this.importBtn = importBtn;
		if (this.importing) this.importBtn.disabled = true;
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
