import { Menu, Setting, setIcon } from "obsidian";
import type { App } from "obsidian";
import type { ConflictStrategy } from "../../types";
import { suggestKeyColumn } from "../../csv/typeInference";
import { CONFIG_DESC, CONFLICT_DESCRIPTIONS, CONFLICT_OPTIONS, NAME } from "../labels";
import { safeTargetFolder, sectionHeading } from "../dom";
import { insertAtCursor, placeholderTokens, renderChipRow } from "./chips";
import type { ConfigDraft } from "./ConfigDraft";
import { FolderSuggest } from "./FolderSuggest";

/** The "Output" section: target folder, file name template, conflict handling and the match column. */
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

	build(el: HTMLElement): void {
		const { cfg } = this.draft;
		sectionHeading(el, "Output");
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

		const nameSetting = new Setting(el).setName(NAME.fileName).setDesc(CONFIG_DESC.fileName);
		nameSetting.addText((t) => {
			this.nameInput = t.inputEl;
			t.setValue(cfg.fileNameTemplate).onChange((v) => {
				cfg.fileNameTemplate = v;
				this.draft.emitPreviewDebounced();
			});
		});
		nameSetting.settingEl.addClass("csv-importer-wide-setting");
		this.nameChipsEl = el.createDiv({ cls: "csv-importer-chips" });

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

		this.keySettingEl = new Setting(el).setName("Match notes by column").setDesc(CONFIG_DESC.key);
		this.keyHintEl = this.keySettingEl.descEl.createDiv({ cls: "csv-importer-key-hint" });
		this.keyListEl = el.createDiv({ cls: "csv-importer-key-list" });
		this.keyPropertyEl = el.createDiv({ cls: "csv-importer-sub-settings" });
		this.renderKeyDropdown();

		this.draft.on("parsing", () => {
			this.renderKeyDropdown();
			this.renderChips();
		});
		this.draft.on("columns", () => this.updateFolderPlaceholder());
		this.renderChips();
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

	private renderKeyDropdown(): void {
		const setting = this.keySettingEl;
		const cfg = this.draft.cfg;
		if (!setting) return;
		setting.controlEl.empty();
		const sources = new Set(cfg.columns.map((c) => c.source));
		this.setKeys(this.keys().filter((k) => sources.has(k)));
		const keys = this.keys();
		const options: Record<string, string> = { "": "None" };
		for (const c of cfg.columns) options[c.source] = c.source;
		setting.addDropdown((d) =>
			d
				.addOptions(options)
				.setValue(keys[0] ?? "")
				.onChange((v) => {
					const rest = this.keys().slice(1).filter((k) => k !== v);
					this.setKeys(v === "" ? [] : [v, ...rest]);
					this.renderKeyDetails();
					this.draft.emit("preview");
				}),
		);
		setting.addButton((b) => {
			b.setButtonText("Add column").onClick((evt) => {
				const used = new Set(this.keys());
				const menu = new Menu();
				for (const c of cfg.columns) {
					if (used.has(c.source)) continue;
					menu.addItem((item) =>
						item.setTitle(c.source).onClick(() => {
							this.setKeys([...this.keys(), c.source]);
							this.renderKeyDropdown();
							this.draft.emit("preview");
						}),
					);
				}
				menu.showAtMouseEvent(evt);
			});
			b.buttonEl.setAttr("aria-label", "Add another column to the key");
			b.buttonEl.toggleClass("csv-importer-hidden", keys.length === 0 || keys.length >= cfg.columns.length);
		});
		this.renderKeyDetails();
	}

	/** Chips for the extra key columns, the key property field and the hint. */
	private renderKeyDetails(): void {
		const cfg = this.draft.cfg;
		const keys = this.keys();
		const list = this.keyListEl;
		const propBox = this.keyPropertyEl;
		if (list) {
			list.empty();
			for (const k of keys.slice(1)) {
				const chip = list.createSpan({ cls: "csv-importer-chip csv-importer-key-chip" });
				chip.createSpan({ text: k });
				const rm = chip.createEl("button", { cls: "csv-importer-chip-remove", attr: { type: "button", "aria-label": `Remove ${k} from the key` } });
				setIcon(rm, "x");
				rm.addEventListener("click", () => {
					this.setKeys(this.keys().filter((x) => x !== k));
					this.renderKeyDropdown();
					this.draft.emit("preview");
				});
			}
		}
		if (propBox) {
			propBox.empty();
			if (keys.length >= 2) {
				new Setting(propBox)
					.setName("Key property")
					.setDesc('The values are joined with " | " and stored in this property.')
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
			suggestion = suggestKeyColumn(parsed, cfg.columns);
		} catch {
			suggestion = null;
		}
		if (!suggestion) return;
		const name = suggestion;
		hint.createSpan({ text: `Suggested: ${name}` });
		const btn = hint.createEl("button", { cls: "csv-importer-chip", text: `Use ${name}`, attr: { type: "button" } });
		btn.addEventListener("click", () => {
			this.setKeys([name]);
			this.renderKeyDropdown();
			this.draft.emit("preview");
		});
	}
}
