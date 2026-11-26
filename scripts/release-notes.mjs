// Prints the CHANGELOG.md section for the given version (heading "## <version>..."),
// or a generic line when there is none. With --require, a missing or empty section is an error instead.
// Usage: node scripts/release-notes.mjs 1.2.3 [--require]
import { readFileSync } from "fs";

const version = process.argv[2];
const requireNotes = process.argv.includes("--require");
if (!version) {
	console.error("usage: release-notes.mjs <version>");
	process.exit(1);
}

let changelog = "";
try {
	changelog = readFileSync("CHANGELOG.md", "utf8").replace(/\r\n?/g, "\n");
} catch {
	// no changelog
}

const lines = changelog.split("\n");
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const start = lines.findIndex((l) => new RegExp(`^##\\s+\\[?v?${escaped}\\]?(\\s|$)`).test(l));
let notes = "";
if (start >= 0) {
	let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
	if (end < 0) end = lines.length;
	notes = lines.slice(start + 1, end).join("\n").trim();
}
if (!notes && requireNotes) {
	console.error(`CHANGELOG.md has no notes for ${version}: add them under "## Unreleased" or "## ${version}".`);
	process.exit(1);
}
console.log(notes || `Release ${version}.`);
