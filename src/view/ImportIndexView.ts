import { ItemView, Menu, Notice, TFile, debounce, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type { ImportIndexHost, ImportSummary } from "../host";
import { errorMessage } from "../core/util";
import { relativeTime } from "./relativeTime";

export const VIEW_TYPE_IMPORT_INDEX = "csv-importer-index";

/** Width below which row actions collapse into the "..." menu. Keep in sync with styles.css. */
const NARROW_PX = 600;

interface RowAction {
	id: string;
	label: string;
	icon: string;
	run: () => Promise<void> | void;
	/** Only in the "..." menu on wide views. */
	menuOnly?: boolean;
	/** Stays visible when the view is narrow. */
	alwaysVisible?: boolean;
	warning?: boolean;
}

/** Index of every CSV with saved import settings: re-import, configure, undo and bulk delete from one place. */
export class ImportIndexView extends ItemView {
	private items: ImportSummary[] = [];
	private query = "";
	private loaded = false;
	private renderToken = 0;
	private listEl: HTMLElement | null = null;
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

		const header = root.createDiv({ cls: "csv-importer-index-header" });
		const titles = header.createDiv({ cls: "csv-importer-index-titles" });
		titles.createEl("h2", { text: "CSV imports", cls: "csv-importer-index-title" });
		titles.createEl("p", { text: "Every CSV file with saved import settings.", cls: "csv-importer-index-desc" });

		const tools = header.createDiv({ cls: "csv-importer-index-tools" });
		const search = tools.createEl("input", {
			type: "search",
			cls: "csv-importer-index-search",
			attr: { placeholder: "Filter imports...", "aria-label": "Filter imports" },
		});
		search.addEventListener("input", () => {
			this.query = search.value.trim().toLowerCase();
			this.renderList();
		});
		const all = tools.createEl("button", { cls: "csv-importer-index-all", text: "Re-import all" });
		all.addEventListener("click", () => void this.guard(() => this.host.reimportAll()));
		this.reimportAllBtn = all;

		this.listEl = root.createDiv({ cls: "csv-importer-index-list", attr: { role: "list" } });
	}

	private renderList(): void {
		const list = this.listEl;
		if (!list) return;
		const token = ++this.renderToken;
		list.empty();
		if (this.reimportAllBtn) this.reimportAllBtn.disabled = !this.items.some((i) => i.exists);

		if (this.items.length === 0) {
			if (!this.loaded) return;
			const empty = list.createDiv({ cls: "csv-importer-index-empty" });
			empty.appendText("No imports yet. Open a CSV file and click ");
			empty.createEl("strong", { text: "Import" });
			empty.appendText(" to get started.");
			return;
		}
		const visible = this.items.filter(
			(i) => !this.query || i.csvPath.toLowerCase().includes(this.query),
		);
		if (visible.length === 0) {
			list.createDiv({ cls: "csv-importer-index-empty", text: "No imports match your filter." });
			return;
		}
		for (const item of visible) this.renderRow(list, item, token);
	}

	private renderRow(list: HTMLElement, item: ImportSummary, token: number): void {
		const row = list.createDiv({ cls: "csv-importer-index-row", attr: { role: "listitem" } });
		if (!item.exists) row.addClass("is-missing");

		const main = row.createDiv({ cls: "csv-importer-index-main" });
		const name = main.createEl("button", {
			cls: "csv-importer-index-name clickable-icon-reset",
			text: item.fileName,
			attr: { "aria-label": `Open ${item.csvPath}`, title: item.csvPath },
		});
		name.disabled = !item.exists;
		name.addEventListener("click", () => this.openCsv(item));
		const dir = item.csvPath.includes("/") ? item.csvPath.slice(0, item.csvPath.lastIndexOf("/")) : "";
		main.createDiv({ cls: "csv-importer-index-path", text: dir || "Vault root" });

		const badges = main.createDiv({ cls: "csv-importer-index-badges" });
		if (!item.exists) badges.createSpan({ cls: "csv-importer-badge mod-warning", text: "CSV missing" });
		if (item.hasUndo) badges.createSpan({ cls: "csv-importer-badge", text: "Undo available" });

		const meta = row.createDiv({ cls: "csv-importer-index-meta" });
		this.metaLine(meta, "Target folder", item.targetFolder || "Not set");
		const last = this.metaLine(meta, "Last import", item.lastImport ? relativeTime(item.lastImport) : "Never imported");
		if (item.lastImport) last.setAttribute("title", new Date(item.lastImport).toLocaleString());
		const count = this.metaLine(meta, "Notes", "...");
		void this.host
			.countImportedNotes(item.csvPath)
			.then((n) => {
				if (token === this.renderToken) count.setText(String(n));
			})
			.catch(() => {
				if (token === this.renderToken) count.setText("?");
			});

		const actions = row.createDiv({ cls: "csv-importer-index-actions" });
		const all = this.actionsFor(item);
		for (const a of all.filter((x) => !x.menuOnly)) {
			const btn = actions.createEl("button", {
				cls: `csv-importer-index-action mod-${a.id}${a.alwaysVisible ? " is-always" : ""}`,
				attr: { "aria-label": a.label, title: a.label },
			});
			setIcon(btn.createSpan({ cls: "csv-importer-index-action-icon" }), a.icon);
			btn.createSpan({ cls: "csv-importer-index-action-text", text: a.label });
			btn.addEventListener("click", () => void this.guard(a.run));
		}
		const more = actions.createEl("button", {
			cls: "csv-importer-index-action mod-more",
			attr: { "aria-label": `More actions for ${item.fileName}`, "aria-haspopup": "menu", title: "More actions" },
		});
		setIcon(more.createSpan({ cls: "csv-importer-index-action-icon" }), "more-horizontal");
		more.addEventListener("click", (ev) => this.openMenu(ev, all));
	}

	private metaLine(parent: HTMLElement, label: string, value: string): HTMLElement {
		const line = parent.createDiv({ cls: "csv-importer-index-meta-line" });
		line.createSpan({ cls: "csv-importer-index-meta-label", text: label });
		return line.createSpan({ cls: "csv-importer-index-meta-value", text: value });
	}

	private actionsFor(item: ImportSummary): RowAction[] {
		const actions: RowAction[] = [];
		if (item.exists) {
			actions.push({ id: "reimport", label: "Re-import", icon: "refresh-cw", alwaysVisible: true, run: () => this.host.reimport(item.csvPath) });
			actions.push({ id: "configure", label: "Configure", icon: "settings", run: () => this.host.configureImport(item.csvPath) });
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
		const narrow = this.contentEl.clientWidth > 0 && this.contentEl.clientWidth < NARROW_PX;
		const menu = new Menu();
		const inline = actions.filter((a) => !a.menuOnly && !a.alwaysVisible);
		if (narrow) {
			for (const a of inline) menu.addItem((i) => i.setTitle(a.label).setIcon(a.icon).onClick(() => void this.guard(a.run)));
			if (inline.length > 0) menu.addSeparator();
		}
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
