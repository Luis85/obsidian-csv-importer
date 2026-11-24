import { ItemView, Menu, Notice, TFile, debounce, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type { ImportIndexHost, ImportSummary } from "../host";
import { errorMessage } from "../core/util";
import { relativeTime } from "./relativeTime";
import { lastRunText } from "../import/fingerprint";
import { onCsvChanged } from "../obsidian/events";
import { AddCsvModal } from "./AddCsvModal";
import { ScanVaultModal } from "./ScanVaultModal";
import { badge, iconButton, renderCallout } from "./dom";
import {
	ADD_CSV, ADD_CSV_FROM_DEVICE, ADD_CSV_SCAN, CHANGED_BADGE, CSV_IMPORTS, CSV_MISSING, DELETE_IMPORTED_NOTES, IMPORT_BUTTON, IMPORT_SETTINGS,
	NO_IMPORTS_TITLE, OPEN_BASE, REIMPORT_ALL, REIMPORT_BUTTON, REIMPORT_CHANGED, REMOVE_FROM_IMPORTS, UNDO_LAST_IMPORT, changedLine, editedLine,
} from "./labels";

export const VIEW_TYPE_IMPORT_INDEX = "csv-importer-index";

interface RowAction {
	id: string;
	label: string;
	icon: string;
	run: () => Promise<void> | void;
	/** Listed below the separator in the "..." menu. */
	menuOnly?: boolean;
	warning?: boolean;
}

/** Index of every CSV with saved import settings: re-import, configure, undo and bulk delete from one place. */
export class ImportIndexView extends ItemView {
	private items: ImportSummary[] = [];
	private itemsKey = "";
	private query = "";
	private loaded = false;
	private renderToken = 0;
	private listEl: HTMLElement | null = null;
	private reimportAllBtn: HTMLButtonElement | null = null;
	private searchEl: HTMLInputElement | null = null;
	/** Re-checks the edited-notes count of each visible row (the metadata cache can lag behind an import). */
	private readonly editedUpdaters = new Map<string, () => void>();

	private readonly refreshSoon = debounce(() => void this.refresh(false), 300, true);
	private readonly recheckEditedSoon = debounce(() => this.editedUpdaters.forEach((u) => u()), 800, true);

	constructor(
		leaf: WorkspaceLeaf,
		private readonly host: ImportIndexHost,
	) {
		super(leaf);
		this.navigation = true;
	}

	getViewType(): string {
		return VIEW_TYPE_IMPORT_INDEX;
	}

	getDisplayText(): string {
		return CSV_IMPORTS;
	}

	override getIcon(): string {
		return "table-properties";
	}

	override async onOpen(): Promise<void> {
		const { vault, workspace } = this.app;
		this.registerEvent(vault.on("rename", () => this.refreshSoon()));
		this.registerEvent(vault.on("delete", () => this.refreshSoon()));
		this.registerEvent(vault.on("create", (f) => f instanceof TFile && f.extension === "base" && this.refreshSoon()));
		this.registerEvent(vault.on("modify", (f) => f instanceof TFile && f.extension.toLowerCase() === "csv" && this.refreshSoon()));
		this.registerEvent(this.app.metadataCache.on("resolved", () => this.recheckEditedSoon()));
		onCsvChanged(this, () => this.refreshSoon());
		this.registerEvent(
			workspace.on("active-leaf-change", (leaf) => {
				if (leaf === this.leaf) this.refreshSoon();
			}),
		);
		this.buildShell();
		await this.refresh();
	}

	override onClose(): Promise<void> {
		this.contentEl.empty();
		return Promise.resolve();
	}

	/**
	 * Reloads the list from the plugin and redraws it. Without `force`, an unchanged list is not redrawn (event driven
	 * refreshes must not replace the rows under the user's pointer).
	 */
	async refresh(force = true): Promise<void> {
		try {
			const items = await this.host.listImports();
			const key = JSON.stringify(items);
			if (!force && this.loaded && key === this.itemsKey) return;
			this.itemsKey = key;
			this.items = items;
			this.loaded = true;
		} catch (e) {
			console.error("CSV Importer: could not list imports", e);
			new Notice(`Could not load the imports: ${errorMessage(e)}`);
		}
		this.renderList();
	}

	private buildShell(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("csv-importer-index");
		root.setAttr("data-testid", "csv-index");

		const tools = root.createDiv({ cls: "csv-importer-index-tools" });
		const search = tools.createEl("input", {
			type: "search",
			cls: "csv-importer-index-search",
			attr: { placeholder: "Filter imports...", "aria-label": "Filter imports" },
		});
		search.addEventListener("input", () => {
			this.query = search.value.trim().toLowerCase();
			this.renderList();
		});
		this.searchEl = search;
		// One menu button for both ways to add a CSV (scan the vault, copy a file from the device).
		const add = tools.createEl("button", {
			cls: "csv-importer-index-add",
			attr: { type: "button", "aria-haspopup": "menu", "data-testid": "csv-index-add" },
		});
		add.createSpan({ text: ADD_CSV });
		setIcon(add.createSpan({ cls: "csv-importer-index-add-chevron" }), "chevron-down");
		add.addEventListener("click", () => this.openAddMenu(add));
		const all = tools.createEl("button", { cls: "csv-importer-index-all", text: REIMPORT_ALL, attr: { type: "button" } });
		all.addEventListener("click", () => void this.guard(() => this.host.reimportAll()));
		this.reimportAllBtn = all;
		iconButton(tools, { icon: "refresh-cw", label: "Refresh", onClick: () => void this.refresh() });

		this.listEl = root.createDiv({ cls: "csv-importer-index-list" });
	}

	private renderList(): void {
		const list = this.listEl;
		if (!list) return;
		const token = ++this.renderToken;
		list.empty();
		this.editedUpdaters.clear();
		const none = this.loaded && this.items.length === 0;
		if (this.reimportAllBtn) {
			this.reimportAllBtn.disabled = !this.items.some((i) => i.exists);
			this.reimportAllBtn.toggleClass("csv-importer-hidden", none);
		}
		this.searchEl?.toggleClass("csv-importer-hidden", none);
		const changed = this.items.filter((i) => i.exists && i.changed).length;
		if (changed > 0) {
			const box = renderCallout(list, "info", {
				title: changedLine(changed),
				items: [],
				action: { label: REIMPORT_CHANGED, onClick: () => void this.guard(() => this.host.reimportChanged()) },
			});
			box.addClass("csv-importer-index-changed");
			box.setAttr("data-testid", "csv-index-changed");
			box.find(".csv-importer-callout-action")?.setAttr("data-testid", "csv-index-reimport-changed");
		}

		if (this.items.length === 0) {
			if (!this.loaded) return;
			const empty = list.createDiv({ cls: "csv-importer-index-empty" });
			setIcon(empty.createDiv({ cls: "csv-importer-index-empty-icon" }), "table-properties");
			empty.createEl("h3", { text: NO_IMPORTS_TITLE, cls: "csv-importer-index-empty-title" });
			const hint = empty.createEl("p", { cls: "csv-importer-index-empty-hint" });
			hint.appendText("Open a CSV file and choose ");
			hint.createEl("strong", { text: IMPORT_BUTTON });
			hint.appendText(" to set one up, or use ");
			hint.createEl("strong", { text: ADD_CSV });
			hint.appendText(".");
			return;
		}
		const visible = this.items.filter(
			(i) => !this.query || i.csvPath.toLowerCase().includes(this.query),
		);
		if (visible.length === 0) {
			list.createDiv({ cls: "csv-importer-index-empty", text: "No imports match your filter." });
			return;
		}
		const head = list.createDiv({ cls: "csv-importer-index-row mod-head", attr: { role: "presentation" } });
		head.createDiv({ cls: "csv-importer-index-main", text: "CSV file" });
		head.createDiv({ cls: "csv-importer-index-last", text: "Last import" });
		head.createDiv({ cls: "csv-importer-index-count", text: "Notes" });
		head.createDiv({ cls: "csv-importer-index-actions" });
		const body = list.createDiv({ cls: "csv-importer-index-rows", attr: { role: "list" } });
		for (const item of visible) this.renderRow(body, item, token);
	}

	private renderRow(list: HTMLElement, item: ImportSummary, token: number): void {
		const row = list.createDiv({ cls: "csv-importer-index-row", attr: { role: "listitem", "data-testid": "csv-index-row" } });
		if (!item.exists) row.addClass("is-missing");
		const dir = item.csvPath.includes("/") ? item.csvPath.slice(0, item.csvPath.lastIndexOf("/")) : "";

		const main = row.createDiv({ cls: "csv-importer-index-main" });
		const nameLine = main.createDiv({ cls: "csv-importer-index-nameline" });
		const tip = item.targetFolder ? `${item.csvPath}\n\u2192 ${item.targetFolder}` : item.csvPath;
		// Styled as a link, not a button: the row's real buttons are Import/Re-import and the menu.
		const name = nameLine.createEl("button", {
			cls: "csv-importer-index-name",
			text: item.fileName,
			attr: { type: "button", "aria-label": `Open ${item.csvPath}`, title: tip },
		});
		name.disabled = !item.exists;
		name.addEventListener("click", () => this.openCsv(item));
		if (item.exists && item.changed) {
			const b = badge(nameLine, CHANGED_BADGE, { kind: "warning", cls: "csv-importer-index-changed-badge" });
			b.setAttr("data-testid", "csv-index-changed-badge");
			if (item.modifiedAt) b.setAttr("title", `CSV modified ${relativeTime(item.modifiedAt)} (${new Date(item.modifiedAt).toLocaleString()})`);
		}
		if (!item.exists) {
			const warn = nameLine.createSpan({ cls: "csv-importer-index-missing" });
			setIcon(warn.createSpan({ cls: "csv-importer-index-missing-icon" }), "alert-triangle");
			warn.createSpan({ text: CSV_MISSING });
		}
		main.createDiv({ cls: "csv-importer-index-path", text: dir || "Vault root" });
		const changedText = item.exists && item.changed && item.modifiedAt ? `CSV changed ${relativeTime(item.modifiedAt)}` : "";
		const resultText = item.lastRun ? lastRunText(item.lastRun) : "";
		if (changedText) main.createDiv({ cls: "csv-importer-index-meta mod-changed", text: changedText, attr: { "data-testid": "csv-index-changed-time" } });
		const resultLine = main.createDiv({ cls: "csv-importer-index-meta", attr: { "data-testid": "csv-index-result" } });
		if (resultText) resultLine.createSpan({ cls: "csv-importer-index-result", text: resultText });
		const editedEl = resultLine.createSpan({ cls: "csv-importer-index-edited csv-importer-hidden", attr: { "data-testid": "csv-index-edited" } });
		if (!resultText) resultLine.addClass("csv-importer-hidden");

		const lastText = item.lastImport ? relativeTime(item.lastImport) : "Never imported";
		const last = row.createDiv({ cls: "csv-importer-index-last", text: lastText });
		if (item.lastImport) last.setAttribute("title", new Date(item.lastImport).toLocaleString());
		const count = row.createDiv({ cls: "csv-importer-index-count", text: "...", attr: { "data-testid": "csv-index-count" } });

		const summary = row.createDiv({ cls: "csv-importer-index-summary" });
		let countText = "...";
		let editedText = "";
		const renderSummary = (): void => {
			// No notes: a muted dash in the column, and nothing in the phone summary line.
			const none = countText === "0";
			count.setText(none ? "\u2014" : countText);
			count.toggleClass("mod-none", none);
			if (none) count.setAttr("aria-label", "No notes");
			else count.removeAttribute("aria-label");
			const parts = [dir || "Vault root", lastText];
			if (countText !== "..." && !none) parts.push(`${countText} ${countText === "1" ? "note" : "notes"}`);
			if (resultText) parts.push(resultText);
			if (editedText) parts.push(editedText);
			if (changedText) parts.push(changedText);
			summary.setText(parts.join(" \u00b7 "));
		};
		const setCount = (text: string): void => {
			countText = text;
			renderSummary();
		};
		const showEdited = (): void => {
			if (!item.lastImport) return;
			void this.host
				.countEditedNotes(item.csvPath)
				.then((e) => {
					if (token !== this.renderToken) return;
					editedText = e.count > 0 ? editedLine(e.count) : "";
					editedEl.setText(editedText ? (resultText ? ` \u00b7 ${editedText}` : editedText) : "");
					editedEl.toggleClass("csv-importer-hidden", !editedText);
					resultLine.toggleClass("csv-importer-hidden", !resultText && !editedText);
					const shown = e.properties.slice(0, 6).join(", ");
					const more = e.properties.length > 6 ? ", ..." : "";
					editedEl.setAttr("title", e.count > 0 ? `Edited properties: ${shown}${more}` : "");
					renderSummary();
				})
				.catch(() => undefined);
		};
		this.editedUpdaters.set(item.csvPath, showEdited);
		showEdited();
		setCount("...");
		void this.host
			.countImportedNotes(item.csvPath)
			.then((n) => {
				if (token === this.renderToken) setCount(String(n));
			})
			.catch(() => {
				if (token === this.renderToken) setCount("?");
			});

		const actions = row.createDiv({ cls: "csv-importer-index-actions" });
		const all = this.actionsFor(item);
		if (item.exists) {
			const label = item.lastImport ? REIMPORT_BUTTON : IMPORT_BUTTON;
			const primary = actions.createEl("button", {
				cls: "csv-importer-index-primary",
				text: label,
				attr: { type: "button", "aria-label": `${label} ${item.fileName}`, "data-testid": "csv-index-primary" },
			});
			if (item.changed) primary.addClass("mod-cta");
			primary.addEventListener("click", () => void this.guard(() => this.host.reimport(item.csvPath)));
			const cfg = all.find((a) => a.id === "configure");
			if (cfg) {
				iconButton(actions, {
					icon: cfg.icon,
					label: `${cfg.label} for ${item.fileName}`,
					cls: "csv-importer-index-configure",
					onClick: () => void this.guard(cfg.run),
				});
			}
		}
		iconButton(actions, {
			icon: "more-horizontal",
			label: `More actions for ${item.fileName}`,
			cls: "csv-importer-index-more",
			onClick: (ev) => this.openMenu(ev, all),
		});
	}

	private actionsFor(item: ImportSummary): RowAction[] {
		const actions: RowAction[] = [];
		if (item.exists) {
			actions.push({ id: "configure", label: IMPORT_SETTINGS, icon: "sliders-horizontal", run: () => this.host.configureImport(item.csvPath) });
		}
		const base = item.basePath;
		if (base) {
			actions.push({ id: "base", label: OPEN_BASE, icon: "layout-list", run: () => this.openBaseFile(base) });
		}
		if (item.hasUndo) {
			actions.push({ id: "undo", label: UNDO_LAST_IMPORT, icon: "undo-2", run: () => this.host.undoImport(item.csvPath) });
		}
		actions.push({
			id: "delete",
			label: DELETE_IMPORTED_NOTES,
			icon: "trash-2",
			menuOnly: true,
			warning: true,
			run: async () => void (await this.host.deleteImportedNotes(item.csvPath)),
		});
		actions.push({
			id: "remove",
			label: REMOVE_FROM_IMPORTS,
			icon: "x-circle",
			menuOnly: true,
			warning: true,
			run: async () => void (await this.host.removeFromIndex(item.csvPath)),
		});
		return actions;
	}

	private openMenu(ev: MouseEvent, actions: RowAction[]): void {
		const menu = new Menu();
		const regular = actions.filter((a) => !a.menuOnly);
		for (const a of regular) menu.addItem((i) => i.setTitle(a.label).setIcon(a.icon).onClick(() => void this.guard(a.run)));
		if (regular.length > 0) menu.addSeparator();
		for (const a of actions.filter((x) => x.menuOnly)) {
			menu.addItem((i) => i.setTitle(a.label).setIcon(a.icon).setWarning(a.warning === true).onClick(() => void this.guard(a.run)));
		}
		menu.showAtMouseEvent(ev);
	}

	/** The Add CSV menu, shown below its button. */
	private openAddMenu(button: HTMLElement): void {
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle(ADD_CSV_SCAN)
				.setIcon("search")
				.onClick(() => new ScanVaultModal(this.app, this.host, () => void this.refresh()).open()),
		);
		menu.addItem((i) =>
			i
				.setTitle(ADD_CSV_FROM_DEVICE)
				.setIcon("upload")
				.onClick(() => new AddCsvModal(this.app, this.host, () => void this.refresh()).open()),
		);
		const r = button.getBoundingClientRect();
		menu.showAtPosition({ x: r.left, y: r.bottom, width: r.width, overlap: true }, button.doc);
	}

	private openCsv(item: ImportSummary): void {
		const f = this.app.vault.getFileByPath(item.csvPath);
		if (f) void this.app.workspace.getLeaf("tab").openFile(f);
		else new Notice("The CSV file no longer exists.");
	}

	private openBaseFile(basePath: string): void {
		const f = this.app.vault.getFileByPath(basePath);
		if (!f) {
			new Notice("The base file no longer exists.");
			return;
		}
		void this.app.workspace.getLeaf("tab").openFile(f);
	}

	/** Runs an action, reports failures and refreshes the list afterwards. */
	private async guard(run: () => Promise<void> | void): Promise<void> {
		try {
			await run();
		} catch (e) {
			console.error("CSV Importer: index action failed", e);
			new Notice(`Something went wrong: ${errorMessage(e)}`);
		}
		await this.refresh();
	}
}
