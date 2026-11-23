import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type { Plugin } from "obsidian";
import { confirmDialog } from "./view/ConfirmModal";
import type { ConflictStrategy, CsvEncoding, DelimiterOption, EmptyValueMode, PluginSettings } from "./types";
import {
	CONFLICT_OPTIONS,
	DECIMAL_OPTIONS_SETTINGS,
	DELIMITER_OPTIONS_SETTINGS,
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
	constructor(
		app: App,
		private readonly host: Plugin & SettingsHost,
	) {
		super(app, host);
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
					.addOptions(DELIMITER_OPTIONS_SETTINGS)
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
					.addOptions(DECIMAL_OPTIONS_SETTINGS)
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
				b.setButtonText("Reset all").onClick(() => {
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
				});
				b.buttonEl.addClass("mod-warning");
			});
	}
}
