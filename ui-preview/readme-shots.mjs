// Captures the curated README screenshots at 2x into docs/images/ (run after `node ui-preview/build.mjs`).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = "file://" + path.join(here, "dist", "index.html");
const out = path.join(here, "..", "docs", "images");
const shots = [
	["table-view", "a-table-first-import", "light", { width: 1100, height: 520 }],
	["import-settings", "c-config", "light", { width: 1280, height: 860 }],
	["import-settings-reimport", "c-config-extras-reimport", "dark", { width: 1280, height: 860 }],
	["import-preview", "e-run-preview", "light", { width: 1100, height: 860 }],
	["imports-index", "h-index", "dark", { width: 1100, height: 420 }],
];
const browser = await chromium.launch();
for (const [file, scenario, theme, vp] of shots) {
	const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
	const page = await ctx.newPage();
	await page.goto(`${pageUrl}?theme=${theme}${vp.mobile ? "&mobile=1" : ""}#${scenario}`);
	await page.waitForTimeout(400);
	await page.screenshot({ path: path.join(out, `${file}.png`) });
	await ctx.close();
	console.log("wrote", file);
}
await browser.close();
