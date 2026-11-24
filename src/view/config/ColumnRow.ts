import { setIcon } from "obsidian";
import type { ColumnConfig, FrontmatterValue, PropertyType } from "../../types";
import { convertValue, hasTimezoneOffsets } from "../../csv/typeInference";
import { applyValueTemplate, formatValue } from "../../import/noteBuilder";
import { COLUMN_OPTIONS, IGNORE_UNITS, TYPE_LABELS, VALUE_TEMPLATE } from "../labels";
import { LINK_TEMPLATE, conversionOptions } from "../shared";
import { insertAtCursor, renderChipRow } from "./chips";
import type { ConfigDraft } from "./ConfigDraft";
import { OPTIONS_CLOSE, OPTIONS_OPEN, RESULT } from "./copy";

let rowCounter = 0;

function firstSample(draft: ConfigDraft, col: ColumnConfig): string {
	const parsed = draft.parsed;
	if (!parsed) return "";
	for (const r of parsed.rows) {
		const v = r[col.index] ?? "";
		if (v.trim() !== "") return v;
	}
	return "";
}

function hasTimezones(draft: ConfigDraft, col: ColumnConfig): boolean {
	const parsed = draft.parsed;
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

/** Converted (and templated) value of the first non-empty cell of a column. */
function convertedSample(draft: ConfigDraft, col: ColumnConfig): string {
	const { parsed, cfg, file } = draft;
	if (!parsed) return "";
	const rowIndex = parsed.rows.findIndex((r) => (r[col.index] ?? "").trim() !== "");
	if (rowIndex < 0) return "";
	const row = parsed.rows[rowIndex];
	if (!row) return "";
	let v: FrontmatterValue;
	try {
		const convert = (c: ColumnConfig, raw: string): FrontmatterValue => {
			// stripUnits is a per-column option of the number conversion.
			const opts = { ...conversionOptions(cfg), stripUnits: !!c.stripUnits };
			return convertValue(raw, c.type, opts);
		};
		v = convert(col, row[col.index] ?? "");
		if (col.valueTemplate) {
			// Display values of all columns, as the real import builds them for templates.
			const formatted = parsed.headers.map((_h, idx) => {
				const c = cfg.columns.find((x) => x.index === idx);
				const raw = (row[idx] ?? "").trim();
				if (!c || c.type === "text" || c.type === "list") return raw;
				const cv = convert(c, row[idx] ?? "");
				return cv === null ? "" : formatValue(cv);
			});
			v = applyValueTemplate(col.valueTemplate, v, {
				headers: parsed.headers,
				row,
				rowNumber: parsed.rowNumbers[rowIndex] ?? rowIndex + 1,
				fileBasename: file.basename,
				formatted,
			});
		}
	} catch {
		v = null;
	}
	if (v === null) return "(empty)";
	return Array.isArray(v) ? JSON.stringify(v) : formatValue(v);
}

/** Tooltip of a sample: the full value, and the raw cell before it when the conversion changed it. */
function sampleTitle(raw: string, converted: string): string {
	if (raw === "") return "";
	return raw === converted ? raw : `${raw} → ${converted}`;
}

/**
 * One column of the CSV: include checkbox, source name, property input, type dropdown, an options button and the sample.
 * The options (value template, ignore units) expand inline below the row. On narrow layouts CSS turns the row into
 * two lines (name and type, then `property · sample`), and the second line toggles the options.
 */
export function renderColumnRow(list: HTMLElement, col: ColumnConfig, draft: ConfigDraft): void {
	const id = `csv-importer-col-opts-${++rowCounter}`;
	const row = list.createDiv({ cls: "csv-importer-col-row" });
	row.toggleClass("is-excluded", !col.include);
	const main = row.createDiv({ cls: "csv-importer-col-main" });

	const cb = main.createEl("input", { type: "checkbox", cls: "csv-importer-col-use", attr: { "aria-label": `Include ${col.source}` } });
	cb.checked = col.include;
	cb.addEventListener("change", () => {
		col.include = cb.checked;
		row.toggleClass("is-excluded", !col.include);
		draft.emit("preview");
	});

	main.createSpan({ cls: "csv-importer-col-source", text: col.source, attr: { title: col.source } });

	const prop = main.createEl("input", { type: "text", cls: "csv-importer-prop-input csv-importer-col-prop", attr: { "aria-label": `Property name for ${col.source}` } });
	prop.value = col.property;

	const sel = main.createEl("select", { cls: "dropdown csv-importer-col-type", attr: { "aria-label": `Type of ${col.source}` } });
	for (const [value, label] of Object.entries(TYPE_LABELS)) sel.createEl("option", { value, text: label });
	sel.value = col.type;

	const optBtn = main.createEl("button", {
		cls: "clickable-icon csv-importer-col-options-btn",
		attr: { type: "button", "aria-expanded": "false", "aria-controls": id, "aria-label": `${COLUMN_OPTIONS} for ${col.source}`, title: COLUMN_OPTIONS },
	});
	setIcon(optBtn, "sliders-horizontal");
	const optDot = optBtn.createSpan({ cls: "csv-importer-options-dot" });

	// The value the note gets; the raw cell is in the tooltip when the two differ. One ellipsis, not one per side.
	const sampleEl = main.createDiv({ cls: "csv-importer-col-sample", attr: { "data-testid": "config-col-sample" } });
	const sampleAfter = sampleEl.createSpan({ cls: "csv-importer-col-after" });

	// Second line on narrow layouts; tapping it opens the options.
	const summary = row.createEl("button", { cls: "csv-importer-col-summary", attr: { type: "button", "aria-expanded": "false", "aria-controls": id } });
	const summaryText = summary.createSpan({ cls: "csv-importer-col-summary-text" });
	setIcon(summary.createSpan({ cls: "csv-importer-col-summary-icon" }), "chevron-right");

	const opts = row.createDiv({ cls: "csv-importer-col-options csv-importer-hidden", attr: { id } });

	// Property name, repeated here for the narrow layout where the grid input is hidden.
	const narrowProp = opts.createDiv({ cls: "csv-importer-opt csv-importer-opt-prop" });
	narrowProp.createEl("label", { text: "Property name" });
	const prop2 = narrowProp.createEl("input", { type: "text", cls: "csv-importer-prop-input", attr: { "aria-label": `Property name for ${col.source}` } });
	prop2.value = col.property;

	const tplField = opts.createDiv({ cls: "csv-importer-opt" });
	const tplId = `${id}-tpl`;
	tplField.createEl("label", { text: VALUE_TEMPLATE, attr: { for: tplId } });
	const tpl = tplField.createEl("input", { type: "text", cls: "csv-importer-prop-input", attr: { id: tplId, placeholder: "{{value}}" } });
	tpl.value = col.valueTemplate ?? "";
	const chips = tplField.createDiv({ cls: "csv-importer-chips" });
	renderChipRow(chips, "Insert:", ["{{value}}", LINK_TEMPLATE, "{{row}}"], (token) => {
		col.valueTemplate = insertAtCursor(tpl, token) || undefined;
		refresh();
		draft.emit("preview");
	});
	const result = tplField.createDiv({ cls: "csv-importer-opt-result" });

	const unitsLabel = opts.createEl("label", { cls: "csv-importer-units" });
	const unitsCb = unitsLabel.createEl("input", { type: "checkbox" });
	unitsCb.checked = !!col.stripUnits;
	unitsLabel.createSpan({ text: IGNORE_UNITS });

	const note = opts.createDiv({ cls: "csv-importer-col-note" });

	// Options always start collapsed; the dot on the options button marks columns that have options set.
	let open = false;
	const setOpen = (v: boolean): void => {
		open = v;
		opts.toggleClass("csv-importer-hidden", !open);
		row.toggleClass("is-open", open);
		for (const b of [optBtn, summary]) b.setAttr("aria-expanded", String(open));
		optBtn.setAttr("title", open ? OPTIONS_CLOSE : OPTIONS_OPEN);
	};

	const sample = firstSample(draft, col);
	function refresh(): void {
		const out = convertedSample(draft, col);
		const shown = sample === "" ? "" : out;
		sampleAfter.setText(shown);
		sampleEl.setAttr("title", sampleTitle(sample, out));
		summary.setAttr("title", sampleTitle(sample, out));
		summaryText.setText(`→ ${col.property || col.source}${shown === "" ? "" : ` · ${shown}`}`);
		result.setText(sample === "" ? "" : `${RESULT}: ${out}`);
		const hasOptions = !!col.valueTemplate || (col.type === "number" && !!col.stripUnits);
		optDot.toggleClass("csv-importer-hidden", !hasOptions);
		unitsLabel.toggleClass("csv-importer-hidden", col.type !== "number");
		const tz = hasTimezones(draft, col);
		note.setText(tz ? "Time zones are dropped" : "");
		note.toggleClass("csv-importer-hidden", !tz);
	}
	refresh();
	setOpen(open);

	const onProp = (src: HTMLInputElement, other: HTMLInputElement): void => {
		col.property = src.value;
		other.value = src.value;
		refresh();
		draft.emitPreviewDebounced();
	};
	prop.addEventListener("input", () => onProp(prop, prop2));
	prop2.addEventListener("input", () => onProp(prop2, prop));

	sel.addEventListener("change", () => {
		col.type = sel.value as PropertyType;
		refresh();
		draft.emit("preview");
	});
	tpl.addEventListener("input", () => {
		col.valueTemplate = tpl.value === "" ? undefined : tpl.value;
		refresh();
		draft.emitPreviewDebounced();
	});
	unitsCb.addEventListener("change", () => {
		col.stripUnits = unitsCb.checked;
		refresh();
		draft.emit("preview");
	});
	optBtn.addEventListener("click", () => setOpen(!open));
	summary.addEventListener("click", () => setOpen(!open));
}
