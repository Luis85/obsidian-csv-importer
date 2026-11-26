// The in-memory trace and the diagnostics report built from it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDiagnosticsReport, diagnosticsFileName } from "../../src/core/diagnostics";
import { TRACE_LIMIT, clearTrace, formatTrace, setTraceToConsole, trace, traceEntries, traceError } from "../../src/core/trace";

afterEach(() => {
	clearTrace();
	setTraceToConsole(false);
	vi.restoreAllMocks();
});

describe("trace", () => {
	it("keeps entries in order, with their data, and drops the oldest past the limit", () => {
		for (let i = 0; i < TRACE_LIMIT + 5; i++) trace("import", `step ${i}`, { i });
		const list = traceEntries();
		expect(list).toHaveLength(TRACE_LIMIT);
		expect(list[0]).toMatchObject({ scope: "import", message: "step 5", data: { i: 5 } });
		expect(list.at(-1)?.message).toBe(`step ${TRACE_LIMIT + 4}`);
	});

	it("records an error's message and where it happened", () => {
		traceError("storage", "could not write", new Error("disk full"), { csv: "a.csv" });
		const [entry] = traceEntries();
		expect(entry?.data).toMatchObject({ csv: "a.csv", error: "Error: disk full" });
		expect(String(entry?.data?.at)).toContain("diagnostics.test.ts");
		traceError("storage", "odd failure", "just a string");
		expect(traceEntries()[1]?.data).toEqual({ error: "just a string" });
	});

	it("prints to the developer console only when the debug log is on", () => {
		const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
		trace("index", "quiet");
		expect(debug).not.toHaveBeenCalled();
		setTraceToConsole(true);
		trace("index", "loud", { n: 1 });
		expect(debug).toHaveBeenCalledWith("CSV Importer [index] loud", { n: 1 });
	});

	it("formats one line per entry with time, scope, message and data", () => {
		trace("dialog", "opened", { csv: "Data/a.csv" });
		trace("dialog", "closed");
		const lines = formatTrace().split("\n");
		expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d\.\d{3} \[dialog\] opened \{"csv":"Data\/a\.csv"\}$/);
		expect(lines[1]).toMatch(/\[dialog\] closed$/);
	});
});

describe("diagnostics report", () => {
	const base = {
		pluginVersion: "1.0.0",
		obsidianVersion: "1.15.1",
		platform: "desktop",
		now: Date.UTC(2026, 10, 26, 17, 5),
		settings: { debugLog: true },
		imports: [],
		trace: [],
	};

	it("lists versions, settings, imports and steps", () => {
		const text = buildDiagnosticsReport({
			...base,
			imports: [{ csvPath: "Data/a|b.csv", exists: false, lastImport: null, hasUndo: true, unreadable: ["snapshot"], lastRun: "2 new" }],
			trace: [{ t: base.now, scope: "import", message: "planned", data: { notes: 2 } }],
		});
		expect(text).toContain("- CSV Importer: 1.0.0");
		expect(text).toContain("- Obsidian: 1.15.1");
		expect(text).toContain('"debugLog": true');
		expect(text).toContain("| Data/a\\|b.csv | no | never | yes | snapshot | 2 new |");
		expect(text).toContain('[import] planned {"notes":2}');
		expect(text).toContain("no row content");
	});

	it("says when there is nothing to list", () => {
		const text = buildDiagnosticsReport(base);
		expect(text).toContain("## CSV imports (0)\n\nNone.");
		expect(text).toContain("(none)");
	});

	it("names the note after the time it was made", () => {
		expect(diagnosticsFileName(new Date(2026, 10, 6, 7, 5).getTime())).toBe("CSV Importer diagnostics 2026-11-06 07-05.md");
	});
});
