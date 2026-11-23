import { TAB_CHANGED } from "./copy";

export interface TabDef {
	id: string;
	label: string;
}

/** Accessible tab bar (role=tablist) with one tabpanel per tab. Arrow keys, Home and End move between tabs. */
export class Tabs {
	readonly panels = new Map<string, HTMLElement>();
	private readonly tabEls = new Map<string, HTMLButtonElement>();
	private readonly dots = new Map<string, HTMLElement>();
	private current: string;

	constructor(
		barParent: HTMLElement,
		panelParent: HTMLElement,
		private readonly tabs: TabDef[],
		idPrefix: string,
		private readonly onSelect?: (id: string) => void,
	) {
		this.current = tabs[0]?.id ?? "";
		const bar = barParent.createDiv({ cls: "csv-importer-tabs", attr: { role: "tablist" } });
		for (const t of tabs) {
			const btn = bar.createEl("button", {
				cls: "csv-importer-tab",
				attr: { type: "button", role: "tab", id: `${idPrefix}-tab-${t.id}`, "aria-controls": `${idPrefix}-panel-${t.id}` },
			});
			btn.createSpan({ text: t.label });
			this.dots.set(t.id, btn.createSpan({ cls: "csv-importer-tab-dot csv-importer-hidden", attr: { "aria-hidden": "true" } }));
			btn.addEventListener("click", () => this.select(t.id));
			btn.addEventListener("keydown", (ev) => this.onKey(ev, t.id));
			this.tabEls.set(t.id, btn);
			const panel = panelParent.createDiv({
				cls: "csv-importer-tabpanel",
				attr: { role: "tabpanel", id: `${idPrefix}-panel-${t.id}`, "aria-labelledby": `${idPrefix}-tab-${t.id}`, tabindex: "-1" },
			});
			this.panels.set(t.id, panel);
		}
		this.apply();
	}

	get selected(): string {
		return this.current;
	}

	select(id: string, focus = false): void {
		if (!this.panels.has(id)) return;
		this.current = id;
		this.apply();
		if (focus) this.tabEls.get(id)?.focus();
		this.onSelect?.(id);
	}

	/** Mark a tab whose settings differ from the defaults. */
	setChanged(id: string, changed: boolean): void {
		const dot = this.dots.get(id);
		const tab = this.tabEls.get(id);
		const label = this.tabs.find((t) => t.id === id)?.label ?? "";
		if (!dot || !tab) return;
		dot.toggleClass("csv-importer-hidden", !changed);
		if (changed) tab.setAttr("aria-label", `${label}, ${TAB_CHANGED}`);
		else tab.removeAttribute("aria-label");
	}

	private apply(): void {
		for (const t of this.tabs) {
			const on = t.id === this.current;
			const btn = this.tabEls.get(t.id);
			btn?.setAttr("aria-selected", String(on));
			btn?.setAttr("tabindex", on ? "0" : "-1");
			btn?.toggleClass("is-active", on);
			this.panels.get(t.id)?.toggleClass("csv-importer-hidden", !on);
		}
	}

	private onKey(ev: KeyboardEvent, id: string): void {
		const i = this.tabs.findIndex((t) => t.id === id);
		let next = -1;
		if (ev.key === "ArrowRight") next = (i + 1) % this.tabs.length;
		else if (ev.key === "ArrowLeft") next = (i - 1 + this.tabs.length) % this.tabs.length;
		else if (ev.key === "Home") next = 0;
		else if (ev.key === "End") next = this.tabs.length - 1;
		if (next < 0) return;
		ev.preventDefault();
		this.select(this.tabs[next].id, true);
	}
}
