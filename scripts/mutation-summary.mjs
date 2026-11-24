// Summarizes a Stryker JSON report (reports/mutation/mutation.json) for CI.
// Prints the mutation score per file and overall, appends a table to $GITHUB_STEP_SUMMARY when set, and emits a
// GitHub `::warning::` when the score is below `thresholds.break` (or `thresholds.low` when break is unset).
// Always exits 0: the score is advisory until the plugin has settled (see CONTRIBUTING.md, "Mutation testing").
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const file = process.argv[2] ?? "reports/mutation/mutation.json";
if (!existsSync(file)) {
	console.log(`::warning::No mutation report at ${file}; the mutation run did not finish.`);
	process.exit(0);
}

const report = JSON.parse(readFileSync(file, "utf8"));
const DETECTED = new Set(["Killed", "Timeout"]);
const VALID = new Set(["Killed", "Timeout", "Survived", "NoCoverage"]);

function score(mutants) {
	const valid = mutants.filter((m) => VALID.has(m.status));
	const detected = valid.filter((m) => DETECTED.has(m.status)).length;
	return { valid: valid.length, detected, survived: valid.filter((m) => m.status === "Survived").length, noCoverage: valid.filter((m) => m.status === "NoCoverage").length, pct: valid.length === 0 ? 100 : (detected / valid.length) * 100 };
}

const rows = Object.entries(report.files)
	.map(([path, f]) => ({ path, ...score(f.mutants) }))
	.sort((a, b) => a.pct - b.pct);
const all = score(Object.values(report.files).flatMap((f) => f.mutants));
const limit = report.thresholds?.break ?? report.thresholds?.low ?? 0;

const lines = [
	`### Mutation score: ${all.pct.toFixed(2)} %`,
	"",
	`${all.detected} of ${all.valid} mutants detected, ${all.survived} survived, ${all.noCoverage} not covered. Advisory threshold: ${limit} %.`,
	"",
	"| File | Score | Survived | No coverage |",
	"| --- | ---: | ---: | ---: |",
	...rows.map((r) => `| \`${r.path}\` | ${r.pct.toFixed(1)} % | ${r.survived} | ${r.noCoverage} |`),
	"",
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
if (all.pct < limit) {
	console.log(`::warning title=Mutation score::Mutation score ${all.pct.toFixed(2)} % is below the advisory threshold of ${limit} %. Not blocking the release yet.`);
}
