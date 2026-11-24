import { Setting } from "obsidian";
import type { App } from "obsidian";
import type { ConflictStrategy } from "../../types";
import { CONFIG_DESC, CONFLICT_DESCRIPTIONS, CONFLICT_OPTIONS, MATCH_NOTES_BY, NAME, suggestedKey } from "../labels";
import { safeTargetFolder } from "../dom";
import { FILE_NAME_DESC, KEY_HAS_DUPLICATES, KEY_HAS_EMPTY, KEY_PROPERTY, KEY_SUGGESTED, keyExample, useKey } from "./copy";
import { keyColumnStatus, suggestShortKey } from "./keys";
import { insertAtCursor, placeholderTokens, renderChipRow } from "./chips";
import type { ConfigDraft } from "./ConfigDraft";
import { FolderSuggest } from "./FolderSuggest";
import { planNotes } from "../../import/noteBuilder";

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

	/** "Match notes by" first: it is what makes a re-import safe. Then what happens to existing notes. */
	buildReimport(el: HTMLElement): void {
		const { cfg } = this.draft;
		this.keySettingEl = new Setting(el).setName(MATCH_NOTES_BY).setDesc(CONFIG_DESC.key);
		this.keySettingEl.settingEl.addClass("csv-importer-key-setting");
		this.keyHintEl = el.createDiv({ cls: "csv-importer-key-hint" });
		this.keyListEl = el.createDiv({ cls: "csv-importer-key-list", attr: { role: "group", "aria-label": MATCH_NOTES_BY, "data-testid": "config-key-list" } });
		this.keyPropertyEl = el.createDiv({ cls: "csv-importer-sub-settings" });
		this.renderKeyList();
		this.draft.on("parsing", () => this.renderKeyList());

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
		const suggestion = keys.length === 0 ? this.suggestion() : null;
		for (const c of cfg.columns) {
			const label = list.createEl("label", { cls: "csv-importer-key-option" });
			const cb = label.createEl("input", { type: "checkbox" });
			cb.checked = keys.includes(c.source);
			cb.addEventListener("change", () => this.toggleKey(c.source, cb.checked));
			label.createSpan({ cls: "csv-importer-key-name", text: c.source, attr: { title: c.source } });
			// Only what helps the choice: the suggested column, and columns that cannot identify a row on their own.
			const status = parsed ? keyColumnStatus(parsed, c) : "unique";
			if (c.source === suggestion) label.createSpan({ cls: "csv-importer-key-meta", text: KEY_SUGGESTED });
			else if (status === "duplicates") label.createSpan({ cls: "csv-importer-key-meta mod-warning", text: KEY_HAS_DUPLICATES });
			else if (status === "empty") label.createSpan({ cls: "csv-importer-key-meta mod-warning", text: KEY_HAS_EMPTY });
		}
		const propBox = this.keyPropertyEl;
		if (propBox) {
			propBox.empty();
			if (keys.length >= 2) {
				const example = this.keyExampleText();
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
		this.renderKeyHint(suggestion);
	}

	/** The suggested key column, or null. Never a long free-text column (see `suggestShortKey`). */
	private suggestion(): string | null {
		const { cfg, parsed } = this.draft;
		if (!parsed) return null;
		try {
			return suggestShortKey(parsed, cfg.columns);
		} catch {
			return null;
		}
	}

	/** "Suggested: ID (unique in every row) [Use ID]" while no key is set and a good column exists. */
	private renderKeyHint(suggestion: string | null): void {
		const hint = this.keyHintEl;
		if (!hint) return;
		hint.empty();
		if (!suggestion) return;
		const name = suggestion;
		hint.createSpan({ text: suggestedKey(name) });
		const btn = hint.createEl("button", { cls: "csv-importer-use-key", text: useKey(name), attr: { type: "button", "data-testid": "config-use-key" } });
		btn.addEventListener("click", () => {
			this.setKeys([name]);
			this.renderKeyList();
			this.draft.emit("preview");
		});
	}

	/** "Example: …" with the key value exactly as the first row would store it (typed and formatted). */
	private keyExampleText(): string {
		const parsed = this.draft.parsed;
		if (!parsed || parsed.rows.length === 0) return "";
		try {
			const first = planNotes(
				{ ...parsed, rows: parsed.rows.slice(0, 1), rowNumbers: parsed.rowNumbers.slice(0, 1) },
				this.draft.cfg,
				{ path: this.draft.file.path, basename: this.draft.file.basename },
			)[0];
			return first?.key ? keyExample([first.key.value]) : "";
		} catch {
			return "";
		}
	}
}
