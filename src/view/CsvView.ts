import { Menu, TextFileView, WorkspaceLeaf, Notice, setIcon, debounce } from "obsidian";
import type { CsvImporterHost } from "../host";
import type { ColumnConfig, FileImportConfig, ParsedCsv, PropertyType } from "../types";
import { parseCsv } from "../csv/parser";
import { convertValue, prepareConfig } from "../csv/typeInference";
import { ImportConfigModal } from "./ImportConfigModal";
import { LINK_TEMPLATE, TYPE_BADGES, TYPE_LABELS, conversionOptions, delimiterLabel, inferenceOptions } from "./shared";

export const VIEW_TYPE_CSV = "csv-importer-view";

type SortDir = "asc" | "desc";

export class CsvView extends TextFileView {
	private raw = "";
	private importing = false;
	private query = "";
	private sortCol = -1;
	private sortDir: SortDir = "asc";
	private visibleCount = 0;
	private model: { cfg: FileImportConfig; parsed: ParsedCsv | null; columns: ColumnConfig[]; error: string | null } | null = null;

	private toolbarEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private importBtn: HTMLButtonElement | null = null;

	private readonly onSearch = debounce((value: string) => {
		this.query = value.trim().toLowerCase();
		this.visibleCount = 0;
		this.renderBody();
	}, 200, true);

	constructor(leaf: WorkspaceLeaf, private host: CsvImporterHost) {
		super(leaf);
		this.addAction("settings", "Configure import", () => this.openConfig());
		this.addAction("download", "Import rows", () => void this.runImport());
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
		return this.raw;
	}

	setViewData(data: string, clear: boolean): void {
		this.raw = data;
		if (clear) {
			this.query = "";
			this.sortCol = -1;
			this.visibleCount = 0;
		}
		this.render();
	}

	clear(): void {
		this.raw = "";
		this.query = "";
		this.sortCol = -1;
		this.visibleCount = 0;
		this.render();
	}

	private ensureSkeleton(): void {
		if (this.toolbarEl && this.toolbarEl.isConnected) return;
		this.contentEl.empty();
		this.contentEl.addClass("csv-importer-view");
		this.toolbarEl = this.contentEl.createDiv({ cls: "csv-importer-toolbar" });
		this.bodyEl = this.contentEl.createDiv({ cls: "csv-importer-body" });
	}

	private openConfig(): void {
		if (!this.file) return;
		new ImportConfigModal(this.app, this.host, this.file, this.raw, () => this.render()).open();
	}

	private async runImport(): Promise<void> {
		if (!this.file || this.importing) return;
		this.importing = true;
		this.updateImportButton();
		try {
			await this.host.importFile(this.file, this.raw);
		} catch (e) {
			new Notice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
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

		const file = this.file;
		if (!file) {
			body.createDiv({ cls: "csv-importer-empty", text: "No file loaded." });
			return;
		}

		const cfg = this.host.getFileConfig(file);
		let parsed: ParsedCsv | null = null;
		let error: string | null = null;
		if (this.raw.trim().length > 0) {
			try {
				parsed = parseCsv(this.raw, { delimiter: cfg.delimiter, hasHeader: cfg.hasHeader });
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			}
		}

		let columns: ColumnConfig[] = [];
		if (parsed) {
			try {
				columns = prepareConfig(cfg, parsed, this.host.settings.midnightAsDate).columns;
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
				parsed = null;
			}
		}

		this.model = { cfg, parsed, columns, error };
		this.renderToolbar(toolbar, cfg, parsed);
		this.renderBody();
	}

	private renderBody(): void {
		const body = this.bodyEl;
		const m = this.model;
		if (!body || !m) return;
		body.empty();
		const { cfg, parsed, columns, error } = m;
		if (error) {
			body.createDiv({ cls: "csv-importer-empty csv-importer-error", text: `Could not parse this file: ${error}` });
			return;
		}
		if (!parsed || parsed.headers.length === 0) {
			body.createDiv({ cls: "csv-importer-empty", text: "This CSV file is empty." });
			return;
		}
		this.renderTable(body, parsed, columns, cfg);
	}

	private renderToolbar(el: HTMLElement, cfg: FileImportConfig, parsed: ParsedCsv | null): void {
		const rowCount = parsed ? parsed.rows.length : 0;
		const colCount = parsed ? parsed.headers.length : 0;

		const stats = el.createDiv({ cls: "csv-importer-stats" });
		stats.setText(
			parsed
				? `${rowCount} ${rowCount === 1 ? "row" : "rows"} · ${colCount} ${colCount === 1 ? "column" : "columns"} · ${delimiterLabel(parsed.delimiter)}`
				: "No data",
		);

		const search = el.createEl("input", {
			cls: "csv-importer-search",
			type: "search",
			attr: { placeholder: "Filter rows…", "aria-label": "Filter rows" },
		});
		search.value = this.query;
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
		setIcon(configBtn.createSpan({ cls: "csv-importer-btn-icon" }), "settings");
		configBtn.createSpan({ text: "Configure import" });
		configBtn.addEventListener("click", () => this.openConfig());

		const importBtn = el.createEl("button", { cls: "csv-importer-btn mod-cta" });
		setIcon(importBtn.createSpan({ cls: "csv-importer-btn-icon" }), "download");
		importBtn.createSpan({ text: `Import ${rowCount} ${rowCount === 1 ? "row" : "rows"}` });
		importBtn.disabled = this.importing || rowCount === 0;
		importBtn.addEventListener("click", () => void this.runImport());
		this.importBtn = importBtn;
		if (this.importing) this.importBtn.disabled = true;
	}

	private renderTable(body: HTMLElement, parsed: ParsedCsv, columns: ColumnConfig[], cfg: FileImportConfig): void {
		const conv = conversionOptions(cfg);
		let entries = parsed.rows.map((row, i) => ({ row, n: i + 1 }));

		if (this.query) {
			const q = this.query;
			entries = entries.filter((e) => e.row.some((c) => c.toLowerCase().includes(q)));
		}

		if (this.sortCol >= 0 && this.sortCol < parsed.headers.length) {
			const idx = this.sortCol;
			const dir = this.sortDir === "asc" ? 1 : -1;
			const isNum = columns[idx]?.type === "number";
			if (isNum) {
				const keyed = entries.map((e) => {
					const v = convertValue(e.row[idx] ?? "", "number", conv);
					return { e, v: typeof v === "number" ? v : null };
				});
				keyed.sort((a, b) => {
					if (a.v === null && b.v === null) return 0;
					if (a.v === null) return 1;
					if (b.v === null) return -1;
					return (a.v - b.v) * dir;
				});
				entries = keyed.map((k) => k.e);
			} else {
				const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
				entries.sort((a, b) => collator.compare(a.row[idx] ?? "", b.row[idx] ?? "") * dir);
			}
		}

		if (this.query) {
			body.createDiv({
				cls: "csv-importer-filter-info",
				text: `${entries.length} of ${parsed.rows.length} rows match`,
			});
		}
		if (entries.length === 0) {
			body.createDiv({ cls: "csv-importer-empty", text: this.query ? "No rows match the filter." : "This file has a header but no data rows." });
		}

		const pageSize = Math.max(1, this.host.settings.pageSize || 200);
		const shown = Math.min(entries.length, Math.max(this.visibleCount, pageSize));

		const scroller = body.createDiv({ cls: "csv-importer-scroll" });
		const table = scroller.createEl("table", { cls: "csv-importer-table" });
		const thead = table.createEl("thead");
		const hr = thead.createEl("tr");
		hr.createEl("th", { cls: "csv-importer-rownum", text: "#" });
		parsed.headers.forEach((h, i) => {
			const col = columns[i];
			const th = hr.createEl("th", { cls: "csv-importer-th" });
			if (col && !col.include) th.addClass("is-excluded");
			if (col?.type === "number") th.addClass("is-numeric");
			th.setAttr("tabindex", "0");
			th.setAttr("role", "columnheader");
			th.setAttr("aria-sort", this.sortCol === i ? (this.sortDir === "asc" ? "ascending" : "descending") : "none");
			const inner = th.createDiv({ cls: "csv-importer-th-inner" });
			inner.createSpan({ cls: "csv-importer-th-name", text: h });
			if (col) {
				const badge = inner.createSpan({
					cls: `csv-importer-badge csv-importer-badge-${col.type} is-clickable`,
					attr: {
						title: `${TYPE_LABELS[col.type]}${col.include ? "" : " (excluded)"}. Click to change the property type`,
						role: "button",
						tabindex: "0",
						"aria-label": `Property type of ${h}: ${TYPE_LABELS[col.type]}. Click to change the property type`,
					},
				});
				badge.createSpan({ text: TYPE_BADGES[col.type] });
				if (col.valueTemplate) setIcon(badge.createSpan({ cls: "csv-importer-badge-link" }), "link");
				badge.addEventListener("click", (ev: MouseEvent) => {
					ev.stopPropagation();
					this.openTypeMenu(ev, i);
				});
				badge.addEventListener("keydown", (ev: KeyboardEvent) => {
					if (ev.key === "Enter" || ev.key === " ") {
						ev.preventDefault();
						ev.stopPropagation();
						const r = badge.getBoundingClientRect();
						this.openTypeMenu(new MouseEvent("click", { clientX: r.left, clientY: r.bottom }), i);
					}
				});
			}
			const sortIcon = inner.createSpan({ cls: "csv-importer-sort-icon" });
			if (this.sortCol === i) setIcon(sortIcon, this.sortDir === "asc" ? "arrow-up" : "arrow-down");
			const toggle = () => this.toggleSort(i);
			th.addEventListener("click", toggle);
			th.addEventListener("keydown", (ev: KeyboardEvent) => {
				if (ev.key === "Enter" || ev.key === " ") {
					ev.preventDefault();
					toggle();
				}
			});
		});

		const tbody = table.createEl("tbody");
		for (let r = 0; r < shown; r++) {
			const { row, n } = entries[r];
			const tr = tbody.createEl("tr");
			tr.createEl("td", { cls: "csv-importer-rownum", text: String(n) });
			for (let c = 0; c < parsed.headers.length; c++) {
				const col = columns[c];
				const td = tr.createEl("td", { text: row[c] ?? "" });
				if (col && !col.include) td.addClass("is-excluded");
				if (col?.type === "number") td.addClass("is-numeric");
			}
		}

		if (shown < entries.length) {
			const more = body.createDiv({ cls: "csv-importer-more" });
			const btn = more.createEl("button", {
				cls: "csv-importer-btn",
				text: `Show more (${shown} of ${entries.length})`,
			});
			btn.addEventListener("click", () => {
				this.visibleCount = shown + pageSize;
				this.renderBody();
			});
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
			const parsed = parseCsv(this.raw, { delimiter: cfg.delimiter, hasHeader: cfg.hasHeader });
			prepareConfig(cfg, parsed, this.host.settings.midnightAsDate);
			const col = cfg.columns.find((c) => c.index === index);
			if (!col) return;
			mutate(col);
			await this.host.saveFileConfig(file, cfg);
		} catch (e) {
			new Notice(`Could not save the column setting: ${e instanceof Error ? e.message : String(e)}`);
		}
		this.render();
	}

	private toggleSort(i: number): void {
		if (this.sortCol !== i) {
			this.sortCol = i;
			this.sortDir = "asc";
		} else if (this.sortDir === "asc") {
			this.sortDir = "desc";
		} else {
			this.sortCol = -1;
		}
		this.renderBody();
	}
}
