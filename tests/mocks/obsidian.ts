/**
 * Minimal in-memory stand-in for the parts of the Obsidian API used by the import code (src/import/vaultGateway.ts, importer.ts and the Obsidian adapters).
 * Frontmatter is parsed with the `yaml` package (YAML 1.2 core schema, close to Obsidian's behaviour:
 * dates stay strings, numbers become numbers).
 */
import { parse, stringify } from "yaml";

export function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export abstract class TAbstractFile {
	constructor(public path: string) {}
	get name(): string {
		return this.path.split("/").pop() ?? "";
	}
}

export class TFile extends TAbstractFile {
	stat = { mtime: Date.now(), ctime: Date.now(), size: 0 };
	get extension(): string {
		const n = this.name;
		return n.includes(".") ? n.slice(n.lastIndexOf(".") + 1) : "";
	}
	get basename(): string {
		const n = this.name;
		return n.includes(".") ? n.slice(0, n.lastIndexOf(".")) : n;
	}
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
	isRoot(): boolean {
		return this.path === "";
	}
}

function splitFrontmatter(text: string): { fm: Record<string, unknown>; body: string } {
	const m = /^---\n([\s\S]*?)\n?---\n?([\s\S]*)$/.exec(text);
	if (!m) return { fm: {}, body: text };
	const fm = (parse(m[1]!) ?? {}) as Record<string, unknown>;
	return { fm, body: m[2] ?? "" };
}

/** In-memory vault.adapter (dir/file listing by path prefix). `mkdirDelay` simulates slow I/O to expose races. */
export class MockAdapter {
	data = new Map<string, string>();
	dirs = new Set<string>();
	writes = 0;
	mkdirCalls = 0;
	async exists(p: string): Promise<boolean> {
		return this.dirs.has(p) || this.data.has(p);
	}
	async mkdir(p: string): Promise<void> {
		this.mkdirCalls++;
		await Promise.resolve();
		if (this.dirs.has(p)) throw new Error("Folder already exists.");
		this.dirs.add(p);
	}
	async read(p: string): Promise<string> {
		const v = this.data.get(p);
		if (v === undefined) throw new Error("ENOENT");
		return v;
	}
	async write(p: string, d: string): Promise<void> {
		await Promise.resolve();
		const dir = p.slice(0, p.lastIndexOf("/"));
		if (dir && !this.dirs.has(dir)) throw new Error("ENOENT: no such directory");
		this.writes++;
		this.data.set(p, d);
	}
	async remove(p: string): Promise<void> {
		this.data.delete(p);
	}
	async list(dir: string): Promise<{ files: string[]; folders: string[] }> {
		return { files: [...this.data.keys()].filter((k) => k.startsWith(dir + "/")), folders: [] };
	}
}

export class MockVault {
	adapter = new MockAdapter();
	files = new Map<string, string>();
	private nodes = new Map<string, TAbstractFile>();
	private root = new TFolder("");

	constructor() {
		this.nodes.set("", this.root);
	}

	getRoot(): TFolder {
		return this.root;
	}

	getAbstractFileByPath(path: string): TAbstractFile | null {
		return this.nodes.get(normalizePath(path)) ?? null;
	}

	private parentFolder(path: string): TFolder {
		const i = path.lastIndexOf("/");
		const parent = i < 0 ? "" : path.slice(0, i);
		const node = this.nodes.get(parent);
		if (!(node instanceof TFolder)) throw new Error(`Parent folder missing: ${parent}`);
		return node;
	}

	async createFolder(path: string): Promise<TFolder> {
		path = normalizePath(path);
		if (this.nodes.has(path)) throw new Error("Folder already exists.");
		const f = new TFolder(path);
		this.parentFolder(path).children.push(f);
		this.nodes.set(path, f);
		return f;
	}

	async create(path: string, data: string): Promise<TFile> {
		path = normalizePath(path);
		if (this.nodes.has(path)) throw new Error("File already exists.");
		const f = new TFile(path);
		this.parentFolder(path).children.push(f);
		this.nodes.set(path, f);
		this.files.set(path, data);
		return f;
	}

	async modify(file: TFile, data: string): Promise<void> {
		this.files.set(file.path, data);
	}

	async read(file: TFile): Promise<string> {
		return this.files.get(file.path) ?? "";
	}

	async process(file: TFile, fn: (data: string) => string): Promise<string> {
		const next = fn(this.files.get(file.path) ?? "");
		this.files.set(file.path, next);
		return next;
	}

	/** Test helper: remove a note like trashing it. */
	remove(path: string): void {
		const f = this.nodes.get(path);
		if (!f) return;
		const parent = this.parentFolder(path);
		parent.children = parent.children.filter((c) => c !== f);
		this.nodes.delete(path);
		this.files.delete(path);
	}

	/** Test helper: rename a note like the user would. */
	rename(oldPath: string, newPath: string): void {
		const f = this.nodes.get(oldPath) as TFile;
		const parent = this.parentFolder(oldPath);
		parent.children = parent.children.filter((c) => c !== f);
		this.nodes.delete(oldPath);
		const content = this.files.get(oldPath) ?? "";
		this.files.delete(oldPath);
		f.path = newPath;
		this.parentFolder(newPath).children.push(f);
		this.nodes.set(newPath, f);
		this.files.set(newPath, content);
	}
}

export class MockApp {
	vault = new MockVault();
	metadataCache = {
		getFileCache: (file: TFile) => ({ frontmatter: splitFrontmatter(this.vault.files.get(file.path) ?? "").fm }),
	};
	fileManager = {
		processFrontMatter: async (file: TFile, fn: (fm: Record<string, unknown>) => void): Promise<void> => {
			const { fm, body } = splitFrontmatter(this.vault.files.get(file.path) ?? "");
			fn(fm);
			this.vault.files.set(file.path, `---\n${stringify(fm)}---\n${body}`);
		},
		trashFile: async (file: TAbstractFile): Promise<void> => {
			this.vault.remove(file.path);
		},
	};
}

export type App = MockApp;

/** Bases and other recent features are available in the mock. */
export function requireApiVersion(_version: string): boolean {
	return true;
}

/** Notice stand-in: records messages in `Notice.messages`. */
export class Notice {
	static messages: string[] = [];
	constructor(message: string, _timeout?: number) {
		Notice.messages.push(message);
	}
	setMessage(_message: string): this {
		return this;
	}
	hide(): void {}
}

/** Only referenced as a value by `instanceof`/`extends` in modules the tests stub out. */
export class MarkdownView {}
