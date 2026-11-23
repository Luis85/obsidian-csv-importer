import type { ColumnConfig, FrontmatterValue, PropertyType } from "../../types";
import { convertValue, hasTimezoneOffsets } from "../../csv/typeInference";
import { applyValueTemplate, formatValue } from "../../import/noteBuilder";
import { sectionHeading } from "../dom";
import { TYPE_LABELS } from "../labels";
import { LINK_TEMPLATE, conversionOptions } from "../shared";
import type { ConfigDraft } from "./ConfigDraft";

/** The "Columns" section: one table row per column with include, property name, type and value template. */
export class ColumnsSection {
	private columnsEl!: HTMLElement;

	constructor(private readonly draft: ConfigDraft) {}

	build(parent: HTMLElement): void {
		const heading = sectionHeading(parent, "Columns");
		heading.addButton((b) => b.setButtonText("Re-detect types").onClick(() => this.draft.redetectTypes()));
		this.columnsEl = parent.createDiv({ cls: "csv-importer-columns" });
		this.render();
		this.draft.on("columns", () => this.render());
	}

	private firstSample(col: ColumnConfig): string {
		const parsed = this.draft.parsed;
		if (!parsed) return "";
		for (const r of parsed.rows) {
			const v = r[col.index] ?? "";
			if (v.trim() !== "") return v;
		}
		return "";
	}

	private hasTimezones(col: ColumnConfig): boolean {
		const parsed = this.draft.parsed;
		if (!parsed || col.type !== "datetime") return false;
		const values: string[] = [];
		for (const r of parsed.rows) {
			const v = r[col.index] ?? "";
			if (v.trim() !== "") values.push(v);
			if (values.length >= 200) break;
		}
		try {
			return hasTimezoneOffsets(values);
		} catch {
			return false;
		}
	}

	/** Converted (and templated) value of the first non-empty cell of a column, as shown in the column list. */
	private previewColumnValue(col: ColumnConfig): string {
		const { parsed, cfg, file } = this.draft;
		if (!parsed) return "";
		const rowIndex = parsed.rows.findIndex((r) => (r[col.index] ?? "").trim() !== "");
		if (rowIndex < 0) return "";
		const row = parsed.rows[rowIndex];
		let v: FrontmatterValue;
		try {
			v = convertValue(row[col.index] ?? "", col.type, conversionOptions(cfg));
			if (col.valueTemplate) {
				v = applyValueTemplate(col.valueTemplate, v, {
					headers: parsed.headers,
					row,
					rowNumber: rowIndex + 1,
					fileBasename: file.basename,
				});
			}
		} catch {
			v = null;
		}
		if (v === null) return "(empty)";
		return Array.isArray(v) ? JSON.stringify(v) : formatValue(v);
	}

	private render(): void {
		const el = this.columnsEl;
		const { cfg, parseError } = this.draft;
		el.empty();
		if (parseError) {
			el.createDiv({ cls: "csv-importer-empty csv-importer-error", text: `Could not read this file as a table: ${parseError}. Try another delimiter or encoding under Advanced.` });
			return;
		}
		if (cfg.columns.length === 0) {
			el.createDiv({ cls: "csv-importer-empty", text: "No columns found." });
			return;
		}
		const scroller = el.createDiv({ cls: "csv-importer-scroll" });
		const table = scroller.createEl("table", { cls: "csv-importer-table csv-importer-columns-table" });
		const head = table.createEl("thead").createEl("tr");
		for (const h of ["Use", "Column", "Property name", "Type", "Value template", "Sample → property value"]) head.createEl("th", { text: h });
		const tbody = table.createEl("tbody");
		for (const col of cfg.columns) this.renderRow(tbody, col);
	}

	private renderRow(tbody: HTMLElement, col: ColumnConfig): void {
		const draft = this.draft;
		const tr = tbody.createEl("tr");
		tr.toggleClass("is-excluded", !col.include);

		const useTd = tr.createEl("td", { attr: { "data-label": "Use" } });
		const cb = useTd.createEl("input", { type: "checkbox", attr: { "aria-label": `Include ${col.source}` } });
		cb.checked = col.include;
		cb.addEventListener("change", () => {
			col.include = cb.checked;
			tr.toggleClass("is-excluded", !col.include);
			draft.emit("preview");
		});

		tr.createEl("td", { text: col.source, cls: "csv-importer-col-source", attr: { "data-label": "Column", title: col.source } });

		const propTd = tr.createEl("td", { attr: { "data-label": "Property" } });
		const prop = propTd.createEl("input", { type: "text", cls: "csv-importer-prop-input", attr: { "aria-label": `Property name for ${col.source}` } });
		prop.value = col.property;
		prop.addEventListener("input", () => {
			col.property = prop.value;
			draft.emitPreviewDebounced();
		});

		const typeTd = tr.createEl("td", { attr: { "data-label": "Type" } });
		const sel = typeTd.createEl("select", { cls: "dropdown", attr: { "aria-label": `Type of ${col.source}` } });
		for (const [value, label] of Object.entries(TYPE_LABELS)) sel.createEl("option", { value, text: label });
		sel.value = col.type;

		const tplTd = tr.createEl("td", { cls: "csv-importer-col-template", attr: { "data-label": "Template" } });
		const tplToggle = tplTd.createEl("button", {
			cls: "csv-importer-chip",
			text: "Template…",
			attr: { type: "button", "aria-expanded": "false", title: "Transform the value, for example [[{{value}}]] to make a link" },
		});
		const tplBox = tplTd.createDiv({ cls: "csv-importer-col-template-box" });
		const tpl = tplBox.createEl("input", {
			type: "text",
			cls: "csv-importer-prop-input",
			attr: { placeholder: "{{value}}", "aria-label": `Value template for ${col.source}` },
		});
		tpl.value = col.valueTemplate ?? "";
		const linkBtn = tplBox.createEl("button", {
			cls: "csv-importer-chip",
			text: "Link",
			attr: { type: "button", title: "Turn values into links: [[{{value}}]]" },
		});
		const setTemplateOpen = (open: boolean): void => {
			tplBox.toggleClass("csv-importer-hidden", !open);
			tplToggle.toggleClass("csv-importer-hidden", open);
			tplToggle.setAttr("aria-expanded", String(open));
		};
		setTemplateOpen(!!col.valueTemplate);
		tplToggle.addEventListener("click", () => {
			setTemplateOpen(true);
			tpl.focus();
		});

		const sample = this.firstSample(col);
		const convTd = tr.createEl("td", { cls: "csv-importer-col-converted", attr: { "data-label": "Sample" } });
		const sampleLine = convTd.createDiv();
		const showConv = (): void => {
			const out = this.previewColumnValue(col);
			sampleLine.setText(sample === "" ? "" : sample === out ? sample : `${sample} → ${out}`);
			sampleLine.setAttr("title", sample === "" ? "" : `${sample} → ${out}`);
		};
		showConv();
		if (this.hasTimezones(col)) convTd.createDiv({ cls: "csv-importer-col-note", text: "Time zones are dropped" });

		tpl.addEventListener("input", () => {
			col.valueTemplate = tpl.value === "" ? undefined : tpl.value;
			showConv();
			draft.emitPreviewDebounced();
		});
		linkBtn.addEventListener("click", () => {
			tpl.value = LINK_TEMPLATE;
			col.valueTemplate = LINK_TEMPLATE;
			showConv();
			draft.emit("preview");
		});

		sel.addEventListener("change", () => {
			col.type = sel.value as PropertyType;
			showConv();
			draft.emit("preview");
		});
	}
}
