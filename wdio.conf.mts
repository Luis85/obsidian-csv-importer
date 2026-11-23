import { mkdirSync } from "node:fs";
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
		vault: "test/e2e/vaults/base",
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
			vault: "test/e2e/vaults/base",
			emulateMobile: true,
		},
		// The functional import/undo specs drive desktop dialogs; on mobile emulation only the UI specs run.
		"wdio:specs": ["./test/e2e/specs/{smoke,csv-view,appearance,mobile}.e2e.ts"],
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
	specs: [readmeRun ? "./test/e2e/specs/readme-screenshots.e2e.ts" : "./test/e2e/specs/**/*.e2e.ts"],
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
	logLevel: "warn",
	// Keep a screenshot of the failing state for CI artifacts.
	afterTest: async function (test, _context, result) {
		if (result.passed) return;
		const name = `${test.parent} ${test.title}`.replace(/[^\w.-]+/g, "_").slice(0, 120);
		try {
			mkdirSync(path.resolve("reports/e2e/failures"), { recursive: true });
			await browser.saveScreenshot(path.resolve("reports/e2e/failures", `${name}.png`));
		} catch {
			// The window may be gone; nothing to capture.
		}
	},
};
