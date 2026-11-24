import { Menu, Setting, setIcon } from "obsidian";
import type { ExtraProperty, FrontmatterValue, PropertyType } from "../../types";
import { extraPropertyConflicts, formatValue, planNotes } from "../../import/noteBuilder";
import { COLUMN_OPTIONS, TYPE_LABELS } from "../labels";
import {
	ADD_EMPTY_PROPERTY,
	ADD_ID_PROPERTY,
	ADD_PROPERTY,
	EXTRA_PROPERTIES,
	EXTRA_PROPERTIES_DESC,
	EXTRA_DEFAULT_HELP,
	NEW_PROPERTY,
	RESULT,
} from "./copy";
import { insertAtCursor, placeholderTokens, renderChipRow } from "./chips";
import type { ConfigDraft } from "./ConfigDraft";
import { buildPropertyRowParts, syncPropertyInputs } from "./propertyRow";

const EXTRA_TOKENS = ["{{today}}", "{{now}}", "{{uuid}}"];
const SAMPLE_NAME = "__csv_importer_extra_sample__";

let rowCounter = 0;

/**
 * Extra properties: properties that are not in the CSV but added to every note. Its own section of the Properties
 * tab (heading and description), with rows on the same grid as the column rows and an "Add property" button.
 */
export class ExtraPropertiesSection {
	private listEl!: HTMLElement;
	private readonly warnings = new Map<ExtraProperty, HTMLElement>();

	constructor(private readonly draft: ConfigDraft) {}

	build(parent: HTMLElement): void {
		const heading = new Setting(parent).setHeading().setName(EXTRA_PROPERTIES).setDesc(EXTRA_PROPERTIES_DESC);
		heading.settingEl.setAttr("data-testid", "config-extras-heading");
		this.listEl = parent.createDiv({ cls: "csv-importer-col-list csv-importer-extra-list" });
		const addRow = parent.createDiv({ cls: "csv-importer-extra-add" });
		const add = addRow.createEl("button", { cls: "csv-importer-add-prop", attr: { type: "button", "aria-haspopup": "menu" } });
		setIcon(add.createSpan({ cls: "csv-importer-add-prop-icon", attr: { "aria-hidden": "true" } }), "plus");
		add.createSpan({ text: ADD_PROPERTY });
		add.addEventListener("click", (evt) => {
			const menu = new Menu();
			menu.addItem((item) => item.setTitle(ADD_EMPTY_PROPERTY).setIcon("plus").onClick(() => this.addProperty("", "")));
			menu.addItem((item) => item.setTitle(ADD_ID_PROPERTY).setIcon("key-round").onClick(() => this.addId()));
			menu.showAtMouseEvent(evt);
		});
		this.renderList();
		this.draft.on("parsing", () => this.renderList());
		this.draft.on("columns", () => this.updateWarnings());
	}

	private addProperty(name: string, defaultValue: string): void {
		this.draft.cfg.extraProperties.push({ property: name, type: "text", defaultValue });
		this.renderList();
		this.draft.emit("preview");
		const rows = this.listEl.querySelectorAll<HTMLInputElement>(".csv-importer-col-main .csv-importer-col-prop");
		rows[rows.length - 1]?.focus();
	}

	/** Gives every new note a unique ID (UUID); the ID is kept on re-import. */
	private addId(): void {
		const taken = new Set(this.draft.cfg.extraProperties.map((e) => e.property.trim().toLowerCase()));
		let name = "id";
		for (let n = 2; taken.has(name); n++) name = `id ${n}`;
		this.addProperty(name, "{{uuid}}");
	}

	private renderList(): void {
		this.listEl.empty();
		this.warnings.clear();
		for (const prop of this.draft.cfg.extraProperties) this.renderRow(prop);
		this.updateWarnings();
	}

	/** The default of `prop` as the first CSV row would get it. */
	private sampleOf(prop: ExtraProperty): string {
		const { parsed, cfg, file } = this.draft;
		if (!parsed || parsed.rows.length === 0) return "";
		try {
			const one = { ...parsed, rows: parsed.rows.slice(0, 1), rowNumbers: parsed.rowNumbers.slice(0, 1) };
			const probe = { ...cfg, rowFilter: null, extraProperties: [{ ...prop, property: SAMPLE_NAME }] };
			const note = planNotes(one, probe, { path: file.path, basename: file.basename })[0];
			if (!note) return "";
			const v: FrontmatterValue | undefined = note.frontmatter[SAMPLE_NAME];
			if (v === undefined || v === null) return "";
			return Array.isArray(v) ? JSON.stringify(v) : formatValue(v);
		} catch {
			return "";
		}
	}

	private renderRow(prop: ExtraProperty): void {
		const draft = this.draft;
		const id = `csv-importer-extra-opts-${++rowCounter}`;
		const row = this.listEl.createDiv({ cls: "csv-importer-col-row csv-importer-extra-row", attr: { "data-testid": "config-extra-row" } });
		const main = row.createDiv({ cls: "csv-importer-col-main" });

		const remove = main.createEl("button", { cls: "clickable-icon csv-importer-extra-remove", attr: { type: "button", "aria-label": "Remove property", title: "Remove property" } });
		setIcon(remove, "trash-2");
		remove.addEventListener("click", () => {
			const list = draft.cfg.extraProperties;
			const i = list.indexOf(prop);
			if (i >= 0) list.splice(i, 1);
			this.renderList();
			draft.emit("preview");
		});

		main.createSpan({ cls: "csv-importer-col-source csv-importer-new-prop", text: NEW_PROPERTY });

		const name = main.createEl("input", {
			type: "text",
			cls: "csv-importer-prop-input csv-importer-col-prop",
			attr: { placeholder: "Property name", "aria-label": "Extra property name" },
		});
		name.value = prop.property;

		const sel = main.createEl("select", { cls: "dropdown csv-importer-col-type", attr: { "aria-label": "Extra property type" } });
		for (const [value, label] of Object.entries(TYPE_LABELS)) sel.createEl("option", { value, text: label });
		sel.value = prop.type;

		const { optDot, sampleEl, sampleAfter, summaryText, opts, narrowProp } = buildPropertyRowParts(row, main, {
			id,
			optionsLabel: `${COLUMN_OPTIONS} for extra property`,
			propertyAttr: { placeholder: "Property name", "aria-label": "Extra property name" },
			property: prop.property,
		});

		const defField = opts.createDiv({ cls: "csv-importer-opt" });
		const defId = `${id}-def`;
		defField.createEl("label", { text: "Default value", attr: { for: defId } });
		const def = defField.createEl("input", {
			type: "text",
			cls: "csv-importer-prop-input csv-importer-extra-default",
			attr: { id: defId, placeholder: "e.g. open or {{today}}", "aria-label": "Default value" },
		});
		def.value = prop.defaultValue;
		const chips = defField.createDiv({ cls: "csv-importer-chips" });
		renderChipRow(chips, "Insert:", [...EXTRA_TOKENS, ...placeholderTokens(draft.parsed?.headers)], (token) => {
			prop.defaultValue = insertAtCursor(def, token);
			refresh();
			draft.emit("preview");
		});
		const result = defField.createDiv({ cls: "csv-importer-opt-result" });
		defField.createDiv({ cls: "csv-importer-opt-help", text: EXTRA_DEFAULT_HELP });

		const refresh = (): void => {
			const out = this.sampleOf(prop);
			sampleAfter.setText(out);
			sampleEl.setAttr("title", out);
			summaryText.setText(`→ ${prop.property || NEW_PROPERTY}${out === "" ? "" : ` · ${out}`}`);
			result.setText(out === "" ? "" : `${RESULT}: ${out}`);
			optDot.toggleClass("csv-importer-hidden", prop.defaultValue === "");
		};
		refresh();

		syncPropertyInputs(name, narrowProp, (value) => {
			prop.property = value;
			this.updateWarnings();
			refresh();
			draft.emitPreviewDebounced();
		});
		sel.addEventListener("change", () => {
			prop.type = sel.value as PropertyType;
			refresh();
			draft.emit("preview");
		});
		def.addEventListener("input", () => {
			prop.defaultValue = def.value;
			refresh();
			draft.emitPreviewDebounced();
		});

		this.warnings.set(prop, row.createDiv({ cls: "csv-importer-field-error csv-importer-extra-warning", attr: { role: "status" } }));
	}

	private updateWarnings(): void {
		const list = this.draft.cfg.extraProperties;
		let conflicts: string[] = [];
		try {
			conflicts = extraPropertyConflicts(this.draft.cfg);
		} catch {
			conflicts = [];
		}
		const conflictSet = new Set(conflicts.map((c) => c.toLowerCase()));
		const seen = new Map<string, number>();
		for (const p of list) {
			const k = p.property.trim().toLowerCase();
			if (k !== "") seen.set(k, (seen.get(k) ?? 0) + 1);
		}
		for (const p of list) {
			const el = this.warnings.get(p);
			if (!el) continue;
			const k = p.property.trim().toLowerCase();
			let msg = "";
			if (k === "") msg = "Enter a property name. Properties without a name are ignored.";
			else if ((seen.get(k) ?? 0) > 1) msg = "Another extra property has the same name. Only the first one is used.";
			else if (conflictSet.has(k)) msg = "Has the same name as a CSV column and is ignored.";
			el.setText(msg);
			el.toggleClass("csv-importer-hidden", msg === "");
		}
	}
}
