import { Notice, Setting } from "obsidian";
import type { CsvEncoding, DelimiterOption, EmptyValueMode } from "../../types";
import { sourceLinkProperty } from "../../import/noteBuilder";
import { errorMessage } from "../../core/util";
import {
	CONFIG_DESC,
	DECIMAL_OPTIONS_DIALOG,
	DELIMITER_OPTIONS_DIALOG,
	EMPTY_VALUE_OPTIONS,
	ENCODING_LABELS,
	NAME,
	PRECISION_ERROR,
} from "../labels";
import { insertAtCursor, placeholderTokens, renderChipRow } from "./chips";
import type { ConfigDraft } from "./ConfigDraft";

/** The collapsible "Advanced" section: parsing options, number and empty-cell handling, templates and flags. */
export class AdvancedSection {
	private detailsEl!: HTMLDetailsElement;
	private bodyChipsEl!: HTMLElement;
	private bodyInput: HTMLTextAreaElement | null = null;
	private sourceHintEl: HTMLElement | null = null;
	private encodingSetting: Setting | null = null;

	constructor(private readonly draft: ConfigDraft) {}

	build(parent: HTMLElement): void {
		this.detailsEl = parent.createEl("details", { cls: "csv-importer-advanced" });
		this.detailsEl.createEl("summary", { text: "Advanced" });
		this.buildParsingOptions(this.detailsEl);
		this.buildContentOptions(this.detailsEl);
		if (this.draft.looksWrong()) this.detailsEl.open = true;
		this.renderChips();

		this.draft.on("parsing", () => {
			if (this.draft.looksWrong()) this.detailsEl.open = true;
			this.renderChips();
		});
		this.draft.on("preview", () => this.updateSourceHint());
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
					.addOptions(DELIMITER_OPTIONS_DIALOG)
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
					.addOptions(DECIMAL_OPTIONS_DIALOG)
					.setValue(cfg.decimalSeparator)
					.onChange((v) => {
						cfg.decimalSeparator = v as "." | ",";
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
		const sourceSetting = new Setting(el).setName("Add source link").setDesc(CONFIG_DESC.sourceLink);
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
		new Setting(el)
			.setName("Update existing notes not created by this import")
			.setDesc(CONFIG_DESC.adopt)
			.addToggle((t) =>
				t.setValue(cfg.adoptExistingNotes).onChange((v) => {
					cfg.adoptExistingNotes = v;
					this.draft.emit("preview");
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
