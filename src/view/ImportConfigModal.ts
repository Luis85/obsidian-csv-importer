import { AbstractInputSuggest, App, Modal, Notice, Setting, TFile, TFolder, debounce } from "obsidian";
import type { CsvImporterHost } from "../host";
import type { ColumnConfig, ConflictStrategy, CsvEncoding, DelimiterOption, EmptyValueMode, FileImportConfig, FrontmatterValue, ParsedCsv, PropertyType } from "../types";
import { parseCsv } from "../csv/parser";
import { decodeCsv } from "../csv/encoding";
import { convertValue, inferColumnType, prepareConfig } from "../csv/typeInference";
import { applyValueTemplate, formatValue, planNotes, resolveTargetFolder, serializeNote } from "../import/noteBuilder";
import { LINK_TEMPLATE, TYPE_LABELS, conversionOptions, inferenceOptions } from "./shared";

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

const CONFLICT_DESCRIPTIONS: Record<ConflictStrategy, string> = {
	update: "Update the CSV's properties. Properties you added in Obsidian and the note body are kept.",
	skip: "Leave existing notes untouched.",
	rename: "Create a new note with a numeric suffix and keep the existing note as it is.",
	overwrite: "Replace the whole note. Properties added in Obsidian and the note body are lost.",
};

const ENCODING_LABELS: Record<CsvEncoding, string> = {
	auto: "Auto",
	"utf-8": "UTF-8",
	"utf-16le": "UTF-16 LE",
	"utf-16be": "UTF-16 BE",
	"windows-1252": "Windows-1252",
};

const KEY_DESC =
	"Re-imports update the note whose property matches this column, even if the note was renamed. Use a column with unique values, like an ID.";

function cloneConfig(cfg: FileImportConfig): FileImportConfig {
	return { ...cfg, columns: cfg.columns.map((c) => ({ ...c })) };
}

export class ImportConfigModal extends Modal {
	private cfg: FileImportConfig;
	private parsed: ParsedCsv | null = null;
	private parseError: string | null = null;

	private columnsEl!: HTMLElement;
	private chipsEl!: HTMLElement;
	private previewEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private nameInput: HTMLInputElement | HTMLTextAreaElement | null = null;
	private bodyInput: HTMLTextAreaElement | null = null;
	private lastTemplateField: "name" | "body" = "name";
	private folderInput: HTMLInputElement | null = null;
	private keySettingEl: Setting | null = null;
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
					this.updatePreview();
				}),
		);
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
		this.renderKeyDropdown();
		this.renderColumns();
		this.renderChips();
		this.updatePreview();
	}

	private build(): void {
		const el = this.contentEl;
		el.empty();
		el.addClass("csv-importer-config");

		this.statusEl = el.createDiv({ cls: "csv-importer-config-status" });

		// Parsing
		new Setting(el).setName("Parsing").setHeading();
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
			.setName("First row is a header")
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
		new Setting(el)
			.setName("Number precision")
			.setDesc("Decimal places for numbers, 0 to 10. Leave empty to keep the source precision.")
			.addText((t) => {
				t.setPlaceholder("Keep source");
				if (this.cfg.numberPrecision !== null) t.setValue(String(this.cfg.numberPrecision));
				t.onChange((v) => {
					const trimmed = v.trim();
					if (trimmed === "") {
						this.cfg.numberPrecision = null;
						t.inputEl.removeClass("csv-importer-invalid");
					} else if (/^\d+$/.test(trimmed) && Number(trimmed) <= 10) {
						this.cfg.numberPrecision = Number(trimmed);
						t.inputEl.removeClass("csv-importer-invalid");
					} else {
						t.inputEl.addClass("csv-importer-invalid");
						return;
					}
					this.renderColumns();
					this.updatePreview();
				});
			});
		this.keySettingEl = new Setting(el).setName("Key column").setDesc(KEY_DESC);
		this.renderKeyDropdown();

		// Output
		new Setting(el).setName("Output").setHeading();
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
			.setDesc("Use {{Column name}} for cell values, {{row}} for the row number and {{file}} for the CSV name.");
		nameSetting.addText((t) => {
			this.nameInput = t.inputEl;
			t.setValue(this.cfg.fileNameTemplate).onChange((v) => {
				this.cfg.fileNameTemplate = v;
				this.refreshPreview();
			});
			t.inputEl.addEventListener("focus", () => (this.lastTemplateField = "name"));
		});
		nameSetting.settingEl.addClass("csv-importer-wide-setting");

		this.chipsEl = el.createDiv({ cls: "csv-importer-chips" });
		this.renderChips();

		const bodySetting = new Setting(el)
			.setName("Body template")
			.setDesc("Text of each note. Supports the same placeholders. May be empty.");
		bodySetting.addTextArea((t) => {
			this.bodyInput = t.inputEl;
			t.inputEl.rows = 4;
			t.setValue(this.cfg.bodyTemplate).onChange((v) => {
				this.cfg.bodyTemplate = v;
				this.refreshPreview();
			});
			t.inputEl.addEventListener("focus", () => (this.lastTemplateField = "body"));
		});
		bodySetting.settingEl.addClass("csv-importer-wide-setting");

		new Setting(el)
			.setName("Tags")
			.setDesc("Comma separated tags added to every note.")
			.addText((t) =>
				t.setValue(this.cfg.tags).onChange((v) => {
					this.cfg.tags = v;
					this.refreshPreview();
				}),
			);
		new Setting(el)
			.setName("Add source link")
			.setDesc("Add a source property that links to the CSV file.")
			.addToggle((t) =>
				t.setValue(this.cfg.addSourceLink).onChange((v) => {
					this.cfg.addSourceLink = v;
					this.updatePreview();
				}),
			);
		new Setting(el)
			.setName("Create a base")
			.setDesc(
				"Create a .base file next to the target folder that shows the imported notes as a table. Existing base files are never changed.",
			)
			.addToggle((t) =>
				t.setValue(this.cfg.createBase).onChange((v) => {
					this.cfg.createBase = v;
				}),
			);

		const conflictSetting = new Setting(el).setName("Existing notes");
		const updateConflictDesc = () => conflictSetting.setDesc(CONFLICT_DESCRIPTIONS[this.cfg.conflict]);
		updateConflictDesc();
		conflictSetting.addDropdown((d) =>
			d
				.addOptions({
					update: "Update",
					skip: "Skip",
					rename: "Create a copy",
					overwrite: "Overwrite",
				})
				.setValue(this.cfg.conflict)
				.onChange((v) => {
					this.cfg.conflict = v as ConflictStrategy;
					updateConflictDesc();
					this.renderUpdateOptions();
				}),
		);
		this.updateOptionsEl = el.createDiv({ cls: "csv-importer-sub-settings" });
		this.renderUpdateOptions();

		// Columns
		const colHeading = new Setting(el).setName("Columns").setHeading();
		colHeading.addButton((b) =>
			b.setButtonText("Re-detect types").onClick(() => this.redetect()),
		);
		this.columnsEl = el.createDiv({ cls: "csv-importer-columns" });
		this.renderColumns();

		// Preview
		new Setting(el).setName("Preview of the first note").setHeading();
		this.previewEl = el.createEl("pre", { cls: "csv-importer-preview" });

		// Footer
		const footer = el.createDiv({ cls: "csv-importer-footer modal-button-container" });
		const save = footer.createEl("button", { cls: "mod-cta", text: "Save" });
		save.addEventListener("click", () => void this.save(false));
		const saveImport = footer.createEl("button", { text: "Save and import" });
		saveImport.addEventListener("click", () => void this.save(true));
		const cancel = footer.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
	}

	private updateFolderPlaceholder(): void {
		if (!this.folderInput) return;
		try {
			this.folderInput.placeholder = resolveTargetFolder({ ...this.cfg, targetFolder: "" }, this.file.path);
		} catch {
			this.folderInput.placeholder = "";
		}
	}

	private insertPlaceholder(token: string): void {
		const target = this.lastTemplateField === "body" && this.bodyInput ? this.bodyInput : this.nameInput;
		if (!target) return;
		const start = target.selectionStart ?? target.value.length;
		const end = target.selectionEnd ?? target.value.length;
		target.value = target.value.slice(0, start) + token + target.value.slice(end);
		const pos = start + token.length;
		target.focus();
		target.setSelectionRange(pos, pos);
		if (target === this.bodyInput) this.cfg.bodyTemplate = target.value;
		else this.cfg.fileNameTemplate = target.value;
		this.updatePreview();
	}

	private renderChips(): void {
		this.chipsEl.empty();
		this.chipsEl.createSpan({ cls: "csv-importer-chips-label", text: "Insert:" });
		const tokens = ["{{row}}", "{{file}}", ...(this.parsed ? this.parsed.headers.map((h) => `{{${h}}}`) : [])];
		for (const token of tokens) {
			const chip = this.chipsEl.createEl("button", { cls: "csv-importer-chip", text: token });
			chip.type = "button";
			chip.addEventListener("click", (ev) => {
				ev.preventDefault();
				this.insertPlaceholder(token);
			});
		}
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
			el.createDiv({ cls: "csv-importer-empty csv-importer-error", text: `Could not parse the file: ${this.parseError}` });
			return;
		}
		if (this.cfg.columns.length === 0) {
			el.createDiv({ cls: "csv-importer-empty", text: "No columns found." });
			return;
		}
		const scroller = el.createDiv({ cls: "csv-importer-scroll" });
		const table = scroller.createEl("table", { cls: "csv-importer-table csv-importer-columns-table" });
		const head = table.createEl("thead").createEl("tr");
		for (const h of ["Use", "Column", "Property name", "Type", "Value template", "Sample", "Converted"]) head.createEl("th", { text: h });
		const tbody = table.createEl("tbody");

		for (const col of this.cfg.columns) {
			const tr = tbody.createEl("tr");
			tr.toggleClass("is-excluded", !col.include);

			const useTd = tr.createEl("td");
			const cb = useTd.createEl("input", { type: "checkbox", attr: { "aria-label": `Include ${col.source}` } });
			cb.checked = col.include;
			cb.addEventListener("change", () => {
				col.include = cb.checked;
				tr.toggleClass("is-excluded", !col.include);
				this.updatePreview();
			});

			tr.createEl("td", { text: col.source, cls: "csv-importer-col-source" });

			const propTd = tr.createEl("td");
			const prop = propTd.createEl("input", { type: "text", cls: "csv-importer-prop-input", attr: { "aria-label": `Property name for ${col.source}` } });
			prop.value = col.property;
			prop.addEventListener("input", () => {
				col.property = prop.value;
				this.refreshPreview();
			});

			const typeTd = tr.createEl("td");
			const sel = typeTd.createEl("select", { cls: "dropdown", attr: { "aria-label": `Type of ${col.source}` } });
			for (const [value, label] of Object.entries(TYPE_LABELS)) sel.createEl("option", { value, text: label });
			sel.value = col.type;

			const tplTd = tr.createEl("td", { cls: "csv-importer-col-template" });
			const tpl = tplTd.createEl("input", {
				type: "text",
				cls: "csv-importer-prop-input",
				attr: { placeholder: "{{value}}", "aria-label": `Value template for ${col.source}` },
			});
			tpl.value = col.valueTemplate ?? "";
			const linkBtn = tplTd.createEl("button", {
				cls: "csv-importer-chip",
				text: "Link",
				attr: { type: "button", title: "Turn values into links: [[{{value}}]]" },
			});

			const sample = this.firstSample(col);
			tr.createEl("td", { text: sample, cls: "csv-importer-col-sample", attr: { title: sample } });
			const convTd = tr.createEl("td", { cls: "csv-importer-col-converted" });
			const showConv = () => {
				const out = this.previewColumnValue(col);
				convTd.setText(sample === "" ? "" : `→ ${out}`);
				convTd.setAttr("title", out);
			};
			showConv();

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

	private updatePreview(): void {
		if (!this.previewEl) return;
		this.statusEl.empty();
		if (this.parsed) {
			this.statusEl.setText(
				`${this.parsed.rows.length} ${this.parsed.rows.length === 1 ? "row" : "rows"} · ${this.parsed.headers.length} columns`,
			);
		}
		if (this.parseError || !this.parsed) {
			this.previewEl.setText(this.parseError ? `Could not parse the file: ${this.parseError}` : "The file is empty.");
			return;
		}
		if (this.parsed.rows.length === 0) {
			this.previewEl.setText("The file has no data rows.");
			return;
		}
		try {
			const first: ParsedCsv = { ...this.parsed, rows: this.parsed.rows.slice(0, 1) };
			const notes = planNotes(first, this.cfg, { path: this.file.path, basename: this.file.basename });
			const note = notes[0];
			this.previewEl.setText(note ? `${note.path}\n\n${serializeNote(note.frontmatter, note.body, note.types)}` : "No notes would be created.");
		} catch (e) {
			this.previewEl.setText(`Preview unavailable: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private async save(thenImport: boolean): Promise<void> {
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
	}
}
