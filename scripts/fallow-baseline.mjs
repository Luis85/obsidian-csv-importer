// Re-saves the fallow baselines in .fallow-baselines/ (`npm run quality:baseline`).
// fallow exits with 1 when it finds issues, also while saving a baseline, so the exit code of each run only
// counts as a failure when the baseline file was not written.
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

const runs = [
	[[], ".fallow-baselines/dead-code.json"],
	[["dupes"], ".fallow-baselines/dupes.json"],
	[["health"], ".fallow-baselines/health.json"],
];

let failed = false;
for (const [args, file] of runs) {
	const started = Date.now();
	const result = spawnSync("fallow", [...args, "--quiet", "--save-baseline", file], { stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });
	let written = false;
	try {
		written = statSync(file).mtimeMs >= started - 1000;
	} catch {
		written = false;
	}
	if (!written) {
		console.error(`fallow ${args.join(" ") || "dead-code"}: baseline ${file} was not written (exit ${result.status}).`);
		failed = true;
	} else {
		console.log(`saved ${file}`);
	}
}
process.exit(failed ? 1 : 0);
