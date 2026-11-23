import { ItemView, Menu, Notice, TFile, debounce, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type { ImportIndexHost, ImportSummary } from "../host";
import { errorMessage } from "../core/util";
import { relativeTime } from "./relativeTime";
import { iconButton } from "./dom";
import { CONFIGURE, CSV_MISSING, IMPORT_BUTTON, NO_IMPORTS_TITLE, REIMPORT_ALL, REIMPORT_BUTTON } from "./labels";

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
	private query = "";
	private loaded = false;
	private renderToken = 0;
	private listEl: HTMLElement | null = null;
	private toolsEl: HTMLElement | null = null;
	private reimportAllBtn: HTMLButtonElement | null = null;

	private readonly refreshSoon = debounce(() => void this.refresh(), 300, true);

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
		return "CSV imports";
	}

	getIcon(): string {
		return "table-properties";
	}

	async onOpen(): Promise<void> {
		const { vault, workspace } = this.app;
		this.registerEvent(vault.on("rename", () => this.refreshSoon()));
		this.registerEvent(vault.on("delete", () => this.refreshSoon()));
		this.registerEvent(vault.on("create", (f) => f instanceof TFile && f.extension === "base" && this.refreshSoon()));
		this.registerEvent(
			workspace.on("active-leaf-change", (leaf) => {
				if (leaf === this.leaf) this.refreshSoon();
			}),
		);
		this.buildShell();
		await this.refresh();
	}

	onClose(): Promise<void> {
		this.contentEl.empty();
		return Promise.resolve();
	}

	/** Reloads the list from the plugin and redraws it. */
	async refresh(): Promise<void> {
		try {
			this.items = await this.host.listImports();
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

		const tools = root.createDiv({ cls: "csv-importer-index-tools" });
		this.toolsEl = tools;
		const search = tools.createEl("input", {
			type: "search",
			cls: "csv-importer-index-search",
			attr: { placeholder: "Filter imports...", "aria-label": "Filter imports" },
		});
		search.addEventListener("input", () => {
			this.query = search.value.trim().toLowerCase();
			this.renderList();
		});
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
		if (this.reimportAllBtn) this.reimportAllBtn.disabled = !this.items.some((i) => i.exists);
		this.toolsEl?.toggleClass("csv-importer-hidden", this.loaded && this.items.length === 0);

		if (this.items.length === 0) {
			if (!this.loaded) return;
			const empty = list.createDiv({ cls: "csv-importer-index-empty" });
			setIcon(empty.createDiv({ cls: "csv-importer-index-empty-icon" }), "table-properties");
			empty.createEl("h3", { text: NO_IMPORTS_TITLE, cls: "csv-importer-index-empty-title" });
			const hint = empty.createEl("p", { cls: "csv-importer-index-empty-hint" });
			hint.appendText("Open a CSV file and choose ");
			hint.createEl("strong", { text: IMPORT_BUTTON });
			hint.appendText(" to set one up.");
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
		const row = list.createDiv({ cls: "csv-importer-index-row", attr: { role: "listitem" } });
		if (!item.exists) row.addClass("is-missing");
		const dir = item.csvPath.includes("/") ? item.csvPath.slice(0, item.csvPath.lastIndexOf("/")) : "";

		const main = row.createDiv({ cls: "csv-importer-index-main" });
		const nameLine = main.createDiv({ cls: "csv-importer-index-nameline" });
		const tip = item.targetFolder ? `${item.csvPath}\n\u2192 ${item.targetFolder}` : item.csvPath;
		const name = nameLine.createEl("button", {
			cls: "csv-importer-index-name clickable-icon-reset",
			text: item.fileName,
			attr: { type: "button", "aria-label": `Open ${item.csvPath}`, title: tip },
		});
		name.disabled = !item.exists;
		name.addEventListener("click", () => this.openCsv(item));
		if (!item.exists) {
			const warn = nameLine.createSpan({ cls: "csv-importer-index-missing" });
			setIcon(warn.createSpan({ cls: "csv-importer-index-missing-icon" }), "alert-triangle");
			warn.createSpan({ text: CSV_MISSING });
		}
		main.createDiv({ cls: "csv-importer-index-path", text: dir || "Vault root" });

		const lastText = item.lastImport ? relativeTime(item.lastImport) : "Never imported";
		const last = row.createDiv({ cls: "csv-importer-index-last", text: lastText });
		if (item.lastImport) last.setAttribute("title", new Date(item.lastImport).toLocaleString());
		const count = row.createDiv({ cls: "csv-importer-index-count", text: "..." });

		const summary = row.createDiv({ cls: "csv-importer-index-summary" });
		const setCount = (text: string): void => {
			count.setText(text);
			const parts = [dir || "Vault root", lastText];
			if (text !== "...") parts.push(`${text} ${text === "1" ? "note" : "notes"}`);
			summary.setText(parts.join(" \u00b7 "));
		};
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
				attr: { type: "button", "aria-label": `${label} ${item.fileName}` },
			});
			primary.addEventListener("click", () => void this.guard(() => this.host.reimport(item.csvPath)));
			const cfg = all.find((a) => a.id === "configure");
			if (cfg) {
				iconButton(actions, {
					icon: cfg.icon,
					label: `${cfg.label} ${item.fileName}`,
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
			actions.push({ id: "configure", label: CONFIGURE, icon: "sliders-horizontal", run: () => this.host.configureImport(item.csvPath) });
		}
		const base = item.basePath;
		if (base) {
			actions.push({ id: "base", label: "Open base", icon: "layout-list", run: () => this.openBaseFile(base) });
		}
		if (item.hasUndo) {
			actions.push({ id: "undo", label: "Undo last import", icon: "undo-2", run: () => this.host.undoImport(item.csvPath) });
		}
		actions.push({
			id: "delete",
			label: "Delete imported notes...",
			icon: "trash-2",
			menuOnly: true,
			warning: true,
			run: async () => void (await this.host.deleteImportedNotes(item.csvPath)),
		});
		actions.push({
			id: "remove",
			label: "Remove from index...",
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
