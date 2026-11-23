import { debounce } from "obsidian";
import type { TFile } from "obsidian";
import type { CsvImporterHost } from "../../host";
import type { FileImportConfig, ParsedCsv } from "../../types";
import { parseCsv } from "../../csv/parser";
import { inferColumnType, prepareConfig } from "../../csv/typeInference";
import { errorMessage } from "../../core/util";
import { inferenceOptions } from "../shared";

/**
 * What changed, from cheapest to most expensive to refresh:
 * - preview: the note preview and status line
 * - columns: the column table (and everything under "preview")
 * - parsing: the CSV was parsed again (everything under "columns", plus chips, key list, warnings)
 */
export type DraftEvent = "preview" | "columns" | "parsing";

export function cloneConfig(cfg: FileImportConfig): FileImportConfig {
	return { ...cfg, columns: cfg.columns.map((c) => ({ ...c })) };
}

/** Working state of the import settings dialog, shared by its sections. */
export class ConfigDraft {
	readonly cfg: FileImportConfig;
	/** Decoded CSV text; replaced when the encoding changes. */
	text: string;
	parsed: ParsedCsv | null = null;
	parseError: string | null = null;
	previewRow = 0;
	detectedEncoding: string | null = null;

	private readonly listeners: Record<DraftEvent, (() => void)[]> = { parsing: [], columns: [], preview: [] };
	private readonly debouncedPreview = debounce(() => this.emit("preview"), 150, true);

	constructor(
		readonly host: CsvImporterHost,
		readonly file: TFile,
		text: string,
	) {
		this.cfg = cloneConfig(host.getFileConfig(file));
		this.text = text;
	}

	on(event: DraftEvent, fn: () => void): void {
		this.listeners[event].push(fn);
	}

	/** Notify the sections. A "parsing" change also refreshes columns and preview; "columns" also the preview. */
	emit(event: DraftEvent): void {
		const order: DraftEvent[] = event === "parsing" ? ["parsing", "columns", "preview"] : event === "columns" ? ["columns", "preview"] : ["preview"];
		for (const e of order) for (const fn of this.listeners[e]) fn();
	}

	/** Same as emit("preview"), but coalesces rapid keystrokes. */
	emitPreviewDebounced(): void {
		this.debouncedPreview();
	}

	/** Re-parse the CSV with the working config and reconcile columns. */
	reparse(): void {
		this.parseError = null;
		this.parsed = null;
		try {
			if (this.text.trim().length > 0) {
				this.parsed = parseCsv(this.text, { delimiter: this.cfg.delimiter, hasHeader: this.cfg.hasHeader });
				prepareConfig(this.cfg, this.parsed, this.host.settings.midnightAsDate);
			} else {
				this.cfg.columns = [];
			}
		} catch (e) {
			this.parseError = errorMessage(e);
		}
	}

	/** Parsing options changed: parse again and refresh every section. */
	reparseAndNotify(): void {
		this.reparse();
		this.emit("parsing");
	}

	/** True when the parse result looks wrong, so the parsing options are worth a look. */
	looksWrong(): boolean {
		if (this.parseError) return true;
		if (this.text.includes("�")) return true;
		if (!this.parsed) return false;
		return this.parsed.headers.length === 1 || this.parsed.warnings.length > 0;
	}

	/** Detect the type of every column again. */
	redetectTypes(): void {
		if (!this.parsed) return;
		const opts = inferenceOptions(this.cfg, this.host.settings);
		for (const col of this.cfg.columns) {
			const values = this.parsed.rows.map((r) => r[col.index] ?? "");
			col.type = inferColumnType(values, opts);
		}
		this.emit("columns");
	}
}
