import { TFile, TFolder } from "obsidian";
import type { App, TAbstractFile } from "obsidian";

/** True for vault files. Kept here so import code does not need Obsidian classes for `instanceof`. */
export function isFile(f: TAbstractFile | null | undefined): f is TFile {
	return f instanceof TFile;
}

/** True for vault folders. */
export function isFolder(f: TAbstractFile | null | undefined): f is TFolder {
	return f instanceof TFolder;
}

/** The vault operations the importer and undo need. Implemented over Obsidian's `App`; tests can pass a fake. */
export interface VaultGateway {
	/** File or folder at the exact path (case-sensitive), or null. */
	getAbstract(path: string): TAbstractFile | null;
	/** File at the exact path, or null when missing or a folder. */
	getFile(path: string): TFile | null;
	/** Direct children of a folder ("" = vault root); null when the folder does not exist. */
	childrenOf(folderPath: string): TAbstractFile[] | null;
	/** Markdown files below a folder, recursively ("" or "/" = vault root); empty when the folder does not exist. */
	listMarkdown(folderPath: string): TFile[];
	/** Cached frontmatter of a note, if any. */
	frontmatter(file: TFile): Record<string, unknown> | undefined;
	read(file: TFile): Promise<string>;
	create(path: string, text: string): Promise<TFile>;
	createFolder(path: string): Promise<void>;
	process(file: TFile, fn: (text: string) => string): Promise<string>;
	processFrontMatter(file: TFile, fn: (frontmatter: Record<string, unknown>) => void): Promise<void>;
	/** Moves a file to the trash according to the user's setting. */
	trash(file: TFile): Promise<void>;
}

function collectMarkdown(folder: TFolder, out: TFile[]): void {
	for (const child of folder.children) {
		if (child instanceof TFile) {
			if (child.extension.toLowerCase() === "md") out.push(child);
		} else if (child instanceof TFolder) {
			collectMarkdown(child, out);
		}
	}
}

export class ObsidianVaultGateway implements VaultGateway {
	constructor(private readonly app: App) {}

	getAbstract(path: string): TAbstractFile | null {
		return this.app.vault.getAbstractFileByPath(path);
	}

	getFile(path: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	childrenOf(folderPath: string): TAbstractFile[] | null {
		const folder = folderPath === "" ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(folderPath);
		return folder instanceof TFolder ? folder.children : null;
	}

	listMarkdown(folderPath: string): TFile[] {
		const root = folderPath === "" || folderPath === "/";
		const folder = root ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(folderPath);
		const out: TFile[] = [];
		if (folder instanceof TFolder) collectMarkdown(folder, out);
		return out;
	}

	frontmatter(file: TFile): Record<string, unknown> | undefined {
		return this.app.metadataCache.getFileCache(file)?.frontmatter;
	}

	read(file: TFile): Promise<string> {
		return this.app.vault.read(file);
	}

	create(path: string, text: string): Promise<TFile> {
		return this.app.vault.create(path, text);
	}

	async createFolder(path: string): Promise<void> {
		await this.app.vault.createFolder(path);
	}

	process(file: TFile, fn: (text: string) => string): Promise<string> {
		return this.app.vault.process(file, fn);
	}

	processFrontMatter(file: TFile, fn: (frontmatter: Record<string, unknown>) => void): Promise<void> {
		return this.app.fileManager.processFrontMatter(file, fn);
	}

	trash(file: TFile): Promise<void> {
		return this.app.fileManager.trashFile(file);
	}
}
