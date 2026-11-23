import { App, Notice, PluginSettingTab, Setting, requireApiVersion } from "obsidian";
import type { Plugin, SettingDefinitionItem } from "obsidian";
import { confirmDialog } from "./view/ConfirmModal";
import type { ConflictStrategy, CsvEncoding, DelimiterOption, EmptyValueMode, PluginSettings } from "./types";
import {
	CONFLICT_OPTIONS,
	DECIMAL_OPTIONS,
	DELIMITER_OPTIONS,
	EMPTY_VALUE_OPTIONS,
	ENCODING_LABELS,
	NAME,
	PAGE_SIZE_ERROR,
	SETTINGS_DESC,
} from "./view/labels";

export { DEFAULT_SETTINGS, createDefaultFileConfig } from "./defaults";

/** What the setting tab needs from the plugin. */
export interface SettingsHost {
	settings: PluginSettings;
	saveSettings(): Promise<void>;
	forgetAllFileConfigs(): Promise<void>;
}

export class CsvImporterSettingTab extends PluginSettingTab {
	/**
	 * `plugin` is only passed to PluginSettingTab. Settings are read through `host` (typed as SettingsHost, not
	 * Plugin) so the code never touches Plugin.settings, which only exists in Obsidian 1.13+.
	 */
	constructor(
		app: App,
		plugin: Plugin,
		private readonly host: SettingsHost,
	) {
		super(app, plugin);
	}

	/**
	 * Declarative settings (Obsidian 1.13+): they appear in the settings search. Older versions never call this
	 * and render `display()` instead; the version guard keeps the two paths from mixing.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		if (!requireApiVersion("1.13.0")) return [];
		const group = (heading: string, items: SettingDefinitionItem[]): SettingDefinitionItem => ({
			type: "group",
			heading,
			items: items as never,
		});
		const toggle = (key: keyof PluginSettings, name: string, desc?: string): SettingDefinitionItem => ({
			name,
			desc,
			control: { type: "toggle", key },
		});
		const dropdown = (key: keyof PluginSettings, name: string, options: Record<string, string>, desc?: string): SettingDefinitionItem => ({
			name,
			desc,
			control: { type: "dropdown", key, options },
		});
		const text = (key: keyof PluginSettings, name: string, desc: string, placeholder?: string): SettingDefinitionItem => ({
			name,
			desc,
			control: { type: "text", key, placeholder },
		});
		return [
			{ name: "", desc: SETTINGS_DESC.intro, searchable: false },
			group("Reading CSV files", [
				dropdown("defaultEncoding", NAME.encoding, ENCODING_LABELS, SETTINGS_DESC.encoding),
				dropdown("defaultDelimiter", NAME.delimiter, DELIMITER_OPTIONS, SETTINGS_DESC.delimiter),
				toggle("defaultHasHeader", NAME.hasHeader),
				dropdown("defaultDecimalSeparator", NAME.decimal, DECIMAL_OPTIONS, SETTINGS_DESC.decimal),
				text("defaultListSeparator", NAME.listSeparator, SETTINGS_DESC.listSeparator),
				dropdown("defaultEmptyValues", NAME.emptyCells, EMPTY_VALUE_OPTIONS, SETTINGS_DESC.emptyCells),
				toggle("midnightAsDate", "Treat midnight timestamps as dates", SETTINGS_DESC.midnight),
			]),
			group("Creating notes", [
				text("defaultTargetFolder", NAME.targetFolder, SETTINGS_DESC.targetFolder, "Example: Imports/data"),
				text("defaultFileNameTemplate", NAME.fileName, SETTINGS_DESC.fileName),
				{ name: NAME.body, desc: SETTINGS_DESC.body, control: { type: "textarea", key: "defaultBodyTemplate" } },
				text("defaultTags", NAME.tags, SETTINGS_DESC.tags),
				toggle("defaultAddSourceLink", "Add link to the CSV file", SETTINGS_DESC.sourceLink),
				toggle("defaultCreateBase", NAME.createBase, SETTINGS_DESC.createBase),
			]),
			group("Existing notes", [
				dropdown("defaultConflict", NAME.conflict, CONFLICT_OPTIONS, SETTINGS_DESC.conflict),
				toggle("defaultProtectEdits", NAME.protectEdits, SETTINGS_DESC.protectEdits),
				toggle("defaultKeepValuesOnEmpty", NAME.keepOnEmpty, SETTINGS_DESC.keepOnEmpty),
			]),
			group("Table view", [
				{
					name: "Rows shown per page",
					desc: SETTINGS_DESC.pageSize,
					control: {
						type: "number",
						key: "pageSize",
						min: 10,
						max: 100000,
						validate: (v: number) => (Number.isInteger(v) && v >= 10 && v <= 100000 ? undefined : PAGE_SIZE_ERROR),
					},
				},
			]),
			group("Data", [
				{
					name: "Reset all import settings",
					desc: SETTINGS_DESC.reset,
					action: () => this.confirmReset(),
				},
			]),
		];
	}

	getControlValue(key: string): unknown {
		return (this.host.settings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.host.settings as unknown as Record<string, unknown>)[key] = value;
		await this.host.saveSettings();
	}

	private confirmReset(): void {
		void confirmDialog(
			this.app,
			"Reset all import settings?",
			"This removes the saved import settings of all CSV files. This cannot be undone.",
			"Reset all",
			true,
		).then((ok) => {
			if (!ok) return;
			void this.host.forgetAllFileConfigs().then(() => new Notice("Import settings reset."));
		});
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setDesc(SETTINGS_DESC.intro);

		const s = this.host.settings;
		const save = (): void => {
			void this.host.saveSettings();
		};
		new Setting(containerEl).setName("Reading CSV files").setHeading();
		this.readingSection(containerEl, s, save);
		new Setting(containerEl).setName("Creating notes").setHeading();
		this.creatingSection(containerEl, s, save);
		new Setting(containerEl).setName("Existing notes").setHeading();
		this.existingSection(containerEl, s, save);
		new Setting(containerEl).setName("Table view").setHeading();
		this.tableViewSection(containerEl, s, save);
		new Setting(containerEl).setName("Data").setHeading();
		this.dataSection(containerEl);
	}

	private readingSection(el: HTMLElement, s: PluginSettings, save: () => void): void {
		new Setting(el)
			.setName(NAME.encoding)
			.setDesc(SETTINGS_DESC.encoding)
			.addDropdown((d) =>
				d
					.addOptions(ENCODING_LABELS)
					.setValue(s.defaultEncoding)
					.onChange((v) => {
						s.defaultEncoding = v as CsvEncoding;
						save();
					}),
			);

		new Setting(el)
			.setName(NAME.delimiter)
			.setDesc(SETTINGS_DESC.delimiter)
			.addDropdown((d) =>
				d
					.addOptions(DELIMITER_OPTIONS)
					.setValue(s.defaultDelimiter)
					.onChange((v) => {
						s.defaultDelimiter = v as DelimiterOption;
						save();
					}),
			);

		new Setting(el)
			.setName(NAME.hasHeader)
			.addToggle((t) =>
				t.setValue(s.defaultHasHeader).onChange((v) => {
					s.defaultHasHeader = v;
					save();
				}),
			);

		new Setting(el)
			.setName(NAME.decimal)
			.setDesc(SETTINGS_DESC.decimal)
			.addDropdown((d) =>
				d
					.addOptions(DECIMAL_OPTIONS)
					.setValue(s.defaultDecimalSeparator)
					.onChange((v) => {
						s.defaultDecimalSeparator = v as "." | ",";
						save();
					}),
			);

		new Setting(el)
			.setName(NAME.listSeparator)
			.setDesc(SETTINGS_DESC.listSeparator)
			.addText((t) =>
				t.setValue(s.defaultListSeparator).onChange((v) => {
					s.defaultListSeparator = v;
					save();
				}),
			);

		new Setting(el)
			.setName(NAME.emptyCells)
			.setDesc(SETTINGS_DESC.emptyCells)
			.addDropdown((d) =>
				d
					.addOptions(EMPTY_VALUE_OPTIONS)
					.setValue(s.defaultEmptyValues)
					.onChange((v) => {
						s.defaultEmptyValues = v as EmptyValueMode;
						save();
					}),
			);

		new Setting(el)
			.setName("Treat midnight timestamps as dates")
			.setDesc(SETTINGS_DESC.midnight)
			.addToggle((t) =>
				t.setValue(s.midnightAsDate).onChange((v) => {
					s.midnightAsDate = v;
					save();
				}),
			);
	}

	private creatingSection(el: HTMLElement, s: PluginSettings, save: () => void): void {
		new Setting(el)
			.setName(NAME.targetFolder)
			.setDesc(SETTINGS_DESC.targetFolder)
			.addText((t) =>
				t
					.setPlaceholder("Example: Imports/data")
					.setValue(s.defaultTargetFolder)
					.onChange((v) => {
						s.defaultTargetFolder = v.trim();
						save();
					}),
			);

		new Setting(el)
			.setName(NAME.fileName)
			.setDesc(SETTINGS_DESC.fileName)
			.addText((t) =>
				t.setValue(s.defaultFileNameTemplate).onChange((v) => {
					s.defaultFileNameTemplate = v;
					save();
				}),
			);

		new Setting(el)
			.setName(NAME.body)
			.setDesc(SETTINGS_DESC.body)
			.addTextArea((t) =>
				t.setValue(s.defaultBodyTemplate).onChange((v) => {
					s.defaultBodyTemplate = v;
					save();
				}),
			);

		new Setting(el)
			.setName(NAME.tags)
			.setDesc(SETTINGS_DESC.tags)
			.addText((t) =>
				t.setValue(s.defaultTags).onChange((v) => {
					s.defaultTags = v;
					save();
				}),
			);

		new Setting(el)
			.setName("Add link to the CSV file")
			.setDesc(SETTINGS_DESC.sourceLink)
			.addToggle((t) =>
				t.setValue(s.defaultAddSourceLink).onChange((v) => {
					s.defaultAddSourceLink = v;
					save();
				}),
			);

		new Setting(el)
			.setName(NAME.createBase)
			.setDesc(SETTINGS_DESC.createBase)
			.addToggle((t) =>
				t.setValue(s.defaultCreateBase).onChange((v) => {
					s.defaultCreateBase = v;
					save();
				}),
			);
	}

	private existingSection(el: HTMLElement, s: PluginSettings, save: () => void): void {
		new Setting(el)
			.setName(NAME.conflict)
			.setDesc(SETTINGS_DESC.conflict)
			.addDropdown((d) =>
				d
					.addOptions(CONFLICT_OPTIONS)
					.setValue(s.defaultConflict)
					.onChange((v) => {
						s.defaultConflict = v as ConflictStrategy;
						save();
					}),
			);

		new Setting(el)
			.setName(NAME.protectEdits)
			.setDesc(SETTINGS_DESC.protectEdits)
			.addToggle((t) =>
				t.setValue(s.defaultProtectEdits).onChange((v) => {
					s.defaultProtectEdits = v;
					save();
				}),
			);

		new Setting(el)
			.setName(NAME.keepOnEmpty)
			.setDesc(SETTINGS_DESC.keepOnEmpty)
			.addToggle((t) =>
				t.setValue(s.defaultKeepValuesOnEmpty).onChange((v) => {
					s.defaultKeepValuesOnEmpty = v;
					save();
				}),
			);
	}

	private tableViewSection(el: HTMLElement, s: PluginSettings, save: () => void): void {
		const pageSetting = new Setting(el).setName("Rows shown per page").setDesc(SETTINGS_DESC.pageSize);
		const pageError = pageSetting.descEl.createDiv({ cls: "csv-importer-field-error" });
		pageError.hide();
		pageSetting.addText((t) =>
			t.setValue(String(s.pageSize)).onChange((v) => {
				const n = Math.floor(Number(v));
				if (Number.isFinite(n) && n >= 10 && n <= 100000) {
					s.pageSize = n;
					t.inputEl.removeClass("csv-importer-invalid");
					pageError.hide();
					save();
				} else {
					t.inputEl.addClass("csv-importer-invalid");
					pageError.setText(PAGE_SIZE_ERROR);
					pageError.show();
				}
			}),
		);
	}

	private dataSection(el: HTMLElement): void {
		new Setting(el)
			.setName("Reset all import settings")
			.setDesc(SETTINGS_DESC.reset)
			.addButton((b) => {
				b.setButtonText("Reset all").onClick(() => this.confirmReset());
				b.buttonEl.addClass("mod-warning");
			});
	}
}
