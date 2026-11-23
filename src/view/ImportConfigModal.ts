import { AbstractInputSuggest, App, Modal, Notice, Setting, TFile, TFolder, debounce } from "obsidian";
import type { CsvImporterHost } from "../host";
import type { ColumnConfig, ConflictStrategy, DelimiterOption, FileImportConfig, ParsedCsv, PropertyType } from "../types";
import { parseCsv } from "../csv/parser";
import { convertValue, inferColumnType, prepareConfig } from "../csv/typeInference";
import { planNotes, resolveTargetFolder, serializeNote } from "../import/noteBuilder";
import { TYPE_LABELS, conversionOptions, inferenceOptions } from "./shared";

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
	skip: "Leave existing notes untouched.",
	overwrite: "Replace the whole note, including its body.",
	update: "Merge imported properties into the existing properties and keep the body.",
	rename: "Create a new note with a numeric suffix.",
};

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

	private onParsingChanged(): void {
		this.reparse();
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

		// Output
		new Setting(el).setName("Output").setHeading();
		const folderSetting = new Setting(el)
			.setName("Target folder")
			.setDesc("Leave empty to use the default folder shown as placeholder.");
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
		const conflictSetting = new Setting(el).setName("If a note already exists");
		const updateConflictDesc = () => conflictSetting.setDesc(CONFLICT_DESCRIPTIONS[this.cfg.conflict]);
		updateConflictDesc();
		conflictSetting.addDropdown((d) =>
			d
				.addOptions({
					skip: "Skip",
					overwrite: "Overwrite",
					update: "Update properties",
					rename: "Create new with suffix",
				})
				.setValue(this.cfg.conflict)
				.onChange((v) => {
					this.cfg.conflict = v as ConflictStrategy;
					updateConflictDesc();
				}),
		);

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

	private formatConverted(raw: string, type: PropertyType): string {
		if (raw === "") return "";
		let v: ReturnType<typeof convertValue>;
		try {
			v = convertValue(raw, type, conversionOptions(this.cfg));
		} catch {
			v = null;
		}
		if (v === null || v === undefined) return "(empty)";
		return Array.isArray(v) ? JSON.stringify(v) : String(v);
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
		for (const h of ["Use", "Column", "Property name", "Type", "Sample", "Converted"]) head.createEl("th", { text: h });
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

			const sample = this.firstSample(col);
			tr.createEl("td", { text: sample, cls: "csv-importer-col-sample", attr: { title: sample } });
			const convTd = tr.createEl("td", { cls: "csv-importer-col-converted" });
			const showConv = () => {
				const out = this.formatConverted(sample, col.type);
				convTd.setText(sample === "" ? "" : `→ ${out}`);
				convTd.setAttr("title", out);
			};
			showConv();

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
			this.previewEl.setText(note ? `${note.path}\n\n${serializeNote(note.frontmatter, note.body)}` : "No notes would be created.");
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
