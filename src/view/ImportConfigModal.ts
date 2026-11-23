import { AbstractInputSuggest, App, Modal, Notice, Setting, TFile, TFolder, debounce, setIcon } from "obsidian";
import type { CsvImporterHost } from "../host";
import type { ColumnConfig, ConflictStrategy, CsvEncoding, DelimiterOption, EmptyValueMode, FileImportConfig, FrontmatterValue, ParsedCsv, PropertyType } from "../types";
import { parseCsv } from "../csv/parser";
import { decodeCsv } from "../csv/encoding";
import { convertValue, hasTimezoneOffsets, inferColumnType, prepareConfig, suggestKeyColumn } from "../csv/typeInference";
import { applyValueTemplate, formatValue, planNotes, resolveTargetFolder, serializeNote, sourceLinkProperty } from "../import/noteBuilder";
import { LINK_TEMPLATE, TYPE_LABELS, conversionOptions, delimiterLabel, inferenceOptions } from "./shared";
import { confirmDialog } from "./ConfirmModal";

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, private inputEl: HTMLInputElement, private onPick: (path: string) => void) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault
			.getAllFolders(false)
			.filter((f) => f.path.toLowerCase().includes(q))
			.sort((a, b) => a.path.localeCompare(b.path))
			.slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.inputEl.value = folder.path;
		this.onPick(folder.path);
		this.close();
	}
}

const CONFLICT_OPTIONS: Record<ConflictStrategy, string> = {
	update: "Update properties",
	skip: "Skip",
	rename: "Create a copy",
	overwrite: "Replace whole note",
};

const CONFLICT_DESCRIPTIONS: Record<ConflictStrategy, string> = {
	update: "Updates the CSV's properties. Properties you added in Obsidian and the note body are kept.",
	skip: "Leaves existing notes untouched.",
	rename: "Creates a new note with a numeric suffix and keeps the existing note as it is.",
	overwrite: "Overwrites the note completely. Properties and text you added in Obsidian are lost. You can undo right after the import.",
};

const ENCODING_LABELS: Record<CsvEncoding, string> = {
	auto: "Auto",
	"utf-8": "UTF-8",
	"utf-16le": "UTF-16 LE",
	"utf-16be": "UTF-16 BE",
	"windows-1252": "Windows-1252",
};

const KEY_DESC =
	"On re-import, the note whose property matches this column is updated, even if renamed. Pick a unique column such as an ID. The column is always written to the notes.";

const PRECISION_ERROR = "Enter a whole number from 0 to 10, or leave empty.";

function cloneConfig(cfg: FileImportConfig): FileImportConfig {
	return { ...cfg, columns: cfg.columns.map((c) => ({ ...c })) };
}

export class ImportConfigModal extends Modal {
	private cfg: FileImportConfig;
	private readonly initialConflict: ConflictStrategy;
	private parsed: ParsedCsv | null = null;
	private parseError: string | null = null;
	private previewRow = 0;
	private saving = false;

	private columnsEl!: HTMLElement;
	private nameChipsEl!: HTMLElement;
	private bodyChipsEl!: HTMLElement;
	private previewEl!: HTMLElement;
	private previewPosEl!: HTMLElement;
	private previewPrevBtn!: HTMLButtonElement;
	private previewNextBtn!: HTMLButtonElement;
	private statusEl!: HTMLElement;
	private warningsEl!: HTMLElement;
	private advancedEl!: HTMLDetailsElement;
	private sourceHintEl: HTMLElement | null = null;
	private nameInput: HTMLInputElement | null = null;
	private bodyInput: HTMLTextAreaElement | null = null;
	private folderInput: HTMLInputElement | null = null;
	private keySettingEl: Setting | null = null;
	private keyHintEl: HTMLElement | null = null;
	private encodingSetting: Setting | null = null;
	private detectedEncoding: string | null = null;
	private updateOptionsEl: HTMLElement | null = null;

	private readonly refreshPreview = debounce(() => this.updatePreview(), 150, true);

	constructor(
		app: App,
		private host: CsvImporterHost,
		private file: TFile,
		private text: string,
		private onSaved?: (cfg: FileImportConfig) => void,
	) {
		super(app);
		this.cfg = cloneConfig(host.getFileConfig(file));
		this.initialConflict = this.cfg.conflict;
	}

	onOpen(): void {
		this.modalEl.addClass("csv-importer-modal");
		this.setTitle(`Import settings: ${this.file.name}`);
		this.reparse();
		this.build();
		this.updatePreview();
		if (this.cfg.encoding === "auto") void this.detectEncoding();
	}

	private async detectEncoding(): Promise<void> {
		try {
			const bytes = await this.app.vault.readBinary(this.file);
			this.detectedEncoding = decodeCsv(bytes, "auto").encoding;
			this.updateEncodingDesc();
		} catch {
			// hint only
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** Re-parse the CSV with the working config and reconcile columns. */
	private reparse(): void {
		this.parseError = null;
		this.parsed = null;
		try {
			if (this.text.trim().length > 0) {
				this.parsed = parseCsv(this.text, { delimiter: this.cfg.delimiter, hasHeader: this.cfg.hasHeader });
				prepareConfig(this.cfg, this.parsed, this.host.settings.midnightAsDate);
			} else {
				this.cfg.columns = [];
			}
		} catch (e) {
			this.parseError = e instanceof Error ? e.message : String(e);
		}
	}

	/** True when the parse result looks wrong, so the parsing options are worth a look. */
	private looksWrong(): boolean {
		if (this.parseError) return true;
		if (this.text.includes("�")) return true;
		if (!this.parsed) return false;
		return this.parsed.headers.length === 1 || this.parsed.warnings.length > 0;
	}

	private renderWarnings(): void {
		this.warningsEl.empty();
		const warnings = this.parsed?.warnings ?? [];
		if (warnings.length === 0) return;
		const box = this.warningsEl.createDiv({ cls: "csv-importer-callout mod-warning", attr: { role: "status" } });
		setIcon(box.createSpan({ cls: "csv-importer-callout-icon" }), "alert-triangle");
		const list = box.createDiv({ cls: "csv-importer-callout-text" });
		for (const w of warnings) list.createDiv({ text: w });
	}

	private renderKeyDropdown(): void {
		const setting = this.keySettingEl;
		if (!setting) return;
		setting.controlEl.empty();
		const options: Record<string, string> = { "": "None" };
		for (const c of this.cfg.columns) options[c.source] = c.source;
		if (this.cfg.keyColumn && !(this.cfg.keyColumn in options)) this.cfg.keyColumn = "";
		setting.addDropdown((d) =>
			d
				.addOptions(options)
				.setValue(this.cfg.keyColumn)
				.onChange((v) => {
					this.cfg.keyColumn = v;
					this.renderKeyHint();
					this.updatePreview();
				}),
		);
		this.renderKeyHint();
	}

	private renderKeyHint(): void {
		const hint = this.keyHintEl;
		if (!hint) return;
		hint.empty();
		if (this.cfg.keyColumn || !this.parsed) return;
		let suggestion: string | null = null;
		try {
			suggestion = suggestKeyColumn(this.parsed, this.cfg.columns);
		} catch {
			suggestion = null;
		}
		if (!suggestion) return;
		const name = suggestion;
		hint.createSpan({ text: `Suggested: ${name}` });
		const btn = hint.createEl("button", { cls: "csv-importer-chip", text: `Use ${name}`, attr: { type: "button" } });
		btn.addEventListener("click", () => {
			this.cfg.keyColumn = name;
			this.renderKeyDropdown();
			this.updatePreview();
		});
	}

	private renderUpdateOptions(): void {
		const box = this.updateOptionsEl;
		if (!box) return;
		box.empty();
		if (this.cfg.conflict !== "update") return;
		new Setting(box)
			.setName("Keep values edited in Obsidian")
			.setDesc("If you changed a CSV property in Obsidian, re-imports keep your value.")
			.addToggle((t) =>
				t.setValue(this.cfg.protectEdits).onChange((v) => {
					this.cfg.protectEdits = v;
				}),
			);
		new Setting(box)
			.setName("Keep values when the CSV cell is empty")
			.setDesc("An empty cell does not clear a value that exists in the note.")
			.addToggle((t) =>
				t.setValue(this.cfg.keepValuesOnEmpty).onChange((v) => {
					this.cfg.keepValuesOnEmpty = v;
				}),
			);
	}

	private updateEncodingDesc(): void {
		if (!this.encodingSetting) return;
		const base = "Text encoding of the file. Change it if special characters look wrong.";
		const hint = this.cfg.encoding === "auto" && this.detectedEncoding ? ` Detected: ${ENCODING_LABELS[this.detectedEncoding as CsvEncoding] ?? this.detectedEncoding}.` : "";
		this.encodingSetting.setDesc(base + hint);
	}

	/** Re-read the file with the selected encoding and refresh everything. */
	private async redecode(): Promise<void> {
		try {
			const bytes = await this.app.vault.readBinary(this.file);
			const res = decodeCsv(bytes, this.cfg.encoding);
			this.text = res.text;
			this.detectedEncoding = res.encoding;
		} catch (e) {
			new Notice(`Could not read the file: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		this.updateEncodingDesc();
		this.onParsingChanged();
	}

	private onParsingChanged(): void {
		this.reparse();
		if (this.looksWrong()) this.advancedEl.open = true;
		this.renderWarnings();
		this.renderKeyDropdown();
		this.renderColumns();
		this.renderChips();
		this.updatePreview();
	}

	private heading(el: HTMLElement, name: string): Setting {
		return new Setting(el).setName(name).setHeading();
	}

	private build(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("csv-importer-config-root");
		const el = root.createDiv({ cls: "csv-importer-config" });

		this.statusEl = el.createDiv({ cls: "csv-importer-config-status" });
		this.warningsEl = el.createDiv();
		this.renderWarnings();

		// Columns
		const colHeading = this.heading(el, "Columns");
		colHeading.addButton((b) => b.setButtonText("Re-detect types").onClick(() => this.redetect()));
		this.columnsEl = el.createDiv({ cls: "csv-importer-columns" });
		this.renderColumns();

		// Output
		this.heading(el, "Output");
		const folderSetting = new Setting(el)
			.setName("Target folder")
			.setDesc(
				"Leave empty to use the default folder shown as placeholder. Placeholders like {{Column}} create subfolders per row, for example Projects/{{Client}}.",
			);
		folderSetting.addText((t) => {
			this.folderInput = t.inputEl;
			t.setValue(this.cfg.targetFolder).onChange((v) => {
				this.cfg.targetFolder = v;
				this.updatePreview();
			});
			this.updateFolderPlaceholder();
			new FolderSuggest(this.app, t.inputEl, (path) => {
				this.cfg.targetFolder = path;
				this.updatePreview();
			});
		});

		const nameSetting = new Setting(el)
			.setName("File name template")
			.setDesc("Use {{Column name}} for cell values, {{row}} for the row number and {{file}} for the CSV name. The note body is set under Advanced.");
		nameSetting.addText((t) => {
			this.nameInput = t.inputEl;
			t.setValue(this.cfg.fileNameTemplate).onChange((v) => {
				this.cfg.fileNameTemplate = v;
				this.refreshPreview();
			});
		});
		nameSetting.settingEl.addClass("csv-importer-wide-setting");
		this.nameChipsEl = el.createDiv({ cls: "csv-importer-chips" });

		const conflictSetting = new Setting(el).setName("When a note already exists");
		const updateConflictDesc = (): void => {
			conflictSetting.setDesc(CONFLICT_DESCRIPTIONS[this.cfg.conflict]);
			conflictSetting.descEl.toggleClass("csv-importer-warning-text", this.cfg.conflict === "overwrite");
		};
		updateConflictDesc();
		conflictSetting.addDropdown((d) =>
			d
				.addOptions(CONFLICT_OPTIONS)
				.setValue(this.cfg.conflict)
				.onChange((v) => {
					this.cfg.conflict = v as ConflictStrategy;
					updateConflictDesc();
					this.renderUpdateOptions();
				}),
		);
		this.updateOptionsEl = el.createDiv({ cls: "csv-importer-sub-settings" });
		this.renderUpdateOptions();

		this.keySettingEl = new Setting(el).setName("Match notes by column").setDesc(KEY_DESC);
		this.keyHintEl = this.keySettingEl.descEl.createDiv({ cls: "csv-importer-key-hint" });
		this.renderKeyDropdown();

		// Preview
		this.heading(el, "Preview");
		const nav = el.createDiv({ cls: "csv-importer-preview-nav" });
		this.previewPrevBtn = nav.createEl("button", { cls: "csv-importer-icon-btn", attr: { type: "button", "aria-label": "Previous row" } });
		setIcon(this.previewPrevBtn, "chevron-left");
		this.previewPosEl = nav.createSpan({ cls: "csv-importer-preview-pos", attr: { "aria-live": "polite" } });
		this.previewNextBtn = nav.createEl("button", { cls: "csv-importer-icon-btn", attr: { type: "button", "aria-label": "Next row" } });
		setIcon(this.previewNextBtn, "chevron-right");
		this.previewPrevBtn.addEventListener("click", () => this.stepPreview(-1));
		this.previewNextBtn.addEventListener("click", () => this.stepPreview(1));
		this.previewEl = el.createEl("pre", { cls: "csv-importer-preview" });

		// Advanced
		this.advancedEl = el.createEl("details", { cls: "csv-importer-advanced" });
		this.advancedEl.createEl("summary", { text: "Advanced" });
		this.buildAdvanced(this.advancedEl);
		if (this.looksWrong()) this.advancedEl.open = true;

		this.renderChips();

		// Footer, outside the scroll area
		const footer = root.createDiv({ cls: "csv-importer-footer modal-button-container" });
		footer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		footer.createEl("button", { text: "Save" }).addEventListener("click", () => void this.save(false));
		footer.createEl("button", { cls: "mod-cta", text: "Save and import" }).addEventListener("click", () => void this.save(true));
	}

	private buildAdvanced(el: HTMLElement): void {
		this.encodingSetting = new Setting(el).setName("Encoding");
		this.encodingSetting.addDropdown((d) =>
			d
				.addOptions(ENCODING_LABELS)
				.setValue(this.cfg.encoding)
				.onChange((v) => {
					this.cfg.encoding = v as CsvEncoding;
					void this.redecode();
				}),
		);
		this.updateEncodingDesc();
		new Setting(el)
			.setName("Delimiter")
			.setDesc("Auto detects the delimiter from the file content.")
			.addDropdown((d) =>
				d
					.addOptions({ auto: "Auto", ",": "Comma", ";": "Semicolon", "\t": "Tab", "|": "Pipe" })
					.setValue(this.cfg.delimiter)
					.onChange((v) => {
						this.cfg.delimiter = v as DelimiterOption;
						this.onParsingChanged();
					}),
			);
		new Setting(el)
			.setName("First row contains column names")
			.setDesc("Turn off if the first row already contains data.")
			.addToggle((t) =>
				t.setValue(this.cfg.hasHeader).onChange((v) => {
					this.cfg.hasHeader = v;
					this.onParsingChanged();
				}),
			);
		new Setting(el)
			.setName("Decimal separator")
			.setDesc("Used to read numbers, for example 0,625 with a comma.")
			.addDropdown((d) =>
				d
					.addOptions({ ".": "Dot (0.625)", ",": "Comma (0,625)" })
					.setValue(this.cfg.decimalSeparator)
					.onChange((v) => {
						this.cfg.decimalSeparator = v as "." | ",";
						this.redetect();
					}),
			);
		new Setting(el)
			.setName("List separator")
			.setDesc("Splits the values of columns with the list type.")
			.addText((t) =>
				t.setValue(this.cfg.listSeparator).onChange((v) => {
					this.cfg.listSeparator = v;
					this.renderColumns();
					this.updatePreview();
				}),
			);
		new Setting(el)
			.setName("Empty cells")
			.setDesc("Leave the property empty, or omit it from the note when the cell is empty.")
			.addDropdown((d) =>
				d
					.addOptions({ empty: "Leave property empty", omit: "Omit property" })
					.setValue(this.cfg.emptyValues)
					.onChange((v) => {
						this.cfg.emptyValues = v as EmptyValueMode;
						this.updatePreview();
					}),
			);

		const precisionSetting = new Setting(el)
			.setName("Number precision")
			.setDesc("Decimal places for numbers, 0 to 10. Leave empty to keep the source precision.");
		const precisionError = precisionSetting.descEl.createDiv({ cls: "csv-importer-field-error", attr: { role: "alert" } });
		precisionError.hide();
		precisionSetting.addText((t) => {
			t.setPlaceholder("Keep source");
			if (this.cfg.numberPrecision !== null) t.setValue(String(this.cfg.numberPrecision));
			t.onChange((v) => {
				const trimmed = v.trim();
				if (trimmed === "") {
					this.cfg.numberPrecision = null;
				} else if (/^\d+$/.test(trimmed) && Number(trimmed) <= 10) {
					this.cfg.numberPrecision = Number(trimmed);
				} else {
					t.inputEl.addClass("csv-importer-invalid");
					precisionError.setText(PRECISION_ERROR);
					precisionError.show();
					return;
				}
				t.inputEl.removeClass("csv-importer-invalid");
				precisionError.hide();
				this.renderColumns();
				this.updatePreview();
			});
		});

		const bodySetting = new Setting(el)
			.setName("Body template")
			.setDesc("Text of each note. Supports the same placeholders as the file name. May be empty.");
		bodySetting.addTextArea((t) => {
			this.bodyInput = t.inputEl;
			t.inputEl.rows = 4;
			t.setValue(this.cfg.bodyTemplate).onChange((v) => {
				this.cfg.bodyTemplate = v;
				this.refreshPreview();
			});
		});
		bodySetting.settingEl.addClass("csv-importer-wide-setting");
		this.bodyChipsEl = el.createDiv({ cls: "csv-importer-chips" });

		new Setting(el)
			.setName("Comma-separated tags")
			.setDesc("Added to every note.")
			.addText((t) =>
				t.setValue(this.cfg.tags).onChange((v) => {
					this.cfg.tags = v;
					this.refreshPreview();
				}),
			);
		const sourceSetting = new Setting(el)
			.setName("Add source link")
			.setDesc("Adds a property that links to the CSV file.");
		this.sourceHintEl = sourceSetting.descEl.createDiv({ cls: "csv-importer-key-hint" });
		sourceSetting.addToggle((t) =>
			t.setValue(this.cfg.addSourceLink).onChange((v) => {
				this.cfg.addSourceLink = v;
				this.updatePreview();
			}),
		);
		new Setting(el)
			.setName("Create a base")
			.setDesc("Creates a .base file next to the target folder that shows the imported notes as a table. Existing base files are never changed.")
			.addToggle((t) =>
				t.setValue(this.cfg.createBase).onChange((v) => {
					this.cfg.createBase = v;
				}),
			);
		new Setting(el)
			.setName("Update existing notes not created by this import")
			.setDesc("Off: notes in the target folder that this CSV did not create are never changed.")
			.addToggle((t) =>
				t.setValue(this.cfg.adoptExistingNotes).onChange((v) => {
					this.cfg.adoptExistingNotes = v;
					this.updatePreview();
				}),
			);
	}

	private updateSourceHint(): void {
		const hint = this.sourceHintEl;
		if (!hint) return;
		let prop: string | null = null;
		try {
			prop = sourceLinkProperty(this.cfg);
		} catch {
			prop = null;
		}
		hint.setText(prop === "source_csv" ? "A column is already called source, so the link is written to source_csv." : "");
	}

	private updateFolderPlaceholder(): void {
		if (!this.folderInput) return;
		try {
			this.folderInput.placeholder = resolveTargetFolder({ ...this.cfg, targetFolder: "" }, this.file.path);
		} catch {
			this.folderInput.placeholder = "";
		}
	}

	private insertPlaceholder(token: string, field: "name" | "body"): void {
		const target = field === "body" ? this.bodyInput : this.nameInput;
		if (!target) return;
		const start = target.selectionStart ?? target.value.length;
		const end = target.selectionEnd ?? target.value.length;
		target.value = target.value.slice(0, start) + token + target.value.slice(end);
		const pos = start + token.length;
		target.focus();
		target.setSelectionRange(pos, pos);
		if (field === "body") this.cfg.bodyTemplate = target.value;
		else this.cfg.fileNameTemplate = target.value;
		this.updatePreview();
	}

	private renderChips(): void {
		const tokens = ["{{row}}", "{{file}}", ...(this.parsed ? this.parsed.headers.map((h) => `{{${h}}}`) : [])];
		const fill = (box: HTMLElement | undefined, label: string, field: "name" | "body"): void => {
			if (!box) return;
			box.empty();
			box.createSpan({ cls: "csv-importer-chips-label", text: label });
			for (const token of tokens) {
				const chip = box.createEl("button", { cls: "csv-importer-chip", text: token });
				chip.type = "button";
				chip.addEventListener("click", (ev) => {
					ev.preventDefault();
					this.insertPlaceholder(token, field);
				});
			}
		};
		fill(this.nameChipsEl, "Insert into file name:", "name");
		fill(this.bodyChipsEl, "Insert into body:", "body");
	}

	private redetect(): void {
		if (!this.parsed) return;
		const opts = inferenceOptions(this.cfg, this.host.settings);
		for (const col of this.cfg.columns) {
			const values = this.parsed.rows.map((r) => r[col.index] ?? "");
			col.type = inferColumnType(values, opts);
		}
		this.renderColumns();
		this.updatePreview();
	}

	private firstSample(col: ColumnConfig): string {
		if (!this.parsed) return "";
		for (const r of this.parsed.rows) {
			const v = r[col.index] ?? "";
			if (v.trim() !== "") return v;
		}
		return "";
	}

	private hasTimezones(col: ColumnConfig): boolean {
		if (!this.parsed || col.type !== "datetime") return false;
		const values: string[] = [];
		for (const r of this.parsed.rows) {
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
		if (!this.parsed) return "";
		const rowIndex = this.parsed.rows.findIndex((r) => (r[col.index] ?? "").trim() !== "");
		if (rowIndex < 0) return "";
		const row = this.parsed.rows[rowIndex];
		let v: FrontmatterValue;
		try {
			v = convertValue(row[col.index] ?? "", col.type, conversionOptions(this.cfg));
			if (col.valueTemplate) {
				v = applyValueTemplate(col.valueTemplate, v, {
					headers: this.parsed.headers,
					row,
					rowNumber: rowIndex + 1,
					fileBasename: this.file.basename,
				});
			}
		} catch {
			v = null;
		}
		if (v === null) return "(empty)";
		return Array.isArray(v) ? JSON.stringify(v) : formatValue(v);
	}

	private renderColumns(): void {
		const el = this.columnsEl;
		el.empty();
		this.updateFolderPlaceholder();
		if (this.parseError) {
			el.createDiv({ cls: "csv-importer-empty csv-importer-error", text: `Could not read this file as a table: ${this.parseError}. Try another delimiter or encoding under Advanced.` });
			return;
		}
		if (this.cfg.columns.length === 0) {
			el.createDiv({ cls: "csv-importer-empty", text: "No columns found." });
			return;
		}
		const scroller = el.createDiv({ cls: "csv-importer-scroll" });
		const table = scroller.createEl("table", { cls: "csv-importer-table csv-importer-columns-table" });
		const head = table.createEl("thead").createEl("tr");
		for (const h of ["Use", "Column", "Property name", "Type", "Value template", "Sample → property value"]) head.createEl("th", { text: h });
		const tbody = table.createEl("tbody");

		for (const col of this.cfg.columns) {
			const tr = tbody.createEl("tr");
			tr.toggleClass("is-excluded", !col.include);

			const useTd = tr.createEl("td", { attr: { "data-label": "Use" } });
			const cb = useTd.createEl("input", { type: "checkbox", attr: { "aria-label": `Include ${col.source}` } });
			cb.checked = col.include;
			cb.addEventListener("change", () => {
				col.include = cb.checked;
				tr.toggleClass("is-excluded", !col.include);
				this.updatePreview();
			});

			tr.createEl("td", { text: col.source, cls: "csv-importer-col-source", attr: { "data-label": "Column", title: col.source } });

			const propTd = tr.createEl("td", { attr: { "data-label": "Property" } });
			const prop = propTd.createEl("input", { type: "text", cls: "csv-importer-prop-input", attr: { "aria-label": `Property name for ${col.source}` } });
			prop.value = col.property;
			prop.addEventListener("input", () => {
				col.property = prop.value;
				this.refreshPreview();
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
				tplBox.toggleClass("is-hidden", !open);
				tplToggle.toggleClass("is-hidden", open);
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
				this.refreshPreview();
			});
			linkBtn.addEventListener("click", () => {
				tpl.value = LINK_TEMPLATE;
				col.valueTemplate = LINK_TEMPLATE;
				showConv();
				this.updatePreview();
			});

			sel.addEventListener("change", () => {
				col.type = sel.value as PropertyType;
				showConv();
				this.updatePreview();
			});
		}
	}

	private stepPreview(delta: number): void {
		const n = this.parsed?.rows.length ?? 0;
		if (n === 0) return;
		this.previewRow = Math.min(n - 1, Math.max(0, this.previewRow + delta));
		this.updatePreview();
	}

	private updatePreview(): void {
		if (!this.previewEl) return;
		this.statusEl.empty();
		const rowCount = this.parsed?.rows.length ?? 0;
		this.previewRow = Math.min(Math.max(0, this.previewRow), Math.max(0, rowCount - 1));
		this.previewPrevBtn.disabled = this.previewRow <= 0;
		this.previewNextBtn.disabled = this.previewRow >= rowCount - 1;
		this.previewPosEl.setText(rowCount > 0 ? `Row ${this.previewRow + 1} of ${rowCount}` : "No rows");
		this.updateSourceHint();
		if (this.parsed) {
			let folder = "";
			try {
				folder = resolveTargetFolder(this.cfg, this.file.path);
			} catch {
				folder = "";
			}
			const cols = this.parsed.headers.length;
			const parts = [
				`${rowCount} ${rowCount === 1 ? "row" : "rows"}`,
				`${cols} ${cols === 1 ? "column" : "columns"}`,
				delimiterLabel(this.parsed.delimiter),
			];
			if (folder) parts.push(`notes go to ${folder}/`);
			this.statusEl.setText(parts.join(" · "));
		}
		if (this.parseError || !this.parsed) {
			this.previewEl.setText(this.parseError ? `Could not read this file as a table: ${this.parseError}` : "The file is empty.");
			return;
		}
		if (rowCount === 0) {
			this.previewEl.setText("The file has no data rows.");
			return;
		}
		try {
			// Plan the rows up to the selected one so duplicate names and {{row}} match the real import.
			const upTo: ParsedCsv = { ...this.parsed, rows: this.parsed.rows.slice(0, this.previewRow + 1) };
			const notes = planNotes(upTo, this.cfg, { path: this.file.path, basename: this.file.basename });
			const note = notes.find((n) => n.row === this.previewRow + 1);
			this.previewEl.setText(
				note ? `${note.path}\n\n${serializeNote(note.frontmatter, note.body, note.types)}` : "This row would be skipped because every cell is empty.",
			);
		} catch (e) {
			this.previewEl.setText(`Preview unavailable: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private async save(thenImport: boolean): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		try {
			if (this.cfg.conflict === "overwrite" && this.initialConflict !== "overwrite") {
				const ok = await confirmDialog(
					this.app,
					"Replace whole notes?",
					"Replace whole note overwrites notes completely. Properties and text you added in Obsidian are lost. You can undo right after the import.",
					"Replace notes",
					true,
				);
				if (!ok) return;
			}
			try {
				await this.host.saveFileConfig(this.file, this.cfg);
			} catch (e) {
				new Notice(`Could not save settings: ${e instanceof Error ? e.message : String(e)}`);
				return;
			}
			this.onSaved?.(this.cfg);
			this.close();
			if (thenImport) {
				try {
					await this.host.importFile(this.file, this.text);
				} catch (e) {
					new Notice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
				}
			}
		} finally {
			this.saving = false;
		}
	}
}
