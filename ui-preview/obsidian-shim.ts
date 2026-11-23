/* eslint-disable */
// @ts-nocheck
/**
 * Browser-side stand-in for the "obsidian" module, used only by the ui-preview harness.
 * It reproduces the DOM structure and class names Obsidian produces (Setting, Modal, Menu, Notice, views)
 * so the plugin's styles.css plus obsidian-theme.css render approximately like the real app.
 * It is NOT a full implementation: see ui-preview/README.md for the gaps.
 */

// ---------------------------------------------------------------------------------------------
// DOM helpers Obsidian adds to Node / HTMLElement / global scope
// ---------------------------------------------------------------------------------------------

function applyInfo(el: any, o: any): void {
	if (o == null) return;
	if (typeof o === "string") {
		el.className = o;
		return;
	}
	if (o.cls) {
		const list = Array.isArray(o.cls) ? o.cls : String(o.cls).split(/\s+/);
		for (const c of list) if (c) el.classList.add(c);
	}
	if (o.text != null) {
		if (typeof o.text === "string") el.textContent = o.text;
		else el.appendChild(o.text);
	}
	if (o.attr) {
		for (const [k, v] of Object.entries(o.attr)) {
			if (v === null || v === undefined || v === false) continue;
			el.setAttribute(k, v === true ? "" : String(v));
		}
	}
	if (o.title != null) el.title = o.title;
	if (o.value != null) el.value = o.value;
	if (o.type != null) el.type = o.type;
	if (o.placeholder != null) el.placeholder = o.placeholder;
	if (o.href != null) el.href = o.href;
}

function createElIn(parent: any, tag: string, o?: any, cb?: (el: any) => void): any {
	const el = document.createElement(tag);
	const info = typeof o === "string" ? { cls: o } : o || {};
	applyInfo(el, info);
	const target = info.parent || parent;
	if (target) {
		if (info.prepend) target.insertBefore(el, target.firstChild);
		else target.appendChild(el);
	}
	if (cb) cb(el);
	return el;
}

function installDomHelpers(): void {
	const N: any = Node.prototype;
	const E: any = HTMLElement.prototype;
	const S: any = SVGElement.prototype;
	if (E.__obsidianShim) return;
	E.__obsidianShim = true;

	N.empty = function () {
		while (this.firstChild) this.removeChild(this.firstChild);
	};
	N.detach = function () {
		this.remove();
	};
	N.createEl = function (tag: string, o?: any, cb?: any) {
		return createElIn(this, tag, o, cb);
	};
	N.createDiv = function (o?: any, cb?: any) {
		return createElIn(this, "div", o, cb);
	};
	N.createSpan = function (o?: any, cb?: any) {
		return createElIn(this, "span", o, cb);
	};
	N.createSvg = function (tag: string, o?: any, cb?: any) {
		const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
		applyInfo(el, o);
		this.appendChild(el);
		if (cb) cb(el);
		return el;
	};
	N.setText = function (v: any) {
		if (typeof v === "string") this.textContent = v;
		else {
			this.empty();
			this.appendChild(v);
		}
	};
	N.setAttr = function (k: string, v: any) {
		if (v === null || v === undefined || v === false) this.removeAttribute(k);
		else this.setAttribute(k, v === true ? "" : String(v));
	};
	N.setAttrs = function (o: Record<string, any>) {
		for (const [k, v] of Object.entries(o)) this.setAttr(k, v);
	};
	N.getText = function () {
		return this.textContent ?? "";
	};
	N.appendText = function (t: string) {
		this.appendChild(document.createTextNode(t));
	};
	N.addClass = function (...c: string[]) {
		this.classList.add(...c.flatMap((x) => String(x).split(/\s+/)).filter(Boolean));
	};
	N.addClasses = function (c: string[]) {
		this.addClass(...c);
	};
	N.removeClass = function (...c: string[]) {
		this.classList.remove(...c.flatMap((x) => String(x).split(/\s+/)).filter(Boolean));
	};
	N.removeClasses = function (c: string[]) {
		this.removeClass(...c);
	};
	N.toggleClass = function (c: string | string[], on: boolean) {
		for (const x of Array.isArray(c) ? c : [c]) this.classList.toggle(x, !!on);
	};
	N.hasClass = function (c: string) {
		return this.classList.contains(c);
	};
	N.find = function (sel: string) {
		return this.querySelector(sel);
	};
	N.findAll = function (sel: string) {
		return Array.from(this.querySelectorAll(sel));
	};
	N.findAllSelf = function (sel: string) {
		const r = Array.from(this.querySelectorAll(sel));
		if (this.matches?.(sel)) r.unshift(this);
		return r;
	};
	N.insertAfter = function (node: Node, ref: Node | null) {
		this.insertBefore(node, ref ? ref.nextSibling : this.firstChild);
	};
	N.show = function () {
		this.style.display = "";
		this.removeAttribute("hidden");
	};
	N.hide = function () {
		this.style.display = "none";
	};
	N.toggle = function (on: boolean) {
		on ? this.show() : this.hide();
	};
	N.toggleVisibility = function (on: boolean) {
		this.style.visibility = on ? "" : "hidden";
	};
	N.isShown = function () {
		return !!(this.offsetWidth || this.offsetHeight || this.getClientRects().length);
	};
	N.setCssStyles = function (o: Record<string, string>) {
		Object.assign(this.style, o);
	};
	N.setCssProps = function (o: Record<string, string>) {
		for (const [k, v] of Object.entries(o)) this.style.setProperty(k, v);
	};
	N.onClickEvent = function (fn: any, opts?: any) {
		this.addEventListener("click", fn, opts);
	};
	N.onNodeInserted = function (fn: any) {
		fn();
		return () => {};
	};
	N.on = function (type: string, sel: string, fn: any, opts?: any) {
		this.addEventListener(
			type,
			(ev: any) => {
				const t = ev.target?.closest?.(sel);
				if (t && this.contains(t)) fn.call(t, ev, t);
			},
			opts,
		);
	};
	Object.defineProperty(N, "instanceOf", { value: function (c: any) { return this instanceof c; }, configurable: true });
	Object.defineProperty(N, "doc", { get() { return this.ownerDocument; }, configurable: true });
	Object.defineProperty(N, "win", { get() { return this.ownerDocument.defaultView; }, configurable: true });
	for (const k of ["empty", "createEl", "createDiv", "createSpan", "createSvg", "setText", "setAttr", "setAttrs", "addClass", "removeClass", "toggleClass", "hasClass", "find", "findAll", "hide", "show", "toggle", "setCssStyles", "setCssProps"]) {
		S[k] = N[k];
	}
	(globalThis as any).createEl = (tag: string, o?: any, cb?: any) => createElIn(null, tag, o, cb);
	(globalThis as any).createDiv = (o?: any, cb?: any) => createElIn(null, "div", o, cb);
	(globalThis as any).createSpan = (o?: any, cb?: any) => createElIn(null, "span", o, cb);
	(globalThis as any).createFragment = (cb?: any) => {
		const f = document.createDocumentFragment();
		if (cb) cb(f);
		return f;
	};
	(globalThis as any).activeDocument = document;
	(globalThis as any).activeWindow = window;
	(globalThis as any).sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	(globalThis as any).nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
}
installDomHelpers();

// ---------------------------------------------------------------------------------------------
// Icons (a few lucide paths, as in Obsidian; unknown names fall back to a dot so layout stays sane)
// ---------------------------------------------------------------------------------------------

const ICONS: Record<string, string> = {
	"alert-triangle": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
	info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
	"sliders-horizontal": '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
	"file-plus": '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" x2="12" y1="18" y2="12"/><line x1="9" x2="15" y1="15" y2="15"/>',
	"undo-2": '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
	link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
	eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
	"eye-off": '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>',
	table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
	check: '<polyline points="20 6 9 17 4 12"/>',
	"chevron-down": '<path d="m6 9 6 6 6-6"/>',
	"chevron-right": '<path d="m9 18 6-6-6-6"/>',
	"chevron-left": '<path d="m15 18-6-6 6-6"/>',
	"arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
	"arrow-down": '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
	x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
	"more-vertical": '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
	"more-horizontal": '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
	"arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
	"arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
	plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
	settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
	"file-text": '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/>',
	"panel-left": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
	search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
	trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
	"layout-list": '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><path d="M14 4h7"/><path d="M14 9h7"/><path d="M14 15h7"/><path d="M14 20h7"/>',
	"trash-2": '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
	"x-circle": '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
	"table-properties": '<path d="M15 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M21 9H3"/><path d="M21 15H3"/>',
	"refresh-cw": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
};

function svgFor(name: string): string {
	const body = ICONS[name] ?? '<circle cx="12" cy="12" r="2"/>';
	return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-${name}">${body}</svg>`;
}

export function setIcon(el: HTMLElement, name: string): void {
	el.empty();
	el.insertAdjacentHTML("afterbegin", svgFor(name));
	el.setAttribute("data-icon", name);
}
export function getIcon(name: string): SVGElement | null {
	const d = document.createElement("div");
	d.innerHTML = svgFor(name);
	return d.firstElementChild as SVGElement;
}
export function setTooltip(el: HTMLElement, tip: string): void {
	el.setAttribute("aria-label", tip);
	el.title = tip;
}

// ---------------------------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------------------------

export function debounce<T extends (...a: any[]) => any>(fn: T, wait = 0, resetTimer = false) {
	let t: any = null;
	let lastArgs: any[] = [];
	const d: any = (...args: any[]) => {
		lastArgs = args;
		if (t && resetTimer) {
			clearTimeout(t);
			t = null;
		}
		if (!t) {
			t = setTimeout(() => {
				t = null;
				fn(...lastArgs);
			}, wait);
		}
		return d;
	};
	d.cancel = () => {
		if (t) clearTimeout(t);
		t = null;
		return d;
	};
	d.run = () => {
		if (t) {
			clearTimeout(t);
			t = null;
			fn(...lastArgs);
		}
		return d;
	};
	return d as T & { cancel(): any; run(): any };
}

export function normalizePath(p: string): string {
	return p.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "") || "/";
}
export function requireApiVersion(_v: string): boolean {
	return true;
}
export const apiVersion = "1.13.0";
export function sanitizeHTMLToDom(html: string): DocumentFragment {
	const t = document.createElement("template");
	t.innerHTML = html;
	return t.content;
}
export function stripHeadingForLink(s: string): string {
	return s;
}
export const Platform = {
	isDesktop: true,
	isMobile: false,
	isPhone: false,
	isTablet: false,
	isDesktopApp: true,
	isMobileApp: false,
	isMacOS: false,
	isWin: false,
	isLinux: true,
	isIosApp: false,
	isAndroidApp: false,
	isSafari: false,
	resolvePath: (p: string) => p,
};
if (typeof location !== "undefined" && /[?&]mobile=1/.test(location.search)) {
	Object.assign(Platform, { isDesktop: false, isMobile: true, isPhone: true, isDesktopApp: false, isMobileApp: true });
}

// ---------------------------------------------------------------------------------------------
// Events / Component / vault objects
// ---------------------------------------------------------------------------------------------

export class Events {
	private _l: Record<string, Function[]> = {};
	on(name: string, cb: Function) {
		(this._l[name] ||= []).push(cb);
		return { name, cb };
	}
	off(name: string, cb: Function) {
		this._l[name] = (this._l[name] || []).filter((f) => f !== cb);
	}
	offref(_r: any) {}
	trigger(name: string, ...a: any[]) {
		for (const f of this._l[name] || []) f(...a);
	}
}

export class Component {
	private _children: Component[] = [];
	private _cleanups: (() => void)[] = [];
	load() {
		this.onload();
	}
	onload() {}
	unload() {
		this.onunload();
		for (const c of this._children) c.unload();
		for (const f of this._cleanups) f();
	}
	onunload() {}
	addChild<T extends Component>(c: T): T {
		this._children.push(c);
		c.load();
		return c;
	}
	removeChild<T extends Component>(c: T): T {
		c.unload();
		return c;
	}
	register(cb: () => void) {
		this._cleanups.push(cb);
	}
	registerEvent(_e: any) {}
	registerDomEvent(el: any, type: string, cb: any, opts?: any) {
		el.addEventListener(type, cb, opts);
		this._cleanups.push(() => el.removeEventListener(type, cb, opts));
	}
	registerInterval(id: number) {
		return id;
	}
}

export class TAbstractFile {
	path = "";
	name = "";
	parent: TFolder | null = null;
	vault: any = null;
}
export class TFile extends TAbstractFile {
	basename = "";
	extension = "";
	stat = { ctime: 0, mtime: 0, size: 0 };
	constructor(path = "") {
		super();
		this.path = path;
		this.name = path.split("/").pop() ?? path;
		const dot = this.name.lastIndexOf(".");
		this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
		this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
	}
}
export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
	isRoot() {
		return this.path === "/";
	}
	constructor(path = "") {
		super();
		this.path = path;
		this.name = path.split("/").pop() ?? path;
	}
}

export class App {
	vault: any;
	workspace: any;
	metadataCache: any = { getFileCache: () => null, on: () => ({}) };
	fileManager: any = {};
	scope: any = {};
	constructor() {
		const folders = ["Imports", "Imports/timesheet", "Data", "Projects/2026"].map((p) => new TFolder(p));
		this.vault = {
			getAllFolders: () => folders,
			getAbstractFileByPath: (p: string) => folders.find((f) => f.path === p) ?? null,
			createFolder: async (p: string) => new TFolder(p),
			create: async (p: string) => new TFile(p),
			on: () => ({}),
			adapter: {},
		};
		this.workspace = {
			getLeaf: () => ({ openFile: async () => {} }),
			on: () => ({}),
			trigger: () => {},
		};
	}
}

export class Scope {
	register() {
		return {};
	}
	unregister() {}
}

// ---------------------------------------------------------------------------------------------
// Notice
// ---------------------------------------------------------------------------------------------

export class Notice {
	noticeEl: HTMLElement;
	constructor(message: string | DocumentFragment, duration = 5000) {
		let c = document.querySelector(".notice-container") as HTMLElement | null;
		if (!c) c = document.body.createDiv({ cls: "notice-container" });
		this.noticeEl = c.createDiv({ cls: "notice" });
		const msg = this.noticeEl.createDiv({ cls: "notice-message" });
		if (typeof message === "string") msg.setText(message);
		else msg.appendChild(message);
		(window as any).__notices = ((window as any).__notices || []).concat(typeof message === "string" ? message : "[fragment]");
		if (duration > 0) setTimeout(() => this.hide(), duration);
	}
	setMessage(m: string | DocumentFragment) {
		this.noticeEl.firstElementChild?.setText(m as any);
		return this;
	}
	hide() {
		this.noticeEl.remove();
	}
}

// ---------------------------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------------------------

export class Modal {
	app: App;
	scope = new Scope();
	containerEl!: HTMLElement;
	modalEl!: HTMLElement;
	titleEl!: HTMLElement;
	contentEl!: HTMLElement;
	bgEl!: HTMLElement;
	shouldRestoreSelection = false;
	private _escHandler?: (e: KeyboardEvent) => void;

	constructor(app: App) {
		this.app = app;
		this.containerEl = createDiv({ cls: "modal-container mod-dim" });
		this.bgEl = this.containerEl.createDiv({ cls: "modal-bg" });
		this.modalEl = this.containerEl.createDiv({ cls: "modal" });
		const closeBtn = this.modalEl.createDiv({ cls: "modal-close-button", attr: { "aria-label": "Close" } });
		closeBtn.addEventListener("click", () => this.close());
		const header = this.modalEl.createDiv({ cls: "modal-header" });
		this.titleEl = header.createDiv({ cls: "modal-title" });
		this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
		this.bgEl.addEventListener("click", () => this.close());
	}
	setTitle(t: string | DocumentFragment): this {
		this.titleEl.setText(t as any);
		return this;
	}
	setContent(c: string | DocumentFragment): this {
		this.contentEl.setText(c as any);
		return this;
	}
	setCloseCallback(_cb: () => void): this {
		return this;
	}
	open(): void {
		document.body.appendChild(this.containerEl);
		this._escHandler = (e) => {
			if (e.key === "Escape") this.close();
		};
		document.addEventListener("keydown", this._escHandler);
		this.onOpen();
	}
	close(): void {
		if (!this.containerEl.isConnected) return;
		if (this._escHandler) document.removeEventListener("keydown", this._escHandler);
		this.onClose();
		this.containerEl.remove();
	}
	onOpen(): void {}
	onClose(): void {}
}

// ---------------------------------------------------------------------------------------------
// Setting + components
// ---------------------------------------------------------------------------------------------

export class BaseComponent {
	disabled = false;
	then(cb: (c: this) => any): this {
		cb(this);
		return this;
	}
	setDisabled(d: boolean): this {
		this.disabled = d;
		const el: any = (this as any).inputEl || (this as any).selectEl || (this as any).buttonEl || (this as any).toggleEl;
		if (el) {
			if ("disabled" in el) el.disabled = d;
			el.toggleClass("is-disabled", d);
		}
		return this;
	}
}
export class ValueComponent extends BaseComponent {}

export class TextComponent extends ValueComponent {
	inputEl: HTMLInputElement;
	constructor(public containerEl: HTMLElement) {
		super();
		this.inputEl = containerEl.createEl("input", { attr: { type: "text", spellcheck: "false" } });
	}
	getValue() {
		return this.inputEl.value;
	}
	setValue(v: string): this {
		this.inputEl.value = v ?? "";
		return this;
	}
	setPlaceholder(p: string): this {
		this.inputEl.placeholder = p;
		return this;
	}
	onChange(cb: (v: string) => any): this {
		this.inputEl.addEventListener("input", () => cb(this.inputEl.value));
		return this;
	}
	onChanged() {}
}
export class SearchComponent extends TextComponent {
	constructor(c: HTMLElement) {
		super(c);
		this.inputEl.type = "search";
	}
	clearButtonEl = document.createElement("div");
}
export class TextAreaComponent extends ValueComponent {
	inputEl: HTMLTextAreaElement;
	constructor(public containerEl: HTMLElement) {
		super();
		this.inputEl = containerEl.createEl("textarea");
	}
	getValue() {
		return this.inputEl.value;
	}
	setValue(v: string): this {
		this.inputEl.value = v ?? "";
		return this;
	}
	setPlaceholder(p: string): this {
		this.inputEl.placeholder = p;
		return this;
	}
	onChange(cb: (v: string) => any): this {
		this.inputEl.addEventListener("input", () => cb(this.inputEl.value));
		return this;
	}
}
export class ToggleComponent extends ValueComponent {
	toggleEl: HTMLElement;
	private input: HTMLInputElement;
	private cb: ((v: boolean) => any) | null = null;
	value = false;
	constructor(public containerEl: HTMLElement) {
		super();
		this.toggleEl = containerEl.createDiv({ cls: "checkbox-container", attr: { tabindex: "0", role: "switch" } });
		this.input = this.toggleEl.createEl("input", { attr: { type: "checkbox", tabindex: "-1" } });
		this.toggleEl.addEventListener("click", (e) => {
			e.preventDefault();
			if (this.disabled) return;
			this.setValue(!this.value);
			this.cb?.(this.value);
		});
		this.toggleEl.addEventListener("keydown", (e) => {
			if (e.key === " " || e.key === "Enter") {
				e.preventDefault();
				this.toggleEl.click();
			}
		});
	}
	getValue() {
		return this.value;
	}
	setValue(v: boolean): this {
		this.value = !!v;
		this.toggleEl.toggleClass("is-enabled", this.value);
		this.toggleEl.setAttribute("aria-checked", String(this.value));
		this.input.checked = this.value;
		return this;
	}
	onChange(cb: (v: boolean) => any): this {
		this.cb = cb;
		return this;
	}
}
export class DropdownComponent extends ValueComponent {
	selectEl: HTMLSelectElement;
	constructor(public containerEl: HTMLElement) {
		super();
		this.selectEl = containerEl.createEl("select", { cls: "dropdown" });
	}
	addOption(value: string, display: string): this {
		this.selectEl.createEl("option", { value, text: display });
		return this;
	}
	addOptions(o: Record<string, string>): this {
		for (const [k, v] of Object.entries(o)) this.addOption(k, v);
		return this;
	}
	getValue() {
		return this.selectEl.value;
	}
	setValue(v: string): this {
		this.selectEl.value = v;
		return this;
	}
	onChange(cb: (v: string) => any): this {
		this.selectEl.addEventListener("change", () => cb(this.selectEl.value));
		return this;
	}
}
export class SliderComponent extends ValueComponent {
	sliderEl: HTMLInputElement;
	constructor(public containerEl: HTMLElement) {
		super();
		this.sliderEl = containerEl.createEl("input", { cls: "slider", attr: { type: "range" } });
	}
	setLimits(min: number, max: number, step: number | "any"): this {
		Object.assign(this.sliderEl, { min: String(min), max: String(max), step: String(step) });
		return this;
	}
	setValue(v: number): this {
		this.sliderEl.value = String(v);
		return this;
	}
	getValue() {
		return Number(this.sliderEl.value);
	}
	setDynamicTooltip(): this {
		return this;
	}
	onChange(cb: (v: number) => any): this {
		this.sliderEl.addEventListener("input", () => cb(this.getValue()));
		return this;
	}
}
export class ButtonComponent extends BaseComponent {
	buttonEl: HTMLButtonElement;
	constructor(public containerEl: HTMLElement) {
		super();
		this.buttonEl = containerEl.createEl("button");
	}
	setButtonText(t: string): this {
		this.buttonEl.setText(t);
		return this;
	}
	setIcon(name: string): this {
		setIcon(this.buttonEl, name);
		return this;
	}
	setCta(): this {
		this.buttonEl.addClass("mod-cta");
		return this;
	}
	removeCta(): this {
		this.buttonEl.removeClass("mod-cta");
		return this;
	}
	setWarning(): this {
		this.buttonEl.addClass("mod-warning");
		return this;
	}
	setDestructive(): this {
		this.buttonEl.addClass("mod-warning");
		return this;
	}
	setTooltip(t: string): this {
		setTooltip(this.buttonEl, t);
		return this;
	}
	setClass(c: string): this {
		this.buttonEl.addClass(c);
		return this;
	}
	onClick(cb: (e: MouseEvent) => any): this {
		this.buttonEl.addEventListener("click", cb);
		return this;
	}
}
export class ExtraButtonComponent extends BaseComponent {
	extraSettingsEl: HTMLElement;
	constructor(public containerEl: HTMLElement) {
		super();
		this.extraSettingsEl = containerEl.createDiv({ cls: "clickable-icon extra-setting-button", attr: { role: "button", tabindex: "0" } });
	}
	setIcon(name: string): this {
		setIcon(this.extraSettingsEl, name);
		return this;
	}
	setTooltip(t: string): this {
		setTooltip(this.extraSettingsEl, t);
		return this;
	}
	onClick(cb: () => any): this {
		this.extraSettingsEl.addEventListener("click", cb);
		return this;
	}
}

export class Setting {
	settingEl: HTMLElement;
	infoEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;
	components: BaseComponent[] = [];
	constructor(public containerEl: HTMLElement) {
		this.settingEl = containerEl.createDiv({ cls: "setting-item" });
		this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
		this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name" });
		this.descEl = this.infoEl.createDiv({ cls: "setting-item-description" });
		this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
	}
	setName(n: string | DocumentFragment): this {
		this.nameEl.setText(n as any);
		return this;
	}
	setDesc(d: string | DocumentFragment): this {
		this.descEl.setText(d as any);
		return this;
	}
	setClass(c: string): this {
		this.settingEl.addClass(c);
		return this;
	}
	setTooltip(t: string): this {
		setTooltip(this.settingEl, t);
		return this;
	}
	setHeading(): this {
		this.settingEl.addClass("setting-item-heading");
		return this;
	}
	setDisabled(d: boolean): this {
		this.settingEl.toggleClass("is-disabled", d);
		return this;
	}
	then(cb: (s: this) => any): this {
		cb(this);
		return this;
	}
	clear(): this {
		this.controlEl.empty();
		this.components = [];
		return this;
	}
	private add<T extends BaseComponent>(c: T, cb?: (c: T) => any): this {
		this.components.push(c);
		cb?.(c);
		return this;
	}
	addText(cb: (c: TextComponent) => any) {
		return this.add(new TextComponent(this.controlEl), cb);
	}
	addSearch(cb: (c: SearchComponent) => any) {
		return this.add(new SearchComponent(this.controlEl), cb);
	}
	addTextArea(cb: (c: TextAreaComponent) => any) {
		return this.add(new TextAreaComponent(this.controlEl), cb);
	}
	addToggle(cb: (c: ToggleComponent) => any) {
		this.settingEl.addClass("mod-toggle");
		return this.add(new ToggleComponent(this.controlEl), cb);
	}
	addDropdown(cb: (c: DropdownComponent) => any) {
		this.settingEl.addClass("mod-dropdown");
		return this.add(new DropdownComponent(this.controlEl), cb);
	}
	addSlider(cb: (c: SliderComponent) => any) {
		return this.add(new SliderComponent(this.controlEl), cb);
	}
	addButton(cb: (c: ButtonComponent) => any) {
		return this.add(new ButtonComponent(this.controlEl), cb);
	}
	addExtraButton(cb: (c: ExtraButtonComponent) => any) {
		return this.add(new ExtraButtonComponent(this.controlEl), cb);
	}
	addComponent<T extends BaseComponent>(cb: (el: HTMLElement) => T) {
		return this.add(cb(this.controlEl));
	}
}
export class SettingGroup {
	constructor(public containerEl: HTMLElement) {}
	setHeading(h: string) {
		return this;
	}
	addSetting(cb: (s: Setting) => any) {
		cb(new Setting(this.containerEl));
		return this;
	}
}

// ---------------------------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------------------------

export class MenuItem {
	dom: HTMLElement;
	private iconEl: HTMLElement;
	private titleEl: HTMLElement;
	constructor(parent: HTMLElement) {
		this.dom = parent.createDiv({ cls: "menu-item tappable" });
		this.iconEl = this.dom.createDiv({ cls: "menu-item-icon" });
		this.titleEl = this.dom.createDiv({ cls: "menu-item-title" });
	}
	setTitle(t: string | DocumentFragment) {
		this.titleEl.setText(t as any);
		return this;
	}
	setIcon(name: string | null) {
		if (name) setIcon(this.iconEl, name);
		return this;
	}
	setChecked(c: boolean | null) {
		if (c) {
			this.dom.addClass("is-checked");
			setIcon(this.iconEl, "check");
		}
		return this;
	}
	setSection(_s: string) {
		return this;
	}
	setDisabled(d: boolean) {
		this.dom.toggleClass("is-disabled", d);
		return this;
	}
	setWarning(w: boolean) {
		this.dom.toggleClass("is-warning", w);
		return this;
	}
	setIsLabel(_l: boolean) {
		return this;
	}
	onClick(cb: (e: MouseEvent | KeyboardEvent) => any) {
		this.dom.addEventListener("click", (e) => {
			e.stopPropagation();
			cb(e);
			(this.dom.closest(".menu") as any)?.__menu?.hide();
		});
		return this;
	}
}
export class Menu {
	dom: HTMLElement;
	private onDoc?: (e: Event) => void;
	constructor() {
		this.dom = createDiv({ cls: "menu" });
		(this.dom as any).__menu = this;
	}
	addItem(cb: (i: MenuItem) => any) {
		cb(new MenuItem(this.dom));
		return this;
	}
	addSeparator() {
		this.dom.createDiv({ cls: "menu-separator" });
		return this;
	}
	setNoIcon() {
		return this;
	}
	setUseNativeMenu(_b: boolean) {
		return this;
	}
	onHide(_cb: () => void) {}
	showAtMouseEvent(ev: MouseEvent) {
		return this.showAtPosition({ x: ev.clientX, y: ev.clientY });
	}
	showAtPosition(pos: { x: number; y: number }) {
		document.body.appendChild(this.dom);
		const r = this.dom.getBoundingClientRect();
		const x = Math.max(4, Math.min(pos.x, window.innerWidth - r.width - 4));
		const y = Math.max(4, Math.min(pos.y, window.innerHeight - r.height - 4));
		this.dom.style.left = x + "px";
		this.dom.style.top = y + "px";
		this.onDoc = (e) => {
			if (!this.dom.contains(e.target as Node)) this.hide();
		};
		setTimeout(() => document.addEventListener("mousedown", this.onDoc!), 0);
		return this;
	}
	hide() {
		if (this.onDoc) document.removeEventListener("mousedown", this.onDoc);
		this.dom.remove();
		return this;
	}
	close() {
		this.hide();
	}
}

// ---------------------------------------------------------------------------------------------
// Suggest
// ---------------------------------------------------------------------------------------------

export class AbstractInputSuggest<T> {
	constructor(public app: App, public textInputEl: HTMLElement | HTMLInputElement) {}
	getSuggestions(_q: string): T[] | Promise<T[]> {
		return [];
	}
	renderSuggestion(_v: T, _el: HTMLElement): void {}
	selectSuggestion(_v: T, _ev: MouseEvent | KeyboardEvent): void {}
	setValue(v: string) {
		(this.textInputEl as HTMLInputElement).value = v;
	}
	getValue() {
		return (this.textInputEl as HTMLInputElement).value;
	}
	open() {}
	close() {}
	onSelect(_cb: any) {
		return this;
	}
}
export class PopoverSuggest<T> extends AbstractInputSuggest<T> {}
export class SuggestModal<T> extends Modal {}
export class FuzzySuggestModal<T> extends Modal {}

// ---------------------------------------------------------------------------------------------
// Views / workspace
// ---------------------------------------------------------------------------------------------

export class WorkspaceLeaf extends Component {
	view: any = null;
	containerEl: HTMLElement;
	app: App;
	constructor(app?: App) {
		super();
		this.app = app ?? new App();
		this.containerEl = createDiv({ cls: "workspace-leaf" });
	}
	getViewState() {
		return {};
	}
	async openFile(_f: TFile) {}
}

export class View extends Component {
	app: App;
	containerEl: HTMLElement;
	contentEl: HTMLElement;
	headerEl: HTMLElement;
	titleContainerEl: HTMLElement;
	titleEl: HTMLElement;
	actionsEl: HTMLElement;
	icon = "";
	navigation = true;
	constructor(public leaf: WorkspaceLeaf) {
		super();
		this.app = leaf.app;
		this.containerEl = leaf.containerEl.createDiv({ cls: "workspace-leaf-content" });
		this.headerEl = this.containerEl.createDiv({ cls: "view-header" });
		const left = this.headerEl.createDiv({ cls: "view-header-nav-buttons" });
		for (const n of ["arrow-left", "arrow-right"]) {
			const b = left.createDiv({ cls: "clickable-icon", attr: { "aria-label": n === "arrow-left" ? "Navigate back" : "Navigate forward" } });
			setIcon(b, n);
		}
		this.titleContainerEl = this.headerEl.createDiv({ cls: "view-header-title-container mod-at-start" });
		this.titleEl = this.titleContainerEl.createDiv({ cls: "view-header-title-parent" }).createDiv({ cls: "view-header-title" });
		this.actionsEl = this.headerEl.createDiv({ cls: "view-actions" });
		this.contentEl = this.containerEl.createDiv({ cls: "view-content" });
		leaf.view = this;
	}
	getViewType(): string {
		return "";
	}
	getDisplayText(): string {
		return "";
	}
	getIcon(): string {
		return "document";
	}
	onOpen(): Promise<void> | void {}
	onClose(): Promise<void> | void {}
	addAction(icon: string, title: string, cb: (e: MouseEvent) => any): HTMLElement {
		const el = this.actionsEl.createDiv({ cls: "clickable-icon view-action", attr: { "aria-label": title, role: "button" } });
		setIcon(el, icon);
		el.addEventListener("click", cb);
		this.actionsEl.insertBefore(el, this.actionsEl.querySelector(".view-action-more"));
		return el;
	}
	/** harness-only: refresh title and add the trailing "more options" icon. */
	refreshHeader() {
		this.titleEl.setText(this.getDisplayText());
		if (!this.actionsEl.querySelector(".view-action-more")) {
			const more = this.actionsEl.createDiv({ cls: "clickable-icon view-action view-action-more", attr: { "aria-label": "More options" } });
			setIcon(more, "more-vertical");
		}
	}
}
export class ItemView extends View {}
export class FileView extends ItemView {
	file: TFile | null = null;
	allowNoFile = false;
}
export class EditableFileView extends FileView {}
export abstract class TextFileView extends EditableFileView {
	data = "";
	requestSave = () => {};
	getViewData(): string {
		return this.data;
	}
	setViewData(data: string, _clear: boolean): void {
		this.data = data;
	}
	clear(): void {}
	save(_clear?: boolean): Promise<void> {
		return Promise.resolve();
	}
}
export class MarkdownView extends TextFileView {}

export class Plugin extends Component {
	app: App;
	manifest: any = { id: "csv-importer", name: "CSV Importer", version: "0.0.0" };
	constructor(app?: App) {
		super();
		this.app = app ?? new App();
	}
	async loadData() {
		return null;
	}
	async saveData(_d: any) {}
	addCommand(_c: any) {}
	addSettingTab(_t: any) {}
	registerView(_t: string, _c: any) {}
	registerExtensions(_e: string[], _v: string) {}
	addRibbonIcon(_i: string, _t: string, _c: any) {
		return createDiv();
	}
	addStatusBarItem() {
		return createDiv();
	}
}

export class PluginSettingTab {
	containerEl: HTMLElement;
	icon = "";
	constructor(public app: App, public plugin: any) {
		this.containerEl = createDiv({ cls: "vertical-tab-content" });
	}
	display(): void {}
	hide(): void {
		this.containerEl.empty();
	}
}
export class SettingTab extends PluginSettingTab {}

// Misc names plugins commonly import; harmless placeholders.
export const moment: any = (d?: any) => ({ format: (f: string) => String(new Date(d ?? Date.now()).toISOString()), valueOf: () => +new Date(d ?? Date.now()) });
export class MarkdownRenderer {
	static render(_app: any, md: string, el: HTMLElement) {
		el.setText(md);
		return Promise.resolve();
	}
	static renderMarkdown(md: string, el: HTMLElement) {
		el.setText(md);
		return Promise.resolve();
	}
}
export function prepareFuzzySearch(q: string) {
	return (t: string) => (t.toLowerCase().includes(q.toLowerCase()) ? { score: 0, matches: [] } : null);
}
export function prepareSimpleSearch(q: string) {
	return prepareFuzzySearch(q);
}
export function parseYaml(s: string) {
	return {};
}
export function stringifyYaml(o: any) {
	return JSON.stringify(o);
}
export function addIcon(name: string, svg: string) {
	ICONS[name] = svg;
}
export function getFrontMatterInfo() {
	return { exists: false };
}
export function requestUrl() {
	return Promise.reject(new Error("requestUrl is not available in ui-preview"));
}
