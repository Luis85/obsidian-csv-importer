import { Modal, Notice, TFile } from "obsidian";
import type { App } from "obsidian";
import { plural } from "../core/util";
import type { ImportIndexHost } from "../host";
import { formatBytes } from "./dom";
import { CANCEL, NO_NEW_CSV_HINT, NO_NEW_CSV_TITLE, SCAN_VAULT } from "./labels";

/**
 * Lists every CSV file in the vault that has no import settings yet and adds the checked ones to the index with default
 * settings. Nothing is imported. Row counts are computed when a row scrolls into view.
 */
export class ScanVaultModal extends Modal {
	private files: TFile[] = [];
	private readonly checked = new Set<string>();
	private addBtn: HTMLButtonElement | null = null;
	private queue: Promise<void> = Promise.resolve();
	private observer: IntersectionObserver | null = null;

	constructor(
		app: App,
		private readonly host: ImportIndexHost,
		private readonly onAdded: () => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(SCAN_VAULT);
		this.modalEl.addClass("csv-importer-scan-modal");
		this.contentEl.setAttr("data-testid", "scan-vault-modal");
		this.files = this.host.listUnindexedCsvs();
		for (const f of this.files) this.checked.add(f.path);
		this.render();
	}

	override onClose(): void {
		this.observer?.disconnect();
		this.contentEl.empty();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		if (this.files.length === 0) {
			const empty = el.createDiv({ cls: "csv-importer-scan-empty", attr: { "data-testid": "scan-empty" } });
			empty.createEl("h3", { text: NO_NEW_CSV_TITLE, cls: "csv-importer-scan-empty-title" });
			empty.createEl("p", { text: NO_NEW_CSV_HINT });
			this.buttons(false);
			return;
		}
		el.createEl("p", {
			cls: "csv-importer-scan-intro",
			text: `${plural(this.files.length, "CSV file is", "CSV files are")} not in the index yet. Checked files get default import settings. Nothing is imported.`,
		});
		const bar = el.createDiv({ cls: "csv-importer-scan-bar" });
		const all = bar.createEl("button", { cls: "csv-importer-scan-link", text: "Select all", attr: { type: "button" } });
		const none = bar.createEl("button", { cls: "csv-importer-scan-link", text: "Select none", attr: { type: "button" } });
		const list = el.createDiv({ cls: "csv-importer-scan-list", attr: { role: "list", "data-testid": "scan-list" } });
		const boxes: HTMLInputElement[] = [];
		const setAll = (on: boolean): void => {
			for (const b of boxes) {
				b.checked = on;
				b.dispatchEvent(new Event("change"));
			}
		};
		all.addEventListener("click", () => setAll(true));
		none.addEventListener("click", () => setAll(false));

		this.observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				this.observer?.unobserve(e.target);
				(e.target as HTMLElement & { loadCount?: () => void }).loadCount?.();
			}
		}, { root: list });

		for (const f of this.files) {
			const row = list.createEl("label", { cls: "csv-importer-scan-row", attr: { role: "listitem", "data-testid": "scan-row" } });
			const box = row.createEl("input", { type: "checkbox", attr: { "aria-label": f.path } });
			box.checked = this.checked.has(f.path);
			box.addEventListener("change", () => {
				if (box.checked) this.checked.add(f.path);
				else this.checked.delete(f.path);
				this.updateAdd();
			});
			boxes.push(box);
			const main = row.createDiv({ cls: "csv-importer-scan-main" });
			main.createDiv({ cls: "csv-importer-scan-name", text: f.name });
			main.createDiv({ cls: "csv-importer-scan-path", text: f.parent && !f.parent.isRoot() ? f.parent.path : "Vault root" });
			const meta = row.createDiv({ cls: "csv-importer-scan-meta" });
			meta.createSpan({ text: formatBytes(f.stat.size) });
			const rows = meta.createSpan({ cls: "csv-importer-scan-rows", text: "..." });
			const load = (): void => {
				this.queue = this.queue.then(async () => {
					const n = await this.host.countCsvRows(f);
					rows.setText(n === null ? "" : plural(n, "row", "rows"));
				});
			};
			(row as HTMLElement & { loadCount?: () => void }).loadCount = load;
			if (this.observer) this.observer.observe(row);
			else load();
		}
		this.buttons(true);
	}

	private buttons(hasFiles: boolean): void {
		const bar = this.contentEl.createDiv({ cls: "modal-button-container" });
		if (hasFiles) {
			const add = bar.createEl("button", { cls: "mod-cta", attr: { type: "button", "data-testid": "scan-add" } });
			add.addEventListener("click", () => void this.add());
			this.addBtn = add;
			this.updateAdd();
		}
		const cancel = bar.createEl("button", { text: hasFiles ? CANCEL : "Close", attr: { type: "button" } });
		cancel.addEventListener("click", () => this.close());
	}

	private updateAdd(): void {
		if (!this.addBtn) return;
		const n = this.checked.size;
		this.addBtn.setText(n === 0 ? "Add to index" : `Add ${n} to index`);
		this.addBtn.disabled = n === 0;
	}

	private async add(): Promise<void> {
		if (this.addBtn) this.addBtn.disabled = true;
		try {
			const n = await this.host.addToIndex([...this.checked]);
			new Notice(`Added ${plural(n, "CSV file", "CSV files")} to the index.`);
			this.close();
			this.onAdded();
		} catch (e) {
			console.error("CSV Importer: could not add CSV files to the index", e);
			new Notice("Could not add the CSV files to the index.");
			if (this.addBtn) this.addBtn.disabled = false;
		}
	}
}
