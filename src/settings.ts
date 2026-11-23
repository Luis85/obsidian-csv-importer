import { App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import type { Plugin } from "obsidian";
import type { ConflictStrategy, DelimiterOption, FileImportConfig, PluginSettings } from "./types";

export { DEFAULT_SETTINGS, createDefaultFileConfig } from "./defaults";

/** What the setting tab needs from the plugin. */
export interface SettingsHost {
	settings: PluginSettings;
	saveSettings(): Promise<void>;
	forgetAllFileConfigs(): Promise<void>;
}

class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly message: string,
		private readonly confirmText: string,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Are you sure?");
		this.contentEl.createEl("p", { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(this.confirmText)
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
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

		new Setting(containerEl).setName("Defaults for new files").setHeading();

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
			.setName("Note name template")
			.setDesc("Use {{Column name}} for cell values, {{row}} for the row number and {{file}} for the CSV name.")
			.addText((t) =>
				t.setValue(s.defaultFileNameTemplate).onChange((v) => {
					s.defaultFileNameTemplate = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Note body template")
			.setDesc("Text placed below the properties. Supports the same placeholders.")
			.addTextArea((t) =>
				t.setValue(s.defaultBodyTemplate).onChange((v) => {
					s.defaultBodyTemplate = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName("When a note already exists")
			.addDropdown((d) =>
				d
					.addOptions({
						skip: "Skip",
						overwrite: "Overwrite the whole note",
						update: "Update properties, keep the body",
						rename: "Create a new note with a number suffix",
					})
					.setValue(s.defaultConflict)
					.onChange((v) => {
						s.defaultConflict = v as ConflictStrategy;
						save();
					}),
			);

		new Setting(containerEl)
			.setName("Tags")
			.setDesc("Comma-separated tags added to every imported note.")
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
			.setName("List separator")
			.setDesc("Splits cell values of list columns into items.")
			.addText((t) =>
				t.setValue(s.defaultListSeparator).onChange((v) => {
					s.defaultListSeparator = v;
					save();
				}),
			);

		new Setting(containerEl).setName("Behavior").setHeading();

		new Setting(containerEl)
			.setName("Treat midnight timestamps as dates")
			.setDesc("Detect a date instead of a date and time when every time in a column is 00:00:00.")
			.addToggle((t) =>
				t.setValue(s.midnightAsDate).onChange((v) => {
					s.midnightAsDate = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Register property types")
			.setDesc("Also tell Obsidian the type of each imported property so it shows the right editor.")
			.addToggle((t) =>
				t.setValue(s.registerPropertyTypes).onChange((v) => {
					s.registerPropertyTypes = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Rows shown per page")
			.setDesc("Maximum number of rows rendered in the table before showing more.")
			.addText((t) =>
				t.setValue(String(s.pageSize)).onChange((v) => {
					const n = Math.floor(Number(v));
					if (Number.isFinite(n) && n >= 10 && n <= 100000) {
						s.pageSize = n;
						save();
					}
				}),
			);

		new Setting(containerEl).setName("Data").setHeading();

		new Setting(containerEl)
			.setName("Forget all per-file import settings")
			.setDesc("Removes the saved import configuration of every CSV file. Imported notes are not affected.")
			.addButton((b) =>
				b
					.setButtonText("Forget all")
					.setWarning()
					.onClick(() => {
						new ConfirmModal(
							this.app,
							"This removes the saved import configuration of all CSV files. This cannot be undone.",
							"Forget all",
							() => {
								void this.host.forgetAllFileConfigs().then(() => new Notice("Per-file import settings cleared."));
							},
						).open();
					}),
			);
	}
}
