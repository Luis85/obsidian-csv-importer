import { setIcon } from "obsidian";
import type { ColumnConfig, FileImportConfig, ParsedCsv } from "../types";
import { convertValue } from "../csv/typeInference";
import { NO_ROWS, TYPE_BADGES, TYPE_LABELS, noRowsMatch } from "./labels";
import { SHOW_MORE, filterMatchCount, selectAllLabel, selectRowLabel } from "./runCopy";
import { conversionOptions } from "./shared";

type SortDir = "asc" | "desc";

const LONG_CELL = 40;

interface Entry {
	row: string[];
	/** Row number in the file (1-based, as in ParsedCsv.rowNumbers). */
	n: number;
	/** Index in ParsedCsv.rows. */
	i: number;
}

interface Page {
	entries: Entry[];
	shown: number;
	pageSize: number;
	tbody: HTMLElement;
	moreEl: HTMLElement | null;
	parsed: ParsedCsv;
	columns: ColumnConfig[];
	/** Row checkboxes and rows currently in the DOM, by row number. */
	checks: Map<number, HTMLInputElement>;
	trs: Map<number, HTMLElement>;
	headCheck: HTMLInputElement | null;
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
	/** The set of selected rows changed (rows are not re-rendered). */
	selectionChanged(): void;
}

/** Renders the CSV table with filter, sort and incremental "show more". Holds the view state of the table. */
export class TableRenderer {
	query = "";
	/** The filter text as typed (the input shows this; `query` is trimmed and lowercased). */
	queryRaw = "";
	private sortCol = -1;
	private sortDir: SortDir = "asc";
	private visibleCount = 0;
	/** Selected rows by row number. Not persisted. */
	private selected = new Set<number>();
	/** Row number of the last plain click, the start of a shift-click range. */
	private anchor: number | null = null;
	private page: Page | null = null;

	constructor(private readonly hooks: TableRendererHooks) {}

	/** Back to the unfiltered, unsorted first page. */
	reset(): void {
		this.query = "";
		this.queryRaw = "";
		this.sortCol = -1;
		this.visibleCount = 0;
		this.selected.clear();
		this.anchor = null;
	}

	get selectionSize(): number {
		return this.selected.size;
	}

	/** Selected row numbers, ascending. */
	selectedRows(): number[] {
		return [...this.selected].sort((a, b) => a - b);
	}

	clearSelection(): void {
		if (this.selected.size === 0) return;
		this.selected.clear();
		this.anchor = null;
		this.syncChecks();
		this.hooks.selectionChanged();
	}

	/** New filter text: start again from the first page. */
	setQuery(value: string): void {
		this.queryRaw = value;
		this.query = value.trim().toLowerCase();
		this.visibleCount = 0;
	}

	render(body: HTMLElement, parsed: ParsedCsv, columns: ColumnConfig[], cfg: FileImportConfig): void {
		// Drop selected rows that no longer exist (the file changed).
		if (this.selected.size > 0) {
			const known = new Set(parsed.rowNumbers.length > 0 ? parsed.rowNumbers : parsed.rows.map((_r, i) => i + 1));
			for (const n of this.selected) if (!known.has(n)) this.selected.delete(n);
		}
		const entries = this.sortEntries(this.filterEntries(parsed), parsed, columns, cfg);

		if (this.query && entries.length > 0) {
			body.createDiv({ cls: "csv-importer-filter-info", text: filterMatchCount(entries.length, parsed.rows.length), attr: { role: "status" } });
		}
		if (entries.length === 0) {
			body.createDiv({ cls: "csv-importer-empty", text: this.query ? noRowsMatch(this.queryRaw.trim()) : NO_ROWS });
		}

		const scroller = body.createDiv({ cls: "csv-importer-scroll" });
		const table = scroller.createEl("table", { cls: "csv-importer-table", attr: { "data-testid": "csv-table" } });
		const page: Page = { entries, shown: 0, pageSize: 1, tbody: createEl("tbody"), moreEl: null, parsed, columns, checks: new Map(), trs: new Map(), headCheck: null };
		this.page = page;
		this.renderHeader(table.createEl("thead"), parsed, columns, page);

		const pageSize = Math.max(1, this.hooks.pageSize());
		page.pageSize = pageSize;
		page.tbody = table.createEl("tbody");
		this.appendRows(page, Math.max(this.visibleCount, pageSize));
		page.moreEl = body.createDiv({ cls: "csv-importer-more" });
		this.updateMore(page);
		this.syncChecks();
	}

	private filterEntries(parsed: ParsedCsv): Entry[] {
		let entries = parsed.rows.map((row, i) => ({ row, n: parsed.rowNumbers[i] ?? i + 1, i }));
		if (this.query) {
			const q = this.query;
			const lower = this.hooks.lowerRows(parsed);
			entries = entries.filter((e) => (lower[e.i] ?? "").includes(q));
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

	private renderHeader(thead: HTMLElement, parsed: ParsedCsv, columns: ColumnConfig[], page: Page): void {
		const hr = thead.createEl("tr");
		const selectTh = hr.createEl("th", { cls: "csv-importer-select" });
		const head = selectTh.createEl("input", {
			cls: "csv-importer-check",
			type: "checkbox",
			attr: { "aria-label": selectAllLabel(this.query !== "", page.entries.length), "data-testid": "csv-select-all" },
		});
		head.addEventListener("click", () => this.toggleAll(page));
		page.headCheck = head;
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
				"data-testid": "csv-type-badge",
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
			const entry = page.entries[r];
			if (!entry) continue;
			const { row, n } = entry;
			const tr = createEl("tr");
			const box = tr.createEl("td", { cls: "csv-importer-select" }).createEl("input", {
				cls: "csv-importer-check",
				type: "checkbox",
				attr: { "aria-label": selectRowLabel(n), "data-testid": "csv-row-check", "data-row": String(n) },
			});
			box.addEventListener("click", (ev: MouseEvent) => this.onRowClick(page, n, box.checked, ev.shiftKey));
			page.checks.set(n, box);
			page.trs.set(n, tr);
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
			box.checked = this.selected.has(n);
			if (box.checked) tr.addClass("is-selected");
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
			text: `${SHOW_MORE} (${page.shown} of ${page.entries.length})`,
		});
		btn.addEventListener("click", () => {
			this.visibleCount = page.shown + page.pageSize;
			this.appendRows(page, this.visibleCount);
			this.updateMore(page);
		});
	}

	private onRowClick(page: Page, n: number, checked: boolean, shift: boolean): void {
		const set = (row: number): void => void (checked ? this.selected.add(row) : this.selected.delete(row));
		const from = shift && this.anchor !== null ? page.entries.findIndex((e) => e.n === this.anchor) : -1;
		const to = page.entries.findIndex((e) => e.n === n);
		if (from >= 0 && to >= 0) {
			for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
				const e = page.entries[i];
				if (e) set(e.n);
			}
		} else {
			set(n);
		}
		this.anchor = n;
		this.syncChecks();
		this.hooks.selectionChanged();
	}

	/** The header checkbox: select every filtered row, or clear them when they are all selected. */
	private toggleAll(page: Page): void {
		const all = page.entries.length > 0 && page.entries.every((e) => this.selected.has(e.n));
		for (const e of page.entries) {
			if (all) this.selected.delete(e.n);
			else this.selected.add(e.n);
		}
		this.anchor = null;
		this.syncChecks();
		this.hooks.selectionChanged();
	}

	/** Brings the checkboxes and row highlights in the DOM in line with the selection, without re-rendering. */
	private syncChecks(): void {
		const page = this.page;
		if (!page) return;
		for (const [n, box] of page.checks) {
			const on = this.selected.has(n);
			box.checked = on;
			page.trs.get(n)?.toggleClass("is-selected", on);
		}
		const head = page.headCheck;
		if (head) {
			let count = 0;
			for (const e of page.entries) if (this.selected.has(e.n)) count++;
			head.checked = count > 0 && count === page.entries.length;
			head.indeterminate = count > 0 && count < page.entries.length;
			head.disabled = page.entries.length === 0;
		}
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
