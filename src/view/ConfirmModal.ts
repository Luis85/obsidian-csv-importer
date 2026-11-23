import { ButtonComponent, Modal } from "obsidian";
import type { App } from "obsidian";

/** Small yes/no dialog. Resolves true when confirmed. */
export function confirmDialog(app: App, title: string, message: string, confirmLabel: string, warning = false): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, title, message, confirmLabel, warning, null, (ok) => resolve(ok)).open();
	});
}

/** An extra checkbox shown in a confirm dialog. */
export interface ConfirmOption {
	label: string;
	checked?: boolean;
}

/** Like `confirmDialog`, with a checkbox. Resolves with the answer and the checkbox state at confirmation. */
export function confirmDialogWithOption(
	app: App,
	title: string,
	message: string,
	confirmLabel: string,
	option: ConfirmOption,
	warning = false,
): Promise<{ ok: boolean; checked: boolean }> {
	return new Promise((resolve) => {
		new ConfirmModal(app, title, message, confirmLabel, warning, option, (ok, checked) => resolve({ ok, checked })).open();
	});
}

class ConfirmModal extends Modal {
	private answered = false;
	private checkbox: HTMLInputElement | null = null;

	constructor(
		app: App,
		private readonly heading: string,
		private readonly message: string,
		private readonly confirmLabel: string,
		private readonly warning: boolean,
		private readonly option: ConfirmOption | null,
		private readonly done: (ok: boolean, checked: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.heading);
		this.contentEl.createEl("p", { text: this.message });
		if (this.option) {
			const label = this.contentEl.createEl("label", { cls: "csv-importer-confirm-option" });
			this.checkbox = label.createEl("input", { type: "checkbox" });
			this.checkbox.checked = this.option.checked === true;
			label.createSpan({ text: this.option.label });
		}
		const row = this.contentEl.createDiv({ cls: "modal-button-container" });
		new ButtonComponent(row).setButtonText("Cancel").onClick(() => this.close());
		const ok = new ButtonComponent(row).setButtonText(this.confirmLabel).onClick(() => {
			this.answered = true;
			this.done(true, this.checkbox?.checked ?? false);
			this.close();
		});
		if (this.warning) ok.setDestructive().setCta();
		else ok.setCta();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.answered) this.done(false, false);
	}
}
