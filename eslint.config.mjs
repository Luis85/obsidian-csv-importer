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
		"vitest.config.ts",
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
