import { Setting } from "obsidian";
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

	private renderKeyDropdown(): void {
		const setting = this.keySettingEl;
		const cfg = this.draft.cfg;
		if (!setting) return;
		setting.controlEl.empty();
		const options: Record<string, string> = { "": "None" };
		for (const c of cfg.columns) options[c.source] = c.source;
		if (cfg.keyColumn && !(cfg.keyColumn in options)) cfg.keyColumn = "";
		setting.addDropdown((d) =>
			d
				.addOptions(options)
				.setValue(cfg.keyColumn)
				.onChange((v) => {
					cfg.keyColumn = v;
					this.renderKeyHint();
					this.draft.emit("preview");
				}),
		);
		this.renderKeyHint();
	}

	private renderKeyHint(): void {
		const hint = this.keyHintEl;
		const { cfg, parsed } = this.draft;
		if (!hint) return;
		hint.empty();
		if (cfg.keyColumn || !parsed) return;
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
			cfg.keyColumn = name;
			this.renderKeyDropdown();
			this.draft.emit("preview");
		});
	}
}
