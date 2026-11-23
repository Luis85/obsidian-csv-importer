import { Notice, Setting } from "obsidian";
import type { CsvEncoding, DateOrder, DelimiterOption, EmptyValueMode, RowFilterOp } from "../../types";
import { countMatching, sourceLinkProperty } from "../../import/noteBuilder";
import { errorMessage } from "../../core/util";
import {
	CONFIG_DESC,
	DATE_ORDER_OPTIONS,
	DECIMAL_OPTIONS,
	DELIMITER_OPTIONS,
	EMPTY_VALUE_OPTIONS,
	ENCODING_LABELS,
	FILTER_ROWS,
	FILTER_ROWS_WHERE,
	LINK_NOTES_TO_CSV,
	NAME,
	PRECISION_ERROR,
	ROW_FILTER_OPS,
} from "../labels";
import { filterCount } from "./copy";
import { insertAtCursor, placeholderTokens, renderChipRow } from "./chips";
import type { ConfigDraft } from "./ConfigDraft";

/** Parsing options, row filter, body template, tags and flags, spread over the dialog tabs. */
export class AdvancedSection {
		private bodyChipsEl!: HTMLElement;
	private bodyInput: HTMLTextAreaElement | null = null;
	private sourceHintEl: HTMLElement | null = null;
	private encodingSetting: Setting | null = null;
	private filterBoxEl: HTMLElement | null = null;

	constructor(private readonly draft: ConfigDraft) {}

	/** Parsing options and the row filter: the "File & rows" tab. */
	buildFile(el: HTMLElement): void {
		this.buildRowFilter(el);
		this.buildParsingOptions(el);
		this.draft.on("parsing", () => this.renderRowFilter());
		this.draft.on("preview", () => this.updateFilterCount());
	}

	/** Body, tags, source link and base: the lower part of the "Notes" tab. */
	buildNotesContent(el: HTMLElement): void {
		this.buildContentOptions(el);
		this.renderChips();
		this.draft.on("parsing", () => this.renderChips());
		this.draft.on("preview", () => this.updateSourceHint());
	}

	/** "Adopt existing notes" toggle, shown on the "Re-import" tab. */
	buildAdopt(el: HTMLElement): void {
		new Setting(el)
			.setName("Update existing notes not created by this import")
			.setDesc(CONFIG_DESC.adopt)
			.addToggle((t) =>
				t.setValue(this.draft.cfg.adoptExistingNotes).onChange((v) => {
					this.draft.cfg.adoptExistingNotes = v;
					this.draft.emit("preview");
				}),
			);
	}

	/** Show which encoding "Auto" picked. Only a hint, so failures are ignored. */
	async detectEncoding(): Promise<void> {
		try {
			const res = await this.draft.host.readCsvDecoded(this.draft.file, "auto");
			this.draft.detectedEncoding = res.encoding;
			this.updateEncodingDesc();
		} catch {
			// hint only
		}
	}

	private updateEncodingDesc(): void {
		if (!this.encodingSetting) return;
		const { cfg, detectedEncoding } = this.draft;
		const hint =
			cfg.encoding === "auto" && detectedEncoding ? ` Detected: ${ENCODING_LABELS[detectedEncoding as CsvEncoding] ?? detectedEncoding}.` : "";
		this.encodingSetting.setDesc(CONFIG_DESC.encoding + hint);
	}

	/** Re-read the file with the selected encoding and refresh everything. */
	private async redecode(): Promise<void> {
		try {
			const res = await this.draft.host.readCsvDecoded(this.draft.file, this.draft.cfg.encoding);
			this.draft.text = res.text;
			this.draft.detectedEncoding = res.encoding;
		} catch (e) {
			new Notice(`Could not read the file: ${errorMessage(e)}`);
			return;
		}
		this.updateEncodingDesc();
		this.draft.reparseAndNotify();
	}

	private buildParsingOptions(el: HTMLElement): void {
		const { cfg } = this.draft;
		this.encodingSetting = new Setting(el).setName(NAME.encoding);
		this.encodingSetting.addDropdown((d) =>
			d
				.addOptions(ENCODING_LABELS)
				.setValue(cfg.encoding)
				.onChange((v) => {
					cfg.encoding = v as CsvEncoding;
					void this.redecode();
				}),
		);
		this.updateEncodingDesc();
		new Setting(el)
			.setName(NAME.delimiter)
			.setDesc(CONFIG_DESC.delimiter)
			.addDropdown((d) =>
				d
					.addOptions(DELIMITER_OPTIONS)
					.setValue(cfg.delimiter)
					.onChange((v) => {
						cfg.delimiter = v as DelimiterOption;
						this.draft.reparseAndNotify();
					}),
			);
		new Setting(el)
			.setName(NAME.hasHeader)
			.setDesc(CONFIG_DESC.hasHeader)
			.addToggle((t) =>
				t.setValue(cfg.hasHeader).onChange((v) => {
					cfg.hasHeader = v;
					this.draft.reparseAndNotify();
				}),
			);
		new Setting(el)
			.setName(NAME.decimal)
			.setDesc(CONFIG_DESC.decimal)
			.addDropdown((d) =>
				d
					.addOptions(DECIMAL_OPTIONS)
					.setValue(cfg.decimalSeparator)
					.onChange((v) => {
						cfg.decimalSeparator = v as "." | ",";
						this.draft.redetectTypes();
					}),
			);
		new Setting(el)
			.setName("Date order for dates like 03/04/2026")
			.setDesc("Decides whether the first number is the day or the month. Detect only decides when a value makes it clear, such as 25/12/2026.")
			.addDropdown((d) =>
				d
					.addOptions(DATE_ORDER_OPTIONS)
					.setValue(cfg.dateOrder)
					.onChange((v) => {
						cfg.dateOrder = v as DateOrder;
						this.draft.redetectTypes();
					}),
			);
		new Setting(el)
			.setName(NAME.listSeparator)
			.setDesc(CONFIG_DESC.listSeparator)
			.addText((t) =>
				t.setValue(cfg.listSeparator).onChange((v) => {
					cfg.listSeparator = v;
					this.draft.emit("columns");
				}),
			);
		new Setting(el)
			.setName(NAME.emptyCells)
			.setDesc(CONFIG_DESC.emptyCells)
			.addDropdown((d) =>
				d
					.addOptions(EMPTY_VALUE_OPTIONS)
					.setValue(cfg.emptyValues)
					.onChange((v) => {
						cfg.emptyValues = v as EmptyValueMode;
						this.draft.emit("preview");
					}),
			);
		this.buildPrecision(el);
	}

	private buildPrecision(el: HTMLElement): void {
		const { cfg } = this.draft;
		const precisionSetting = new Setting(el).setName("Number precision").setDesc(CONFIG_DESC.precision);
		const precisionError = precisionSetting.descEl.createDiv({ cls: "csv-importer-field-error", attr: { role: "alert" } });
		precisionError.hide();
		precisionSetting.addText((t) => {
			t.setPlaceholder("Keep source");
			if (cfg.numberPrecision !== null) t.setValue(String(cfg.numberPrecision));
			t.onChange((v) => {
				const trimmed = v.trim();
				if (trimmed === "") {
					cfg.numberPrecision = null;
				} else if (/^\d+$/.test(trimmed) && Number(trimmed) <= 10) {
					cfg.numberPrecision = Number(trimmed);
				} else {
					t.inputEl.addClass("csv-importer-invalid");
					precisionError.setText(PRECISION_ERROR);
					precisionError.show();
					return;
				}
				t.inputEl.removeClass("csv-importer-invalid");
				precisionError.hide();
				this.draft.emit("columns");
			});
		});
	}

	private buildRowFilter(el: HTMLElement): void {
		const { cfg } = this.draft;
		new Setting(el)
			.setName(FILTER_ROWS)
			.setDesc("Rows that do not match are left out of the preview and the import.")
			.addToggle((t) =>
				t.setValue(cfg.rowFilter !== null).onChange((on) => {
					cfg.rowFilter = on ? { column: cfg.columns[0]?.source ?? "", op: "equals", value: "" } : null;
					this.renderRowFilter();
					this.draft.emit("preview");
				}),
			);
		this.filterBoxEl = el.createDiv({ cls: "csv-importer-sub-settings" });
		this.renderRowFilter();
	}

	private renderRowFilter(): void {
		const box = this.filterBoxEl;
		const { cfg } = this.draft;
		if (!box) return;
		box.empty();
		const filter = cfg.rowFilter;
		if (!filter) return;
		if (!cfg.columns.some((c) => c.source === filter.column)) filter.column = cfg.columns[0]?.source ?? "";
		const columns: Record<string, string> = {};
		for (const c of cfg.columns) columns[c.source] = c.source;
		const setting = new Setting(box).setName(FILTER_ROWS_WHERE);
		setting.addDropdown((d) =>
			d.addOptions(columns).setValue(filter.column).onChange((v) => {
				filter.column = v;
				this.draft.emit("preview");
			}),
		);
		setting.addDropdown((d) =>
			d.addOptions(ROW_FILTER_OPS).setValue(filter.op).onChange((v) => {
				filter.op = v as RowFilterOp;
				valueInput?.toggleClass("csv-importer-hidden", filter.op === "empty" || filter.op === "notEmpty");
				this.draft.emit("preview");
			}),
		);
		let valueInput: HTMLInputElement | null = null;
		setting.addText((t) => {
			valueInput = t.inputEl;
			t.setPlaceholder("Value")
				.setValue(filter.value)
				.onChange((v) => {
					filter.value = v;
					this.draft.emitPreviewDebounced();
				});
			t.inputEl.setAttr("aria-label", "Filter value");
			t.inputEl.toggleClass("csv-importer-hidden", filter.op === "empty" || filter.op === "notEmpty");
		});
		box.createDiv({ cls: "csv-importer-filter-count", attr: { "aria-live": "polite" } });
		this.updateFilterCount();
	}

	private updateFilterCount(): void {
		const el = this.filterBoxEl?.querySelector<HTMLElement>(".csv-importer-filter-count");
		const { cfg, parsed } = this.draft;
		if (!el) return;
		if (!cfg.rowFilter || !parsed) {
			el.setText("");
			return;
		}
		let matching = 0;
		try {
			matching = countMatching(parsed, cfg);
		} catch {
			matching = 0;
		}
		el.setText(filterCount(matching, parsed.rows.length));
	}

	private buildContentOptions(el: HTMLElement): void {
		const { cfg } = this.draft;
		const bodySetting = new Setting(el).setName(NAME.body).setDesc(CONFIG_DESC.body);
		bodySetting.addTextArea((t) => {
			this.bodyInput = t.inputEl;
			t.inputEl.rows = 4;
			t.setValue(cfg.bodyTemplate).onChange((v) => {
				cfg.bodyTemplate = v;
				this.draft.emitPreviewDebounced();
			});
		});
		bodySetting.settingEl.addClass("csv-importer-wide-setting");
		this.bodyChipsEl = el.createDiv({ cls: "csv-importer-chips" });

		new Setting(el)
			.setName(NAME.tags)
			.setDesc(CONFIG_DESC.tags)
			.addText((t) =>
				t.setValue(cfg.tags).onChange((v) => {
					cfg.tags = v;
					this.draft.emitPreviewDebounced();
				}),
			);
		const sourceSetting = new Setting(el).setName(LINK_NOTES_TO_CSV).setDesc(CONFIG_DESC.sourceLink);
		this.sourceHintEl = sourceSetting.descEl.createDiv({ cls: "csv-importer-key-hint" });
		sourceSetting.addToggle((t) =>
			t.setValue(cfg.addSourceLink).onChange((v) => {
				cfg.addSourceLink = v;
				this.draft.emit("preview");
			}),
		);
		new Setting(el)
			.setName(NAME.createBase)
			.setDesc(CONFIG_DESC.createBase)
			.addToggle((t) =>
				t.setValue(cfg.createBase).onChange((v) => {
					cfg.createBase = v;
				}),
			);
	}

	private renderChips(): void {
		renderChipRow(this.bodyChipsEl, "Insert into body:", placeholderTokens(this.draft.parsed?.headers), (token) => {
			if (!this.bodyInput) return;
			this.draft.cfg.bodyTemplate = insertAtCursor(this.bodyInput, token);
			this.draft.emit("preview");
		});
	}

	private updateSourceHint(): void {
		const hint = this.sourceHintEl;
		if (!hint) return;
		let prop: string | null = null;
		try {
			prop = sourceLinkProperty(this.draft.cfg);
		} catch {
			prop = null;
		}
		hint.setText(prop === "source_csv" ? "A column is already called source, so the link is written to source_csv." : "");
	}
}
