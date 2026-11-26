/**
 * A short in-memory record of what the plugin did (actions, steps of an import or undo, state that could not be read
 * or written), to pinpoint problems: it goes into the diagnostics report and the end-to-end test failure reports.
 * Entries hold paths, counts and error messages, never row content. With the "debug log" setting on, every entry is
 * also printed to the developer console.
 */

export interface TraceEntry {
	/** Epoch ms. */
	t: number;
	/** Area, e.g. "import", "index", "storage". */
	scope: string;
	message: string;
	/** Small details: paths, counts, outcomes. */
	data?: Record<string, unknown>;
}

/** Entries kept; older ones are dropped. */
export const TRACE_LIMIT = 500;

const entries: TraceEntry[] = [];
let toConsole = false;

/** Prints new entries to the developer console (`console.debug`) or stops doing so. */
export function setTraceToConsole(on: boolean): void {
	toConsole = on;
}

/** Records one step. Cheap: keep `data` to a few small values. */
export function trace(scope: string, message: string, data?: Record<string, unknown>): void {
	const entry: TraceEntry = data === undefined ? { t: Date.now(), scope, message } : { t: Date.now(), scope, message, data };
	entries.push(entry);
	if (entries.length > TRACE_LIMIT) entries.splice(0, entries.length - TRACE_LIMIT);
	if (toConsole) console.debug(`CSV Importer [${scope}] ${message}`, data ?? "");
}

/** Records a failure with its message (and the first stack line, which names where it happened). */
export function traceError(scope: string, message: string, error: unknown, data?: Record<string, unknown>): void {
	const err = error instanceof Error ? error : null;
	const where = err?.stack?.split("\n")[1]?.trim();
	trace(scope, message, { ...data, error: err ? `${err.name}: ${err.message}` : String(error), ...(where ? { at: where } : {}) });
}

/** A copy of the recorded entries, oldest first. */
export function traceEntries(): TraceEntry[] {
	return entries.map((e) => ({ ...e }));
}

/** Clears the record (tests). */
export function clearTrace(): void {
	entries.length = 0;
}

/** One line per entry: `12:00:01.234 [scope] message {"key":"value"}`. */
export function formatTrace(list: readonly TraceEntry[] = entries): string {
	return list
		.map((e) => {
			const d = new Date(e.t);
			const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
			return `${time} [${e.scope}] ${e.message}${e.data ? ` ${JSON.stringify(e.data)}` : ""}`;
		})
		.join("\n");
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}
