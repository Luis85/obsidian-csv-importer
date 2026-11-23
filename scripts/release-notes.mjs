// Prints the CHANGELOG.md section for the given version (heading "## <version>..."),
// or a generic line when there is none. Usage: node scripts/release-notes.mjs 1.2.3
import { readFileSync } from "fs";

const version = process.argv[2];
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
if (start < 0) {
	console.log(`Release ${version}.`);
} else {
	let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
	if (end < 0) end = lines.length;
	console.log(lines.slice(start + 1, end).join("\n").trim() || `Release ${version}.`);
}
