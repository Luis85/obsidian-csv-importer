import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type { Plugin } from "obsidian";
import { confirmDialog } from "./view/ConfirmModal";
import type { ConflictStrategy, CsvEncoding, DelimiterOption, EmptyValueMode, PluginSettings } from "./types";

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
		const s = this.host.settings;
		const save = (): void => {
			void this.host.saveSettings();
		};
		containerEl.empty();

		new Setting(containerEl)
			.setDesc("Defaults for CSV files you have not configured yet. Each file keeps its own settings once you save them.");

		new Setting(containerEl).setName("Reading CSV files").setHeading();

		new Setting(containerEl)
			.setName("Encoding")
			.setDesc("Auto detects UTF-8, UTF-16 and Windows-1252.")
			.addDropdown((d) =>
				d
					.addOptions({ auto: "Auto", "utf-8": "UTF-8", "utf-16le": "UTF-16 LE", "utf-16be": "UTF-16 BE", "windows-1252": "Windows-1252" })
					.setValue(s.defaultEncoding)
					.onChange((v) => {
						s.defaultEncoding = v as CsvEncoding;
						save();
					}),
			);

		new Setting(containerEl)
			.setName("Delimiter")
			.setDesc("Column separator. Automatic detection looks at the file content.")
			.addDropdown((d) =>
				d
					.addOptions({ auto: "Detect automatically", ",": "Comma", ";": "Semicolon", "\t": "Tab", "|": "Pipe" })
					.setValue(s.defaultDelimiter)
					.onChange((v) => {
						s.defaultDelimiter = v as DelimiterOption;
						save();
					}),
			);

		new Setting(containerEl)
			.setName("First row contains column names")
			.addToggle((t) =>
				t.setValue(s.defaultHasHeader).onChange((v) => {
					s.defaultHasHeader = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Decimal separator")
			.setDesc("Used when reading numbers, for example 0,625 in many European exports.")
			.addDropdown((d) =>
				d
					.addOptions({ ".": "Dot", ",": "Comma" })
					.setValue(s.defaultDecimalSeparator)
					.onChange((v) => {
						s.defaultDecimalSeparator = v as "." | ",";
						save();
					}),
			);

		new Setting(containerEl)
			.setName("List separator")
			.setDesc("Splits cell values of list columns into items.")
			.addText((t) =>
				t.setValue(s.defaultListSeparator).onChange((v) => {
					s.defaultListSeparator = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Empty cells")
			.setDesc("How empty cells are written into the properties of a note.")
			.addDropdown((d) =>
				d
					.addOptions({ empty: "Leave property empty", omit: "Omit property" })
					.setValue(s.defaultEmptyValues)
					.onChange((v) => {
						s.defaultEmptyValues = v as EmptyValueMode;
						save();
					}),
			);

		new Setting(containerEl)
			.setName("Treat midnight timestamps as dates")
			.setDesc("Detect a date instead of a date and time when every time in a column is 00:00:00.")
			.addToggle((t) =>
				t.setValue(s.midnightAsDate).onChange((v) => {
					s.midnightAsDate = v;
					save();
				}),
			);

		new Setting(containerEl).setName("Creating notes").setHeading();

		new Setting(containerEl)
			.setName("Target folder")
			.setDesc("Leave empty to create notes in a folder named like the CSV file, next to it.")
			.addText((t) =>
				t
					.setPlaceholder("Example: Imports/data")
					.setValue(s.defaultTargetFolder)
					.onChange((v) => {
						s.defaultTargetFolder = v.trim();
						save();
					}),
			);

		new Setting(containerEl)
			.setName("File name template")
			.setDesc("Use {{Column name}} for cell values, {{row}} for the row number and {{file}} for the CSV name.")
			.addText((t) =>
				t.setValue(s.defaultFileNameTemplate).onChange((v) => {
					s.defaultFileNameTemplate = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Body template")
			.setDesc("Text placed below the properties. Supports the same placeholders.")
			.addTextArea((t) =>
				t.setValue(s.defaultBodyTemplate).onChange((v) => {
					s.defaultBodyTemplate = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Comma-separated tags")
			.setDesc("Added to every imported note.")
			.addText((t) =>
				t.setValue(s.defaultTags).onChange((v) => {
					s.defaultTags = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Add link to the CSV file")
			.setDesc("Writes a source property that links back to the CSV file.")
			.addToggle((t) =>
				t.setValue(s.defaultAddSourceLink).onChange((v) => {
					s.defaultAddSourceLink = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Create a base")
			.setDesc("Create a .base file next to the target folder that shows the imported notes as a table.")
			.addToggle((t) =>
				t.setValue(s.defaultCreateBase).onChange((v) => {
					s.defaultCreateBase = v;
					save();
				}),
			);


		new Setting(containerEl).setName("Existing notes").setHeading();

		new Setting(containerEl)
			.setName("When a note already exists")
			.setDesc("Update properties keeps properties you added in Obsidian and the note body. Replace whole note overwrites the note completely.")
			.addDropdown((d) =>
				d
					.addOptions({
						update: "Update properties",
						skip: "Skip",
						rename: "Create a copy",
						overwrite: "Replace whole note",
					})
					.setValue(s.defaultConflict)
					.onChange((v) => {
						s.defaultConflict = v as ConflictStrategy;
						save();
					}),
			);

		new Setting(containerEl)
			.setName("Keep values edited in Obsidian")
			.setDesc("When updating, a CSV property you changed in Obsidian keeps your value.")
			.addToggle((t) =>
				t.setValue(s.defaultProtectEdits).onChange((v) => {
					s.defaultProtectEdits = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Keep values when the CSV cell is empty")
			.setDesc("When updating, an empty cell does not clear a value in the note.")
			.addToggle((t) =>
				t.setValue(s.defaultKeepValuesOnEmpty).onChange((v) => {
					s.defaultKeepValuesOnEmpty = v;
					save();
				}),
			);

		new Setting(containerEl).setName("Table view").setHeading();

		const pageSetting = new Setting(containerEl)
			.setName("Rows shown per page")
			.setDesc("Maximum number of rows rendered in the table before showing more.");
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
					pageError.setText("Enter a whole number from 10 to 100000.");
					pageError.show();
				}
			}),
		);

		new Setting(containerEl).setName("Data").setHeading();

		new Setting(containerEl)
			.setName("Reset all import settings")
			.setDesc("Removes the saved import settings of every CSV file. Imported notes are not affected.")
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
