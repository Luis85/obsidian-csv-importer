// Mutation testing with Stryker (https://stryker-mutator.io). Run with `npm run test:mutation`.
// Mutates the pure logic (no Obsidian at runtime) that the vitest suite in `tests/` covers.
// The release workflow runs this in an advisory job: below `thresholds.break` the job fails as a warning, the release goes on.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
	testRunner: "vitest",
	vitest: { configFile: "vitest.config.ts" },
	plugins: ["@stryker-mutator/vitest-runner"],
	mutate: ["src/core/**/*.ts", "src/csv/**/*.ts", "src/import/**/*.ts", "src/configStore.ts", "src/defaults.ts", "!src/import/vaultGateway.ts"],
	coverageAnalysis: "perTest",
	ignoreStatic: true,
	reporters: ["progress", "clear-text", "html", "json"],
	htmlReporter: { fileName: "reports/mutation/index.html" },
	jsonReporter: { fileName: "reports/mutation/mutation.json" },
	tempDirName: ".stryker-tmp",
	incremental: false,
	timeoutMS: 10000,
	// First full run (2026-11): 68.2 %. `break` sits a few points below so a release fails on a real drop; raise it as the score improves.
	thresholds: { high: 80, low: 60, break: 65 },
};
