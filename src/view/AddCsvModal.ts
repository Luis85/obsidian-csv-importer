import { Modal, Notice, Setting, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { errorMessage } from "../core/util";
import type { ImportIndexHost } from "../host";
import { sanitizeFileName } from "../import/folders";
import { FolderSuggest } from "./config/FolderSuggest";
import { formatBytes } from "./dom";
import { ADD_CSV_FILE, CANCEL } from "./labels";

const ADD_CSV_NOTE =
	"The file is copied into your vault as it is. The plugin cannot follow the original file: to update the copy later, add the file again with the same folder and name and choose Replace.";

/**
 * Copies a CSV file chosen with the system file picker into the vault (bytes unchanged), adds it to the index and opens it.
 * The picker is a plain `<input type="file">`, so it works on desktop and mobile without Node or Electron APIs.
 */
export class AddCsvModal extends Modal {
	private picked: File | null = null;
	private folder = "";
	private name = "";
	private conflict: "replace" | "keep" = "keep";
	private nameInput: HTMLInputElement | null = null;
	private fileLabel: HTMLElement | null = null;
	private conflictEl: HTMLElement | null = null;
	private addBtn: HTMLButtonElement | null = null;
	private errorEl: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly host: ImportIndexHost,
		private readonly onAdded: () => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(ADD_CSV_FILE.replace(/\.\.\.$/, ""));
		this.modalEl.addClass("csv-importer-add-modal");
		const el = this.contentEl;
		el.setAttr("data-testid", "add-csv-modal");

		const input = el.createEl("input", {
			type: "file",
			cls: "csv-importer-hidden",
			attr: { accept: ".csv,text/csv", "data-testid": "add-csv-input", "aria-label": "CSV file" },
		});
		input.addEventListener("change", () => {
			const f = input.files?.[0] ?? null;
			this.pick(f);
		});

		const fileSetting = new Setting(el).setName("CSV file").setDesc("A file from anywhere on your device.");
		this.fileLabel = fileSetting.descEl;
		fileSetting.addButton((b) => b.setButtonText("Choose file...").onClick(() => input.click()).buttonEl.setAttr("data-testid", "add-csv-choose"));

		new Setting(el)
			.setName("Folder in the vault")
			.setDesc("Where the copy is saved. Created when it does not exist.")
			.addText((t) => {
				t.setPlaceholder("Vault root").onChange((v) => {
					this.folder = v.trim();
					this.refresh();
				});
				t.inputEl.setAttr("data-testid", "add-csv-folder");
				t.inputEl.setAttr("aria-label", "Folder in the vault");
				new FolderSuggest(this.app, t.inputEl, (path) => {
					this.folder = path;
					t.setValue(path);
					this.refresh();
				});
			});

		new Setting(el).setName("File name").addText((t) => {
			t.onChange((v) => {
				this.name = v;
				this.refresh();
			});
			t.inputEl.setAttr("data-testid", "add-csv-name");
			t.inputEl.setAttr("aria-label", "File name");
			this.nameInput = t.inputEl;
		});

		this.conflictEl = el.createDiv({ cls: "csv-importer-add-conflict", attr: { "data-testid": "add-csv-conflict" } });
		el.createEl("p", { cls: "csv-importer-add-note", text: ADD_CSV_NOTE });
		this.errorEl = el.createDiv({ cls: "csv-importer-field-error csv-importer-hidden", attr: { role: "alert" } });

		const bar = el.createDiv({ cls: "modal-button-container" });
		const add = bar.createEl("button", { text: "Add to vault", cls: "mod-cta", attr: { type: "button", "data-testid": "add-csv-submit" } });
		add.addEventListener("click", () => void this.submit());
		this.addBtn = add;
		const cancel = bar.createEl("button", { text: CANCEL, attr: { type: "button" } });
		cancel.addEventListener("click", () => this.close());
		this.refresh();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private pick(f: File | null): void {
		this.picked = f;
		if (f && this.nameInput) {
			this.name = f.name;
			this.nameInput.value = f.name;
		}
		this.refresh();
	}

	private stem(): string {
		return sanitizeFileName(this.name.replace(/\.csv$/i, ""));
	}

	private targetPath(): string {
		const stem = this.stem();
		const dir = normalizePath(this.folder || "/");
		return normalizePath(dir === "/" ? `${stem}.csv` : `${dir}/${stem}.csv`);
	}

	private refresh(): void {
		if (this.fileLabel) {
			this.fileLabel.setText(this.picked ? `${this.picked.name} (${formatBytes(this.picked.size)})` : "A file from anywhere on your device.");
			this.fileLabel.toggleClass("is-picked", this.picked !== null);
		}
		const ready = this.picked !== null && this.stem() !== "";
		if (this.addBtn) this.addBtn.disabled = !ready;
		this.renderConflict(ready);
	}

	private renderConflict(ready: boolean): void {
		const box = this.conflictEl;
		if (!box) return;
		box.empty();
		const path = ready ? this.targetPath() : "";
		if (!path || !this.app.vault.getAbstractFileByPath(path)) {
			box.addClass("csv-importer-hidden");
			return;
		}
		box.removeClass("csv-importer-hidden");
		box.createEl("p", { cls: "csv-importer-add-conflict-text", text: `${path} already exists.` });
		const options: [("replace" | "keep"), string][] = [
			["keep", "Keep both: save the new file with a free name (for example name 1.csv)"],
			["replace", "Replace the existing file"],
		];
		for (const [value, label] of options) {
			const row = box.createEl("label", { cls: "csv-importer-add-choice" });
			const radio = row.createEl("input", { type: "radio", attr: { name: "csv-importer-add-conflict", "data-testid": `add-csv-${value}` } });
			radio.checked = this.conflict === value;
			radio.addEventListener("change", () => {
				if (radio.checked) this.conflict = value;
			});
			row.createSpan({ text: label });
		}
	}

	private showError(message: string | null): void {
		if (!this.errorEl) return;
		this.errorEl.setText(message ?? "");
		this.errorEl.toggleClass("csv-importer-hidden", message === null);
	}

	private async submit(): Promise<void> {
		const f = this.picked;
		if (!f || this.stem() === "") return;
		if (this.addBtn) this.addBtn.disabled = true;
		this.showError(null);
		try {
			const data = await f.arrayBuffer();
			const added = await this.host.addExternalCsv(data, this.folder, this.name, this.conflict);
			new Notice(`Added ${added.path} to the vault and to CSV imports.`);
			this.close();
			this.onAdded();
		} catch (e) {
			console.error("CSV Importer: could not add the CSV file", e);
			this.showError(`Could not add the file: ${errorMessage(e)}`);
			if (this.addBtn) this.addBtn.disabled = false;
		}
	}
}
