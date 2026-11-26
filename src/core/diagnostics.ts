import type { TraceEntry } from "./trace";
import { formatTrace } from "./trace";

/** What a diagnostics report contains. No row content: paths, counts, settings and the trace only. */
export interface DiagnosticsInfo {
	pluginVersion: string;
	obsidianVersion: string;
	platform: string;
	/** Epoch ms when the report was made. */
	now: number;
	settings: Record<string, unknown>;
	imports: {
		csvPath: string;
		exists: boolean;
		lastImport: number | null;
		hasUndo: boolean;
		/** Parts of the import state that could not be read. */
		unreadable: string[];
		lastRun: string | null;
	}[];
	trace: TraceEntry[];
}

/** The note written by "Save diagnostics report": Markdown, meant to be attached to a bug report. */
export function buildDiagnosticsReport(info: DiagnosticsInfo): string {
	const when = (t: number | null) => (t === null ? "never" : new Date(t).toISOString());
	const lines = [
		"# CSV Importer diagnostics",
		"",
		"Attach this note to a bug report. It holds versions, settings, the paths of your CSV imports and the plugin's recent steps; no row content.",
		"",
		"## Versions",
		"",
		`- CSV Importer: ${info.pluginVersion}`,
		`- Obsidian: ${info.obsidianVersion}`,
		`- Platform: ${info.platform}`,
		`- Report made: ${new Date(info.now).toISOString()}`,
		"",
		"## Settings",
		"",
		"```json",
		JSON.stringify(info.settings, null, 2),
		"```",
		"",
		`## CSV imports (${info.imports.length})`,
		"",
	];
	if (info.imports.length === 0) lines.push("None.");
	else {
		lines.push("| CSV | Exists | Last import | Undo | Unreadable state | Last run |", "| --- | --- | --- | --- | --- | --- |");
		for (const i of info.imports) {
			const cells = [i.csvPath, i.exists ? "yes" : "no", when(i.lastImport), i.hasUndo ? "yes" : "no", i.unreadable.join(", ") || "-", i.lastRun ?? "-"];
			lines.push(`| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`);
		}
	}
	lines.push("", `## Recent steps (${info.trace.length})`, "", "```text", formatTrace(info.trace) || "(none)", "```", "");
	return lines.join("\n");
}

/** File name of a report made at `now`, e.g. "CSV Importer diagnostics 2026-11-26 17-05.md". */
export function diagnosticsFileName(now: number): string {
	const d = new Date(now);
	const p = (n: number) => String(n).padStart(2, "0");
	return `CSV Importer diagnostics ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}.md`;
}
