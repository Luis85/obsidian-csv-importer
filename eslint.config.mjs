import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
	// Build output and Node build scripts are not plugin source.
	globalIgnores([
		"node_modules",
		"dist",
		"coverage",
		"main.js",
		"esbuild.config.mjs",
		"version-bump.mjs",
		"scripts/**",
		"ui-preview/**",
	]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.*"],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ["src/**/*.ts"],
		rules: {
			"obsidianmd/ui/sentence-case": ["warn", { enforceCamelCaseLower: true }],
		},
	},
	{
		// Tests and the vitest config use tsconfig.test.json (Node types).
		files: ["tests/**/*.ts", "vitest.config.ts"],
		languageOptions: {
			parserOptions: {
				projectService: false,
				project: ["./tsconfig.test.json"],
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		// End-to-end tests (WebdriverIO + Mocha, Node) use tsconfig.e2e.json. Code passed to executeObsidian runs inside
		// Obsidian and works with loosely typed internals, so the type-aware "unsafe" and Obsidian authoring rules are off.
		files: ["test/e2e/**/*.ts", "wdio.conf.mts"],
		languageOptions: {
			globals: { ...globals.node, ...globals.mocha },
			parserOptions: {
				projectService: false,
				project: ["./tsconfig.e2e.json"],
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-non-null-assertion": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-floating-promises": "off",
			"@typescript-eslint/require-await": "off",
			"@typescript-eslint/await-thenable": "off",
			"@typescript-eslint/no-unnecessary-type-assertion": "off",
			"obsidianmd/no-static-styles-assignment": "off",
			"obsidianmd/prefer-file-manager-trash-file": "off",
			"obsidianmd/prefer-active-doc": "off",
			"obsidianmd/prefer-active-window-timers": "off",
			"obsidianmd/ui/sentence-case": "off",
		},
	},
	{
		// Tests run in Node under vitest and may be less strict.
		files: ["tests/**/*.ts"],
		languageOptions: { globals: { ...globals.node } },
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-non-null-assertion": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-floating-promises": "off",
			"obsidianmd/no-static-styles-assignment": "off",
		},
	},
]);
