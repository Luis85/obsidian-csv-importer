import { App, Notice, PluginSettingTab } from "obsidian";
import type { Plugin, Setting, SettingDefinitionItem } from "obsidian";
import { confirmDialog } from "./view/ConfirmModal";
import type { PluginSettings } from "./types";
import {
	CONFLICT_OPTIONS,
	CSV_IMPORTS,
	DECIMAL_OPTIONS,
	DELIMITER_OPTIONS,
	EMPTY_VALUE_OPTIONS,
	ENCODING_LABELS,
	LINK_NOTES_TO_CSV,
	NAME,
	OPEN_CSV_IMPORTS,
	PAGE_SIZE_ERROR,
	RESET_ALL_BUTTON,
	RESET_ALL_SETTINGS,
	SETTINGS_DESC,
	SETTINGS_HEADINGS,
} from "./view/labels";

export { DEFAULT_SETTINGS, createDefaultFileConfig } from "./defaults";

/** What the setting tab needs from the plugin. */
export interface SettingsHost {
	settings: PluginSettings;
	saveSettings(): Promise<void>;
	forgetAllFileConfigs(): Promise<void>;
	/** Opens the CSV imports view. Optional: the settings tab hides the button when missing. */
	openImportIndex?(): void | Promise<void>;
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

	/** Declarative settings (Obsidian 1.13+, the minimum app version): they appear in the settings search. */
	override getSettingDefinitions(): SettingDefinitionItem[] {
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
		const reading: SettingDefinitionItem[] = [
			dropdown("defaultEncoding", NAME.encoding, ENCODING_LABELS, SETTINGS_DESC.encoding),
			dropdown("defaultDelimiter", NAME.delimiter, DELIMITER_OPTIONS, SETTINGS_DESC.delimiter),
			toggle("defaultHasHeader", NAME.hasHeader, SETTINGS_DESC.hasHeader),
			dropdown("defaultDecimalSeparator", NAME.decimal, DECIMAL_OPTIONS, SETTINGS_DESC.decimal),
			{
				name: NAME.listSeparator,
				desc: SETTINGS_DESC.listSeparator,
				render: (setting) => this.listSeparatorControl(setting),
			},
			dropdown("defaultEmptyValues", NAME.emptyCells, EMPTY_VALUE_OPTIONS, SETTINGS_DESC.emptyCells),
			toggle("midnightAsDate", "Treat midnight timestamps as dates", SETTINGS_DESC.midnight),
		];
		const notes: SettingDefinitionItem[] = [
			text("defaultTargetFolder", NAME.targetFolder, SETTINGS_DESC.targetFolder, "Example: Imports/data"),
			text("defaultFileNameTemplate", NAME.fileName, SETTINGS_DESC.fileName),
			{
				name: NAME.body,
				desc: SETTINGS_DESC.body,
				render: (setting) => this.bodyControl(setting),
			},
			text("defaultTags", NAME.tags, SETTINGS_DESC.tags),
			toggle("defaultAddSourceLink", LINK_NOTES_TO_CSV, SETTINGS_DESC.sourceLink),
			toggle("defaultCreateBase", NAME.createBase, SETTINGS_DESC.createBase),
		];
		const reimport: SettingDefinitionItem[] = [
			dropdown("defaultConflict", NAME.conflict, CONFLICT_OPTIONS, SETTINGS_DESC.conflict),
			toggle("defaultProtectEdits", NAME.protectEdits, SETTINGS_DESC.protectEdits),
			toggle("defaultKeepValuesOnEmpty", NAME.keepOnEmpty, SETTINGS_DESC.keepOnEmpty),
		];
		const table: SettingDefinitionItem[] = [
			{
				name: "Rows shown per page",
				desc: SETTINGS_DESC.pageSize,
				render: (setting) => this.pageSizeControl(setting),
			},
		];
		// Ordered by the user's journey: what new notes look like, how re-imports behave, then the rarely touched
		// file format, the table view and the danger zone. The route to CSV imports sits right under the intro.
		const result: SettingDefinitionItem[] = [{ name: "", desc: SETTINGS_DESC.intro, searchable: false }];
		if (this.host.openImportIndex) {
			result.push({
				name: CSV_IMPORTS,
				aliases: [OPEN_CSV_IMPORTS],
				desc: SETTINGS_DESC.imports,
				render: (setting) => {
					setting.addButton((b) => b.setButtonText(OPEN_CSV_IMPORTS).onClick(() => void this.host.openImportIndex?.()));
				},
			});
		}
		result.push(
			group(SETTINGS_HEADINGS.notes, notes),
			group(SETTINGS_HEADINGS.reimport, reimport),
			group(SETTINGS_HEADINGS.reading, reading),
			group(SETTINGS_HEADINGS.table, table),
			group(SETTINGS_HEADINGS.danger, [
				{
					name: RESET_ALL_SETTINGS,
					desc: SETTINGS_DESC.reset,
					render: (setting) => {
						setting.addButton((b) => b.setButtonText(RESET_ALL_BUTTON).setDestructive().onClick(() => this.confirmReset()));
					},
				},
			]),
		);
		return result;
	}

	override getControlValue(key: string): unknown {
		return (this.host.settings as unknown as Record<string, unknown>)[key];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
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

	/** Single-character input, 4em wide and centered. */
	private listSeparatorControl(setting: Setting): void {
		const s = this.host.settings;
		setting.addText((t) => {
			t.inputEl.addClass("csv-importer-input-char");
			t.setValue(s.defaultListSeparator).onChange((v) => {
				s.defaultListSeparator = v;
				void this.host.saveSettings();
			});
		});
	}

	/** Full-width textarea below its row. */
	private bodyControl(setting: Setting): void {
		const s = this.host.settings;
		setting.settingEl.addClass("csv-importer-setting-stacked");
		setting.addTextArea((t) => {
			t.inputEl.rows = 4;
			t.setValue(s.defaultBodyTemplate).onChange((v) => {
				s.defaultBodyTemplate = v;
				void this.host.saveSettings();
			});
		});
	}

	/** Number input, 8em wide, validated from 10 to 100000. */
	private pageSizeControl(setting: Setting): void {
		const s = this.host.settings;
		const pageError = setting.descEl.createDiv({ cls: "csv-importer-field-error" });
		pageError.hide();
		setting.addText((t) => {
			t.inputEl.addClass("csv-importer-input-number");
			t.inputEl.inputMode = "numeric";
			t.setValue(String(s.pageSize)).onChange((v) => {
				const n = Math.floor(Number(v));
				if (Number.isFinite(n) && n >= 10 && n <= 100000) {
					s.pageSize = n;
					t.inputEl.removeClass("csv-importer-invalid");
					pageError.hide();
					void this.host.saveSettings();
				} else {
					t.inputEl.addClass("csv-importer-invalid");
					pageError.setText(PAGE_SIZE_ERROR);
					pageError.show();
				}
			});
		});
	}
}
