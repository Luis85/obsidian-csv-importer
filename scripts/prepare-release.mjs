// Computes the next version and writes it to package.json, package-lock.json, manifest.json and
// versions.json; renames a "## Unreleased" CHANGELOG heading to the new version.
// Usage: node scripts/prepare-release.mjs <current|patch|minor|major|x.y.z>
// Prints the resulting version on stdout.
import { existsSync, readFileSync, writeFileSync } from "fs";

const input = (process.argv[2] || "current").trim();
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, v, indent) => writeFileSync(p, JSON.stringify(v, null, indent) + "\n");

const manifest = readJson("manifest.json");
const current = manifest.version;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;
const m = SEMVER.exec(current);
if (!m) throw new Error(`manifest.json version "${current}" is not semver`);
const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];

let next;
switch (input) {
	case "current": next = current; break;
	case "patch": next = m[4] ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`; break;
	case "minor": next = `${major}.${minor + 1}.0`; break;
	case "major": next = `${major + 1}.0.0`; break;
	default:
		if (!SEMVER.test(input)) throw new Error(`"${input}" is not current, patch, minor, major or x.y.z`);
		next = input;
}

manifest.version = next;
writeJson("manifest.json", manifest, "\t");

const pkg = readJson("package.json");
pkg.version = next;
writeJson("package.json", pkg, 2);

if (existsSync("package-lock.json")) {
	const lock = readJson("package-lock.json");
	lock.version = next;
	if (lock.packages && lock.packages[""]) lock.packages[""].version = next;
	writeJson("package-lock.json", lock, 2);
}

const versions = existsSync("versions.json") ? readJson("versions.json") : {};
versions[next] = manifest.minAppVersion;
writeJson("versions.json", versions, "\t");

if (existsSync("CHANGELOG.md")) {
	const log = readFileSync("CHANGELOG.md", "utf8");
	const hasSection = new RegExp(`^##\\s+\\[?v?${next.replace(/\./g, "\\.")}\\]?(\\s|$)`, "m").test(log);
	if (!hasSection && /^##\s+\[?Unreleased\]?\s*$/im.test(log)) {
		writeFileSync("CHANGELOG.md", log.replace(/^##\s+\[?Unreleased\]?\s*$/im, `## ${next}`));
	}
}

console.log(next);
