import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { browser } from "@wdio/globals";
import { parseObsidianVersions } from "wdio-obsidian-service";

// Env overrides:
//   OBSIDIAN_VERSIONS   space separated "appVersion/installerVersion" list (default "earliest/earliest latest/latest")
//   WDIO_MAX_INSTANCES  parallel Obsidian instances (default 1; one per Obsidian version is safe)
//   E2E_MOBILE          "1" adds a mobile-emulation capability, "only" runs mobile emulation alone
const cacheDir = path.resolve(".obsidian-cache");
const mobileMode = process.env.E2E_MOBILE ?? "";
// CI keys its download cache on the resolved versions printed here (.github/workflows/e2e.yml).
const versions = await parseObsidianVersions(process.env.OBSIDIAN_VERSIONS ?? "earliest/earliest latest/latest", { cacheDir });

if (process.env.CI) process.stdout.write(`obsidian-cache-key: ${JSON.stringify(versions)}\n`);

const desktop: WebdriverIO.Capabilities[] = versions.map(([appVersion, installerVersion]) => ({
	browserName: "obsidian",
	browserVersion: appVersion,
	"wdio:obsidianOptions": {
		installerVersion,
		plugins: ["."],
		vault: "tests/e2e/vaults/base",
	},
}));

// Phone-sized window with Obsidian's mobile UI (app.emulateMobile). Uses the latest version only.
const mobile: WebdriverIO.Capabilities[] = [
	{
		browserName: "obsidian",
		browserVersion: "latest",
		"wdio:obsidianOptions": {
			installerVersion: "latest",
			plugins: ["."],
			vault: "tests/e2e/vaults/base",
			emulateMobile: true,
		},
		// The functional import/undo specs drive desktop dialogs; on mobile emulation only the UI specs run.
		"wdio:specs": ["./tests/e2e/specs/{smoke,csv-view,appearance,mobile}.e2e.ts"],
		"goog:chromeOptions": {
			mobileEmulation: { deviceMetrics: { width: 390, height: 844 } },
		},
	},
];

// README_SCREENSHOTS=1 (npm run screenshots:readme): one session on the last desktop version at a device scale
// factor of 2, running only the spec that writes docs/images/*.png.
const readmeRun = process.env.README_SCREENSHOTS === "1";
const screenshots: WebdriverIO.Capabilities[] = desktop.slice(-1).map((cap) => ({
	...cap,
	"goog:chromeOptions": { args: ["--force-device-scale-factor=2"] },
}));

const capabilities = readmeRun ? screenshots : mobileMode === "only" ? mobile : mobileMode === "1" ? [...desktop, ...mobile] : desktop;

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",
	specs: [readmeRun ? "./tests/e2e/specs/readme-screenshots.e2e.ts" : "./tests/e2e/specs/**/*.e2e.ts"],
	maxInstances: Number(process.env.WDIO_MAX_INSTANCES ?? 1),
	capabilities,
	services: ["obsidian"],
	reporters: ["obsidian"],
	cacheDir,
	outputDir: "reports/e2e/logs",
	injectGlobals: false,
	waitforTimeout: 5000,
	waitforInterval: 250,
	mochaOpts: {
		ui: "bdd",
		timeout: 60000,
	},
	// On CI every WebDriver command and its result goes to reports/e2e/logs/wdio-<worker>.log (uploaded as an
	// artifact), so a failure can be traced click by click. E2E_LOG_LEVEL overrides it locally.
	logLevel: (process.env.E2E_LOG_LEVEL as WebdriverIO.Config["logLevel"]) ?? (process.env.CI ? "info" : "warn"),
	// Keep the failing state for CI artifacts: a screenshot, and a report of what the plugin and Obsidian were doing.
	afterTest: async function (test, _context, result) {
		if (result.passed) return;
		const name = `${test.parent} ${test.title}`.replace(/[^\w.-]+/g, "_").slice(0, 120);
		const dir = path.resolve("reports/e2e/failures");
		mkdirSync(dir, { recursive: true });
		try {
			await browser.saveScreenshot(path.join(dir, `${name}.png`));
		} catch {
			// The window may be gone; nothing to capture.
		}
		try {
			const state = await failureState();
			const report = { test: `${test.parent} > ${test.title}`, error: String(result.error ?? ""), ...state.summary };
			writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(report, null, 2));
			writeFileSync(path.join(dir, `${name}.steps.txt`), state.steps);
			writeFileSync(path.join(dir, `${name}.html`), state.html);
		} catch (e) {
			writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ test: test.title, captureFailed: String(e) }, null, 2));
		}
	},
};

/**
 * What Obsidian and the plugin were doing when a test failed: the plugin's recent steps (its in-memory trace), console
 * errors seen by the spy, open dialogs and menus, notices, the active view, and the page's HTML.
 */
async function failureState(): Promise<{ summary: Record<string, unknown>; steps: string; html: string }> {
	return browser.execute(() => {
		const w = window as unknown as {
			app: {
				plugins: { plugins: Record<string, { recentSteps?: () => string }> };
				workspace: { getActiveViewOfType(t: unknown): { getViewType(): string } | null };
			};
			csvImporterCaptured?: unknown[];
		};
		const texts = (selector: string) => Array.from(document.querySelectorAll(selector)).map((e) => (e as HTMLElement).innerText.trim());
		const plugin = w.app?.plugins?.plugins?.["csv-importer"];
		const active = document.activeElement as HTMLElement | null;
		return {
			summary: {
				modals: texts(".modal-container .modal").map((t) => t.slice(0, 500)),
				menus: texts(".menu").map((t) => t.slice(0, 300)),
				notices: texts(".notice"),
				activeLeafHeader: texts(".workspace-leaf.mod-active .view-header-title"),
				focused: active ? `${active.tagName.toLowerCase()}${active.className ? `.${String(active.className).replace(/\s+/g, ".")}` : ""} "${(active.innerText ?? "").slice(0, 60)}"` : null,
				documentHasFocus: document.hasFocus(),
				console: w.csvImporterCaptured ?? [],
			},
			steps: plugin?.recentSteps?.() ?? "(plugin not loaded)",
			html: document.body.outerHTML,
		};
	});
}

