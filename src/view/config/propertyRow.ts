import { setIcon } from "obsidian";
import { OPTIONS_CLOSE, OPTIONS_OPEN } from "./copy";

/** What a property row (CSV column or extra property) needs to fill in and update its shared parts. */
export interface PropertyRowParts {
	/** Dot on the options button: marks rows that have options set. */
	optDot: HTMLElement;
	/** The sample cell in the grid; its tooltip carries the full value. */
	sampleEl: HTMLElement;
	sampleAfter: HTMLElement;
	/** The second line on narrow layouts, and its text. */
	summary: HTMLElement;
	summaryText: HTMLElement;
	/** The options panel below the row, collapsed at first. */
	opts: HTMLElement;
	/** Property name input inside the options, for the narrow layout where the grid input is hidden. */
	narrowProp: HTMLInputElement;
}

export interface PropertyRowSpec {
	/** Id of the options panel, referenced by `aria-controls`. */
	id: string;
	/** `aria-label` of the options button. */
	optionsLabel: string;
	/** Extra attributes of the sample cell. */
	sampleAttr?: Record<string, string>;
	/** Attributes of the narrow property name input (besides its type and class). */
	propertyAttr: Record<string, string>;
	/** Current property name. */
	property: string;
}

/**
 * Builds the parts the column rows and the extra property rows share: the options button and the sample at the end
 * of `main`, then in `row` the narrow-layout summary line (which also toggles the options) and the options panel with
 * the repeated property name input. The options start collapsed; the button and the summary line toggle them.
 */
export function buildPropertyRowParts(row: HTMLElement, main: HTMLElement, spec: PropertyRowSpec): PropertyRowParts {
	const { id } = spec;
	const optBtn = main.createEl("button", {
		cls: "clickable-icon csv-importer-col-options-btn",
		attr: { type: "button", "aria-expanded": "false", "aria-controls": id, "aria-label": spec.optionsLabel, title: OPTIONS_OPEN },
	});
	setIcon(optBtn, "sliders-horizontal");
	const optDot = optBtn.createSpan({ cls: "csv-importer-options-dot" });

	// The value the note gets; the raw cell is in the tooltip when the two differ. One ellipsis, not one per side.
	const sampleEl = spec.sampleAttr
		? main.createDiv({ cls: "csv-importer-col-sample", attr: spec.sampleAttr })
		: main.createDiv({ cls: "csv-importer-col-sample" });
	const sampleAfter = sampleEl.createSpan({ cls: "csv-importer-col-after" });

	// Second line on narrow layouts; tapping it opens the options.
	const summary = row.createEl("button", { cls: "csv-importer-col-summary", attr: { type: "button", "aria-expanded": "false", "aria-controls": id } });
	const summaryText = summary.createSpan({ cls: "csv-importer-col-summary-text" });
	setIcon(summary.createSpan({ cls: "csv-importer-col-summary-icon" }), "chevron-right");

	const opts = row.createDiv({ cls: "csv-importer-col-options csv-importer-hidden", attr: { id } });

	// Property name, repeated here for the narrow layout where the grid input is hidden.
	const narrowField = opts.createDiv({ cls: "csv-importer-opt csv-importer-opt-prop" });
	narrowField.createEl("label", { text: "Property name" });
	const narrowProp = narrowField.createEl("input", { type: "text", cls: "csv-importer-prop-input", attr: spec.propertyAttr });
	narrowProp.value = spec.property;

	let open = false;
	const setOpen = (v: boolean): void => {
		open = v;
		opts.toggleClass("csv-importer-hidden", !open);
		row.toggleClass("is-open", open);
		for (const b of [optBtn, summary]) b.setAttr("aria-expanded", String(open));
		optBtn.setAttr("title", open ? OPTIONS_CLOSE : OPTIONS_OPEN);
	};
	setOpen(false);
	optBtn.addEventListener("click", () => setOpen(!open));
	summary.addEventListener("click", () => setOpen(!open));

	return { optDot, sampleEl, sampleAfter, summary, summaryText, opts, narrowProp };
}

/** Keeps the grid and the narrow property name inputs in step: typing in either sets both, then calls `onChange`. */
export function syncPropertyInputs(a: HTMLInputElement, b: HTMLInputElement, onChange: (value: string) => void): void {
	const onInput = (src: HTMLInputElement, other: HTMLInputElement): void => {
		other.value = src.value;
		onChange(src.value);
	};
	a.addEventListener("input", () => onInput(a, b));
	b.addEventListener("input", () => onInput(b, a));
}
