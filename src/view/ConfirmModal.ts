import { Modal } from "obsidian";
import type { App } from "obsidian";

/** Small yes/no dialog. Resolves true when confirmed. */
export function confirmDialog(app: App, title: string, message: string, confirmLabel: string, warning = false): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, title, message, confirmLabel, warning, resolve).open();
	});
}

class ConfirmModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private readonly heading: string,
		private readonly message: string,
		private readonly confirmLabel: string,
		private readonly warning: boolean,
		private readonly done: (ok: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.heading);
		this.contentEl.createEl("p", { text: this.message });
		const row = this.contentEl.createDiv({ cls: "modal-button-container" });
		const ok = row.createEl("button", { text: this.confirmLabel, cls: this.warning ? "mod-warning" : "mod-cta" });
		ok.addEventListener("click", () => {
			this.answered = true;
			this.done(true);
			this.close();
		});
		row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.answered) this.done(false);
	}
}
