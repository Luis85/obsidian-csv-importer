import { Setting } from "obsidian";
import { renderColumnRow } from "./ColumnRow";
import { ExtraPropertiesSection } from "./ExtraPropertiesSection";
import type { ConfigDraft } from "./ConfigDraft";
import { COLUMNS_HELP, NO_COLUMNS, PARSE_ERROR_HINT, REDETECT_TYPES, SAMPLE_HEADER } from "./copy";

/**
 * Top of the "Properties" tab: one compact row per column with include, property name, type, options and sample,
 * then the "Extra properties" section. The tab name is the heading, so the column table has none of its own.
 */
export class ColumnsSection {
	private columnsEl!: HTMLElement;

	private readonly extras: ExtraPropertiesSection;

	constructor(private readonly draft: ConfigDraft) {
		this.extras = new ExtraPropertiesSection(draft);
	}

	build(parent: HTMLElement): void {
		const intro = new Setting(parent)
			.setDesc(COLUMNS_HELP)
			.addButton((b) => b.setButtonText(REDETECT_TYPES).onClick(() => this.draft.redetectTypes()));
		intro.settingEl.addClass("csv-importer-columns-intro");
		this.columnsEl = parent.createDiv({ cls: "csv-importer-columns" });
		this.render();
		this.draft.on("columns", () => this.render());
		// Extra properties: their own section, with rows on the same grid as the columns.
		this.extras.build(parent.createDiv({ cls: "csv-importer-extras" }));
	}

	private render(): void {
		const el = this.columnsEl;
		const { cfg, parseError } = this.draft;
		el.empty();
		if (parseError) {
			el.createDiv({ cls: "csv-importer-empty csv-importer-error", text: `Could not read this file as a table: ${parseError}. ${PARSE_ERROR_HINT}` });
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
