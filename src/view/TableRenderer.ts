import { setIcon } from "obsidian";
import type { ColumnConfig, FileImportConfig, ParsedCsv } from "../types";
import { convertValue } from "../csv/typeInference";
import { TYPE_BADGES, TYPE_LABELS } from "./labels";
import { conversionOptions } from "./shared";

type SortDir = "asc" | "desc";

const LONG_CELL = 40;

interface Entry {
	row: string[];
	/** 1-based row number in the file. */
	n: number;
}

interface Page {
	entries: Entry[];
	shown: number;
	pageSize: number;
	tbody: HTMLElement;
	moreEl: HTMLElement | null;
	parsed: ParsedCsv;
	columns: ColumnConfig[];
}

export interface TableRendererHooks {
	/** Rows per page. */
	pageSize(): number;
	/** Lowercased text per row, used by the filter. */
	lowerRows(parsed: ParsedCsv): string[];
	/** Sorting changed: render the table again. */
	requestRender(): void;
	/** The type badge of a column was activated. */
	openTypeMenu(ev: MouseEvent, columnIndex: number): void;
}

/** Renders the CSV table with filter, sort and incremental "show more". Holds the view state of the table. */
export class TableRenderer {
	query = "";
	private sortCol = -1;
	private sortDir: SortDir = "asc";
	private visibleCount = 0;

	constructor(private readonly hooks: TableRendererHooks) {}

	/** Back to the unfiltered, unsorted first page. */
	reset(): void {
		this.query = "";
		this.sortCol = -1;
		this.visibleCount = 0;
	}

	/** New filter text: start again from the first page. */
	setQuery(value: string): void {
		this.query = value.trim().toLowerCase();
		this.visibleCount = 0;
	}

	render(body: HTMLElement, parsed: ParsedCsv, columns: ColumnConfig[], cfg: FileImportConfig): void {
		const entries = this.sortEntries(this.filterEntries(parsed), parsed, columns, cfg);

		if (this.query) {
			body.createDiv({ cls: "csv-importer-filter-info", text: `${entries.length} of ${parsed.rows.length} rows match` });
		}
		if (entries.length === 0) {
			body.createDiv({ cls: "csv-importer-empty", text: this.query ? "No rows match the filter." : "This file has no rows yet. Add data to the CSV, then reopen it." });
		}

		const scroller = body.createDiv({ cls: "csv-importer-scroll" });
		const table = scroller.createEl("table", { cls: "csv-importer-table" });
		this.renderHeader(table.createEl("thead"), parsed, columns);

		const pageSize = Math.max(1, this.hooks.pageSize());
		const page: Page = { entries, shown: 0, pageSize, tbody: table.createEl("tbody"), moreEl: null, parsed, columns };
		this.appendRows(page, Math.max(this.visibleCount, pageSize));
		page.moreEl = body.createDiv({ cls: "csv-importer-more" });
		this.updateMore(page);
	}

	private filterEntries(parsed: ParsedCsv): Entry[] {
		let entries = parsed.rows.map((row, i) => ({ row, n: i + 1 }));
		if (this.query) {
			const q = this.query;
			const lower = this.hooks.lowerRows(parsed);
			entries = entries.filter((_e, i) => lower[i].includes(q));
		}
		return entries;
	}

	private sortEntries(entries: Entry[], parsed: ParsedCsv, columns: ColumnConfig[], cfg: FileImportConfig): Entry[] {
		if (this.sortCol < 0 || this.sortCol >= parsed.headers.length) return entries;
		const idx = this.sortCol;
		const dir = this.sortDir === "asc" ? 1 : -1;
		if (columns[idx]?.type === "number") {
			const conv = conversionOptions(cfg);
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
			return keyed.map((k) => k.e);
		}
		const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
		return entries.sort((a, b) => collator.compare(a.row[idx] ?? "", b.row[idx] ?? "") * dir);
	}

	private renderHeader(thead: HTMLElement, parsed: ParsedCsv, columns: ColumnConfig[]): void {
		const hr = thead.createEl("tr");
		hr.createEl("th", { cls: "csv-importer-rownum", text: "#" });
		parsed.headers.forEach((h, i) => {
			const col = columns[i];
			const th = hr.createEl("th", { cls: "csv-importer-th" });
			const excluded = !!col && !col.include;
			if (excluded) th.addClass("is-excluded");
			if (col?.type === "number") th.addClass("is-numeric");
			th.setAttr("tabindex", "0");
			th.setAttr("role", "columnheader");
			th.setAttr("aria-sort", this.sortCol === i ? (this.sortDir === "asc" ? "ascending" : "descending") : "none");
			th.setAttr("title", `${excluded ? `${h} (excluded). ` : ""}Click to sort. Click again to reverse, a third time to clear.`);
			const inner = th.createDiv({ cls: "csv-importer-th-inner" });
			inner.createSpan({ cls: "csv-importer-th-name", text: h });
			if (col) this.renderBadge(inner, col, h, i, excluded);
			const sortIcon = inner.createSpan({ cls: "csv-importer-sort-icon" });
			if (this.sortCol === i) setIcon(sortIcon, this.sortDir === "asc" ? "arrow-up" : "arrow-down");
			const toggle = (): void => this.toggleSort(i);
			th.addEventListener("click", toggle);
			th.addEventListener("keydown", (ev: KeyboardEvent) => {
				if (ev.key === "Enter" || ev.key === " ") {
					ev.preventDefault();
					toggle();
				}
			});
		});
	}

	private renderBadge(inner: HTMLElement, col: ColumnConfig, header: string, i: number, excluded: boolean): void {
		const badge = inner.createSpan({
			cls: `csv-importer-badge csv-importer-badge-${col.type} is-clickable`,
			attr: {
				title: `${TYPE_LABELS[col.type]}${excluded ? " (excluded)" : ""}. Click to change the property type`,
				role: "button",
				tabindex: "0",
				"data-col": String(i),
				"aria-haspopup": "menu",
				"aria-label": `Property type of ${header}: ${TYPE_LABELS[col.type]}. Click to change the property type`,
			},
		});
		badge.createSpan({ text: TYPE_BADGES[col.type] });
		if (col.valueTemplate) setIcon(badge.createSpan({ cls: "csv-importer-badge-link" }), "link");
		setIcon(badge.createSpan({ cls: "csv-importer-badge-chevron" }), "chevron-down");
		badge.addEventListener("click", (ev: MouseEvent) => {
			ev.stopPropagation();
			this.hooks.openTypeMenu(ev, i);
		});
		badge.addEventListener("keydown", (ev: KeyboardEvent) => {
			if (ev.key === "Enter" || ev.key === " ") {
				ev.preventDefault();
				ev.stopPropagation();
				const r = badge.getBoundingClientRect();
				this.hooks.openTypeMenu(new MouseEvent("click", { clientX: r.left, clientY: r.bottom }), i);
			}
		});
	}

	/** Append rows up to `target` without re-rendering what is already shown. */
	private appendRows(page: Page, target: number): void {
		const end = Math.min(page.entries.length, target);
		const frag = createFragment();
		for (let r = page.shown; r < end; r++) {
			const { row, n } = page.entries[r];
			const tr = createEl("tr");
			tr.createEl("td", { cls: "csv-importer-rownum", text: String(n) });
			for (let c = 0; c < page.parsed.headers.length; c++) {
				const col = page.columns[c];
				const text = row[c] ?? "";
				const td = tr.createEl("td", { text });
				if (text.length > LONG_CELL) td.setAttr("title", text);
				if (col && !col.include) td.addClass("is-excluded");
				if (col?.type === "number") td.addClass("is-numeric");
			}
			frag.appendChild(tr);
		}
		page.tbody.appendChild(frag);
		page.shown = Math.max(page.shown, end);
	}

	private updateMore(page: Page): void {
		const more = page.moreEl;
		if (!more) return;
		more.empty();
		if (page.shown >= page.entries.length) return;
		const btn = more.createEl("button", {
			cls: "csv-importer-btn",
			text: `Show more (${page.shown} of ${page.entries.length})`,
		});
		btn.addEventListener("click", () => {
			this.visibleCount = page.shown + page.pageSize;
			this.appendRows(page, this.visibleCount);
			this.updateMore(page);
		});
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
		this.hooks.requestRender();
	}
}
