// Mutation testing with Stryker (https://stryker-mutator.io). Run with `npm run test:mutation`.
// Mutates the pure logic (no Obsidian at runtime) that the vitest suite in `tests/unit/` covers.
// The release workflow runs this in the `mutation` job, which the release waits for: below `thresholds.break` it fails.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
	testRunner: "vitest",
	vitest: { configFile: "vitest.config.ts" },
	plugins: ["@stryker-mutator/vitest-runner"],
	mutate: ["src/core/**/*.ts", "src/csv/**/*.ts", "src/import/**/*.ts", "src/configStore.ts", "src/defaults.ts", "!src/import/vaultGateway.ts"],
	coverageAnalysis: "perTest",
	// Static mutants (module-level constants such as regexes and lookup tables) are tested too: with ignoreStatic the vitest
	// runner credits module loading to one unrelated test, so those mutants would survive whatever the tests check.
	ignoreStatic: false,
	reporters: ["progress", "clear-text", "html", "json"],
	htmlReporter: { fileName: "reports/mutation/index.html" },
	jsonReporter: { fileName: "reports/mutation/mutation.json" },
	tempDirName: ".stryker-tmp",
	incremental: false,
	timeoutMS: 10000,
	// Full runs 2026-11 with static mutants: 93.8 %, 92.9 % before 1.0.0 (first run, before the test pass: 68.2 %). `break` sits a
	// few points below, so only a real drop blocks a release; raise it as the score improves.
	thresholds: { high: 95, low: 85, break: 90 },
};
