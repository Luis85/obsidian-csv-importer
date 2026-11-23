// Takes screenshots of every scenario x theme x viewport into ui-preview/screenshots/.
// Usage: node ui-preview/screenshot.mjs [scenarioFilter]   (after node ui-preview/build.mjs)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "screenshots");
const page_url = pathToFileURL(path.join(here, "dist", "index.html")).href;

const viewports = {
	desktop: { width: 1280, height: 860, mobile: false },
	phone: { width: 390, height: 844, mobile: true },
	// Tall desktop viewport so long dialogs are visible without internal scrolling (only for dialog scenarios).
	"desktop-tall": { width: 1280, height: 2400, mobile: false, only: /^(c|d|e|f|g)-/ },
};
const themes = ["light", "dark"];
const filter = process.argv[2];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const names = await (async () => {
	const p = await browser.newPage();
	await p.goto(page_url);
	await p.waitForFunction(() => window.__scenarioNames);
	const n = await p.evaluate(() => window.__scenarioNames);
	await p.close();
	return n;
})();

let problems = 0;
const files = [];
for (const name of names) {
	if (filter && !name.includes(filter)) continue;
	for (const theme of themes) {
		for (const [vpName, vp] of Object.entries(viewports)) {
			if (vp.only && !vp.only.test(name)) continue;
			const ctx = await browser.newContext({
				viewport: { width: vp.width, height: vp.height },
				deviceScaleFactor: 1,
				isMobile: false,
				hasTouch: vp.mobile,
				locale: "en-US",
				timezoneId: "Europe/Berlin",
				colorScheme: theme,
			});
			const page = await ctx.newPage();
			const errors = [];
			page.on("console", (m) => {
				if (m.type() === "error" || m.type() === "warning") errors.push(`console.${m.type()}: ${m.text()}`);
			});
			page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
			await page.goto(`${page_url}?theme=${theme}${vp.mobile ? "&mobile=1" : ""}#${name}`);
			await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 }).catch((e) => errors.push("not ready: " + e.message));
			errors.push(...(await page.evaluate(() => window.__errors || []).catch(() => [])));
			await page.waitForTimeout(150);
			const file = `${name}-${theme}-${vpName}.png`;
			await page.screenshot({ path: path.join(out, file) });
			files.push(file);
			if (errors.length) {
				problems += errors.length;
				console.log(`ERRORS ${file}:\n  ${[...new Set(errors)].join("\n  ")}`);
			}
			await ctx.close();
		}
	}
}
await browser.close();
console.log(`[ui-preview] ${files.length} screenshots in ${out}; ${problems} console/page errors`);
