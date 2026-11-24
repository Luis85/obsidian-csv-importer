import { Setting } from "obsidian";
import { CONFIG_TABS } from "../labels";
import { renderColumnRow } from "./ColumnRow";
import { ExtraPropertiesSection } from "./ExtraPropertiesSection";
import type { ConfigDraft } from "./ConfigDraft";
import { COLUMNS_HELP, NO_COLUMNS, REDETECT_TYPES, SAMPLE_HEADER } from "./copy";

/** Top of the "Columns" tab: one compact row per column with include, property name, type and options. */
export class ColumnsSection {
	private columnsEl!: HTMLElement;

	private readonly extras: ExtraPropertiesSection;

	constructor(private readonly draft: ConfigDraft) {
		this.extras = new ExtraPropertiesSection(draft);
	}

	build(parent: HTMLElement): void {
		new Setting(parent)
			.setName(CONFIG_TABS.columns)
			.setDesc(COLUMNS_HELP)
			.addButton((b) => b.setButtonText(REDETECT_TYPES).onClick(() => this.draft.redetectTypes()));
		this.columnsEl = parent.createDiv({ cls: "csv-importer-columns" });
		this.render();
		this.draft.on("columns", () => this.render());
		// Extra properties are further rows of the same table.
		this.extras.build(parent.createDiv({ cls: "csv-importer-extras" }));
	}

	private render(): void {
		const el = this.columnsEl;
		const { cfg, parseError } = this.draft;
		el.empty();
		if (parseError) {
			el.createDiv({ cls: "csv-importer-empty csv-importer-error", text: `Could not read this file as a table: ${parseError}. Try another delimiter or encoding under File & rows.` });
			return;
		}
		if (cfg.columns.length === 0) {
			el.createDiv({ cls: "csv-importer-empty", text: NO_COLUMNS });
			return;
		}
		const head = el.createDiv({ cls: "csv-importer-col-head", attr: { "aria-hidden": "true" } });
		for (const h of ["Use", "Column", "Property name", "Type", "", SAMPLE_HEADER]) head.createSpan({ text: h });
		const list = el.createDiv({ cls: "csv-importer-col-list" });
		for (const col of cfg.columns) renderColumnRow(list, col, this.draft);
	}
}
