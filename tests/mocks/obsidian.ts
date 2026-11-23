/**
 * Minimal in-memory stand-in for the parts of the Obsidian API used by src/import/importer.ts.
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
	const fm = (parse(m[1]) ?? {}) as Record<string, unknown>;
	return { fm, body: m[2] };
}

export class MockVault {
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
	};
}

export type App = MockApp;
