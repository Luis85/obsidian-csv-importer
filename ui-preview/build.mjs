// Bundles ui-preview/scenarios.ts (real plugin UI code + obsidian shim) into ui-preview/dist/.
// Usage: node ui-preview/build.mjs
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(here, "dist");
const shimPath = path.join(here, "obsidian-shim.ts");

function walk(dir, out = []) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (p.endsWith(".ts")) out.push(p);
	}
	return out;
}

/** Names the plugin imports (as values) from "obsidian". */
function importedNames() {
	const names = new Set();
	const re = /import\s+(?!type\b)\{([^}]*)\}\s+from\s+["']obsidian["']/g;
	for (const f of walk(path.join(root, "src"))) {
		const src = fs.readFileSync(f, "utf8");
		for (const m of src.matchAll(re)) {
			for (const part of m[1].split(",")) {
				const t = part.trim();
				if (!t || t.startsWith("type ")) continue;
				names.add(t.split(/\s+as\s+/)[0].trim());
			}
		}
	}
	return names;
}

/** Any value the plugin imports that the shim does not export gets a loud stub instead of a build failure. */
function shimExports() {
	const src = fs.readFileSync(shimPath, "utf8");
	const set = new Set();
	for (const m of src.matchAll(/export\s+(?:abstract\s+)?(?:class|function|const|let|var)\s+([A-Za-z0-9_$]+)/g)) set.add(m[1]);
	return set;
}

const missing = [...importedNames()].filter((n) => !shimExports().has(n));
if (missing.length) console.warn(`[ui-preview] shim gap: auto-stubbing ${missing.join(", ")} (add real implementations to obsidian-shim.ts)`);

const obsidianPlugin = {
	name: "obsidian-shim",
	setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "obsidian-virtual" }));
		build.onLoad({ filter: /.*/, namespace: "obsidian-virtual" }, () => ({
			resolveDir: here,
			loader: "ts",
			contents:
				`export * from ${JSON.stringify(shimPath)};\n` +
				missing
					.map(
						(n) =>
							`export const ${n} = new Proxy(function ${n}() {}, { construct() { console.error("ui-preview shim gap: new ${n}()"); return new Proxy({}, { get: () => () => undefined }); }, apply() { console.error("ui-preview shim gap: ${n}()"); } });`,
					)
					.join("\n"),
		}));
	},
};

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

await esbuild.build({
	entryPoints: [path.join(here, "scenarios.ts")],
	bundle: true,
	outfile: path.join(dist, "bundle.js"),
	format: "iife",
	platform: "browser",
	target: "es2020",
	sourcemap: "inline",
	loader: { ".csv": "text" },
	plugins: [obsidianPlugin],
	logLevel: "warning",
});

const theme = fs.readFileSync(path.join(here, "obsidian-theme.css"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const bundle = fs.readFileSync(path.join(dist, "bundle.js"), "utf8").replace(/<\/script>/g, "<\\/script>");
fs.writeFileSync(
	path.join(dist, "index.html"),
	`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CSV Importer UI preview</title>
<style>/* ui-preview/obsidian-theme.css (approximation) */\n${theme}</style>
<style>/* repo styles.css */\n${styles}</style>
</head><body>
<script>${bundle}</script>
</body></html>
`,
);
console.log("[ui-preview] built", path.join(dist, "index.html"));
