import { Menu, setIcon } from "obsidian";
import type { ExtraProperty, PropertyType } from "../../types";
import { extraPropertyConflicts } from "../../import/noteBuilder";
import { sectionHeading } from "../dom";
import { EXTRA_PROPERTIES_HELP, TYPE_LABELS } from "../labels";
import { ADD_EMPTY_PROPERTY, ADD_ID_PROPERTY, ADD_PROPERTY, EXTRA_PROPERTIES } from "./copy";
import { insertAtCursor, placeholderTokens, renderChipRow } from "./chips";
import type { ConfigDraft } from "./ConfigDraft";

const EXTRA_TOKENS = ["{{today}}", "{{now}}", "{{uuid}}"];

/** The "Extra properties" section: properties that are not in the CSV but added to every note. */
export class ExtraPropertiesSection {
	private listEl!: HTMLElement;
	private chipsEl!: HTMLElement;
	/** Default-value input that was focused last; chips insert into it. */
	private activeInput: { input: HTMLInputElement; prop: ExtraProperty } | null = null;
	private readonly warnings = new Map<ExtraProperty, HTMLElement>();

	constructor(private readonly draft: ConfigDraft) {}

	build(parent: HTMLElement): void {
		sectionHeading(parent, EXTRA_PROPERTIES);
		parent.createDiv({ cls: "setting-item-description csv-importer-section-help", text: EXTRA_PROPERTIES_HELP });
		this.listEl = parent.createDiv({ cls: "csv-importer-extra-list" });
		const addRow = parent.createDiv({ cls: "csv-importer-extra-add" });
		const add = addRow.createEl("button", { text: ADD_PROPERTY, attr: { type: "button", "aria-haspopup": "menu" } });
		add.addEventListener("click", (evt) => {
			const menu = new Menu();
			menu.addItem((item) => item.setTitle(ADD_EMPTY_PROPERTY).setIcon("plus").onClick(() => this.addProperty("", "")));
			menu.addItem((item) => item.setTitle(ADD_ID_PROPERTY).setIcon("key-round").onClick(() => this.addId()));
			menu.showAtMouseEvent(evt);
		});
		this.chipsEl = parent.createDiv({ cls: "csv-importer-chips" });
		this.renderList();
		this.renderChips();
		this.draft.on("parsing", () => {
			this.renderList();
			this.renderChips();
		});
		this.draft.on("columns", () => this.updateWarnings());
	}

	private addProperty(name: string, defaultValue: string): void {
		this.draft.cfg.extraProperties.push({ property: name, type: "text", defaultValue });
		this.renderList();
		this.draft.emit("preview");
	}

	/** Gives every new note a unique ID (UUID); the ID is kept on re-import. */
	private addId(): void {
		const taken = new Set(this.draft.cfg.extraProperties.map((e) => e.property.trim().toLowerCase()));
		let name = "id";
		for (let n = 2; taken.has(name); n++) name = `id ${n}`;
		this.addProperty(name, "{{uuid}}");
	}

	private renderChips(): void {
		const tokens = [...EXTRA_TOKENS, ...placeholderTokens(this.draft.parsed?.headers)];
		renderChipRow(this.chipsEl, "Insert into default value:", tokens, (token) => {
			const active = this.activeInput;
			if (!active) return;
			active.prop.defaultValue = insertAtCursor(active.input, token);
			this.draft.emit("preview");
		});
		this.chipsEl.toggleClass("csv-importer-hidden", this.draft.cfg.extraProperties.length === 0);
	}

	private renderList(): void {
		const { extraProperties } = this.draft.cfg;
		this.listEl.empty();
		this.warnings.clear();
		this.activeInput = null;
		for (const prop of extraProperties) this.renderRow(prop);
		this.chipsEl?.toggleClass("csv-importer-hidden", extraProperties.length === 0);
		this.updateWarnings();
	}

	private renderRow(prop: ExtraProperty): void {
		const draft = this.draft;
		const row = this.listEl.createDiv({ cls: "csv-importer-extra-row" });
		const fields = row.createDiv({ cls: "csv-importer-extra-fields" });

		const name = fields.createEl("input", { type: "text", cls: "csv-importer-prop-input", attr: { placeholder: "Property name", "aria-label": "Extra property name" } });
		name.value = prop.property;
		name.addEventListener("input", () => {
			prop.property = name.value;
			this.updateWarnings();
			draft.emitPreviewDebounced();
		});

		const sel = fields.createEl("select", { cls: "dropdown", attr: { "aria-label": "Extra property type" } });
		for (const [value, label] of Object.entries(TYPE_LABELS)) sel.createEl("option", { value, text: label });
		sel.value = prop.type;
		sel.addEventListener("change", () => {
			prop.type = sel.value as PropertyType;
			draft.emit("preview");
		});

		const def = fields.createEl("input", {
			type: "text",
			cls: "csv-importer-prop-input csv-importer-extra-default",
			attr: { placeholder: "Default, e.g. open or {{today}}", "aria-label": "Default value" },
		});
		def.value = prop.defaultValue;
		def.addEventListener("focus", () => {
			this.activeInput = { input: def, prop };
		});
		def.addEventListener("input", () => {
			prop.defaultValue = def.value;
			draft.emitPreviewDebounced();
		});

		const remove = fields.createEl("button", { cls: "clickable-icon csv-importer-extra-remove", attr: { type: "button", "aria-label": "Remove property" } });
		setIcon(remove, "trash-2");
		remove.addEventListener("click", () => {
			const list = draft.cfg.extraProperties;
			const i = list.indexOf(prop);
			if (i >= 0) list.splice(i, 1);
			this.renderList();
			draft.emit("preview");
		});

		this.warnings.set(prop, row.createDiv({ cls: "csv-importer-field-error", attr: { role: "status" } }));
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
