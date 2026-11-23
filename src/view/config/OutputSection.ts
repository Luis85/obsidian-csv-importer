import { Setting } from "obsidian";
import type { App } from "obsidian";
import type { ConflictStrategy } from "../../types";
import { CONFIG_DESC, CONFLICT_DESCRIPTIONS, CONFLICT_OPTIONS, MATCH_NOTES_BY, NAME, suggestedKey } from "../labels";
import { safeTargetFolder } from "../dom";
import { FILE_NAME_DESC, KEY_PROPERTY, UNIQUE_IN_EVERY_ROW, keyExample } from "./copy";
import { isUniqueColumn, suggestShortKey } from "./keys";
import { insertAtCursor, placeholderTokens, renderChipRow } from "./chips";
import type { ConfigDraft } from "./ConfigDraft";
import { FolderSuggest } from "./FolderSuggest";

/** The "Notes" tab (target folder, file name) and the "Re-import" tab (conflict handling, match columns). */
export class OutputSection {
	private nameChipsEl!: HTMLElement;
	private nameInput: HTMLInputElement | null = null;
	private folderInput: HTMLInputElement | null = null;
	private keySettingEl: Setting | null = null;
	private keyHintEl: HTMLElement | null = null;
	private keyListEl: HTMLElement | null = null;
	private keyPropertyEl: HTMLElement | null = null;
	private updateOptionsEl: HTMLElement | null = null;

	constructor(
		private readonly app: App,
		private readonly draft: ConfigDraft,
	) {}

	buildNotes(el: HTMLElement): void {
		const { cfg } = this.draft;
		const folderSetting = new Setting(el).setName(NAME.targetFolder).setDesc(CONFIG_DESC.targetFolder);
		folderSetting.addText((t) => {
			this.folderInput = t.inputEl;
			t.setValue(cfg.targetFolder).onChange((v) => {
				cfg.targetFolder = v;
				this.draft.emit("preview");
			});
			this.updateFolderPlaceholder();
			new FolderSuggest(this.app, t.inputEl, (path) => {
				cfg.targetFolder = path;
				this.draft.emit("preview");
			});
		});

		const nameSetting = new Setting(el).setName(NAME.fileName).setDesc(FILE_NAME_DESC);
		nameSetting.addText((t) => {
			this.nameInput = t.inputEl;
			t.setValue(cfg.fileNameTemplate).onChange((v) => {
				cfg.fileNameTemplate = v;
				this.draft.emitPreviewDebounced();
			});
		});
		nameSetting.settingEl.addClass("csv-importer-wide-setting");
		this.nameChipsEl = el.createDiv({ cls: "csv-importer-chips" });
		this.draft.on("parsing", () => this.renderChips());
		this.draft.on("columns", () => this.updateFolderPlaceholder());
		this.renderChips();
	}

	buildReimport(el: HTMLElement): void {
		const { cfg } = this.draft;
		const conflictSetting = new Setting(el).setName(NAME.conflict);
		const updateConflictDesc = (): void => {
			conflictSetting.setDesc(CONFLICT_DESCRIPTIONS[cfg.conflict]);
			conflictSetting.descEl.toggleClass("csv-importer-warning-text", cfg.conflict === "overwrite");
		};
		updateConflictDesc();
		conflictSetting.addDropdown((d) =>
			d
				.addOptions(CONFLICT_OPTIONS)
				.setValue(cfg.conflict)
				.onChange((v) => {
					cfg.conflict = v as ConflictStrategy;
					updateConflictDesc();
					this.renderUpdateOptions();
				}),
		);
		this.updateOptionsEl = el.createDiv({ cls: "csv-importer-sub-settings" });
		this.renderUpdateOptions();

		this.keySettingEl = new Setting(el).setName(MATCH_NOTES_BY).setDesc(CONFIG_DESC.key);
		this.keyHintEl = this.keySettingEl.descEl.createDiv({ cls: "csv-importer-key-hint" });
		this.keyListEl = el.createDiv({ cls: "csv-importer-key-list", attr: { role: "group", "aria-label": MATCH_NOTES_BY } });
		this.keyPropertyEl = el.createDiv({ cls: "csv-importer-sub-settings" });
		this.renderKeyList();
		this.draft.on("parsing", () => this.renderKeyList());
	}

	private updateFolderPlaceholder(): void {
		if (!this.folderInput) return;
		this.folderInput.placeholder = safeTargetFolder({ ...this.draft.cfg, targetFolder: "" }, this.draft.file.path);
	}

	private renderChips(): void {
		renderChipRow(this.nameChipsEl, "Insert into file name:", placeholderTokens(this.draft.parsed?.headers), (token) => {
			if (!this.nameInput) return;
			this.draft.cfg.fileNameTemplate = insertAtCursor(this.nameInput, token);
			this.draft.emit("preview");
		});
	}

	private renderUpdateOptions(): void {
		const box = this.updateOptionsEl;
		const cfg = this.draft.cfg;
		if (!box) return;
		box.empty();
		if (cfg.conflict !== "update") return;
		new Setting(box)
			.setName(NAME.protectEdits)
			.setDesc(CONFIG_DESC.protectEdits)
			.addToggle((t) =>
				t.setValue(cfg.protectEdits).onChange((v) => {
					cfg.protectEdits = v;
				}),
			);
		new Setting(box)
			.setName(NAME.keepOnEmpty)
			.setDesc(CONFIG_DESC.keepOnEmpty)
			.addToggle((t) =>
				t.setValue(cfg.keepValuesOnEmpty).onChange((v) => {
					cfg.keepValuesOnEmpty = v;
				}),
			);
	}

	/** Key columns in use: the composite list, or the single key column. */
	private keys(): string[] {
		const cfg = this.draft.cfg;
		return cfg.keyColumns.length > 0 ? cfg.keyColumns : cfg.keyColumn ? [cfg.keyColumn] : [];
	}

	/** Store the key columns; keyColumn stays the first one for compatibility. */
	private setKeys(list: string[]): void {
		const cfg = this.draft.cfg;
		const unique = [...new Set(list)];
		cfg.keyColumns = unique.length >= 2 ? unique : [];
		cfg.keyColumn = unique[0] ?? "";
	}

	private toggleKey(name: string, on: boolean): void {
		const rest = this.keys().filter((k) => k !== name);
		this.setKeys(on ? [...rest, name] : rest);
		this.renderKeyList();
		this.draft.emit("preview");
	}

	/** Checkbox list of the columns, the key property field (2 or more columns) and the suggestion. */
	private renderKeyList(): void {
		const { cfg, parsed } = this.draft;
		const list = this.keyListEl;
		if (!list) return;
		list.empty();
		const sources = new Set(cfg.columns.map((c) => c.source));
		this.setKeys(this.keys().filter((k) => sources.has(k)));
		const keys = this.keys();
		for (const c of cfg.columns) {
			const label = list.createEl("label", { cls: "csv-importer-key-option" });
			const cb = label.createEl("input", { type: "checkbox" });
			cb.checked = keys.includes(c.source);
			cb.addEventListener("change", () => this.toggleKey(c.source, cb.checked));
			label.createSpan({ cls: "csv-importer-key-name", text: c.source });
			if (parsed && isUniqueColumn(parsed, c)) label.createSpan({ cls: "csv-importer-key-meta", text: UNIQUE_IN_EVERY_ROW });
		}
		const propBox = this.keyPropertyEl;
		if (propBox) {
			propBox.empty();
			if (keys.length >= 2) {
				const example = parsed?.rows[0] ? keyExample(keys.map((k) => (parsed.rows[0][cfg.columns.find((c) => c.source === k)?.index ?? -1] ?? "").trim())) : "";
				new Setting(propBox)
					.setName(KEY_PROPERTY)
					.setDesc(`The values are joined with " | " and stored in this property. ${example}`.trim())
					.addText((t) =>
						t.setPlaceholder("import_key").setValue(cfg.keyProperty).onChange((v) => {
							cfg.keyProperty = v.trim() === "" ? "import_key" : v.trim();
							this.draft.emitPreviewDebounced();
						}),
					);
			}
		}
		this.renderKeyHint();
	}

	private renderKeyHint(): void {
		const hint = this.keyHintEl;
		const { cfg, parsed } = this.draft;
		if (!hint) return;
		hint.empty();
		if (this.keys().length > 0 || !parsed) return;
		let suggestion: string | null = null;
		try {
			suggestion = suggestShortKey(parsed, cfg.columns);
		} catch {
			suggestion = null;
		}
		if (!suggestion) return;
		const name = suggestion;
		hint.createSpan({ text: suggestedKey(name) });
		const btn = hint.createEl("button", { cls: "csv-importer-chip", text: `Use ${name}`, attr: { type: "button" } });
		btn.addEventListener("click", () => {
			this.setKeys([name]);
			this.renderKeyList();
			this.draft.emit("preview");
		});
	}
}
