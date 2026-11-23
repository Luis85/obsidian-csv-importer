# Submitting to the Obsidian community plugins

## Checklist

1. Make sure `main` is green (CI passes on Node 20, 22 and 24: lint, test, build). `npm run lint` is ESLint, Stylelint and the API version check.
1b. BRAT beta step: the current version is 0.1.0 (beta). Install it with BRAT (`luis85/obsidian-csv-importer`) in a clean vault and run through the README walkthrough. Then release 1.0.0: run the Release workflow with version `1.0.0` (see CONTRIBUTING.md), or `npm version 1.0.0` locally (updates manifest.json and versions.json).
2. Confirm `manifest.json` has `id` `csv-importer`, version `1.0.0`, `minAppVersion` `1.15.1`, and the same description as below. `versions.json` contains `"1.0.0": "1.15.1"` (the release workflow adds the entry from `manifest.json`).
3. Create the release. Either push the tag (the release workflow publishes it):
   ```sh
   git tag 1.0.0 && git push origin 1.0.0
   ```
   or run the Release workflow as described in CONTRIBUTING.md. The tag must be `1.0.0` (no `v` prefix) and equal the manifest version.
4. Verify the GitHub release has `main.js`, `manifest.json` and `styles.css` as individual assets, and that the Release workflow's attestation step (build provenance for `main.js` and `styles.css`) passed.
5. Fork `obsidianmd/obsidian-releases`, and append this entry at the end of `community-plugins.json`:
   ```json
   {
     "id": "csv-importer",
     "name": "CSV Importer",
     "author": "Luis Mendez",
     "description": "Turn CSV files into one note per row with typed properties that Bases can sum and filter. Re-import safely when the CSV changes: your edits are kept. Includes table view, preview and undo.",
     "repo": "luis85/obsidian-csv-importer"
   }
   ```
6. Open a PR to `obsidianmd/obsidian-releases` using the plugin PR template and tick every checkbox honestly.

## Plugin guidelines checklist

- [ ] No `innerHTML`, `outerHTML` or `insertAdjacentHTML`; build DOM with `createEl` / `createDiv`.
- [ ] UI text in sentence case (for example "Import rows", not "Import Rows").
- [ ] No default hotkeys for commands.
- [ ] Settings use the declarative settings API (`getSettingDefinitions()`) with group headings, no "settings" word in headings, no top-level heading. Dialog headings use `new Setting(el).setHeading()`.
- [ ] Command names do not include the plugin name.
- [ ] No global `app`; use the plugin's `this.app`.
- [ ] Use the Vault API / `processFrontMatter` instead of adapter or manual YAML writes where possible.
- [ ] Clean up listeners with `registerEvent` / `registerDomEvent`; no leaked intervals.
- [ ] Styles in `styles.css` using Obsidian CSS variables; no inline static styles.
- [ ] No `console.log` noise in production.
- [ ] `isDesktopOnly` is accurate (no Node/Electron APIs when `false`).
- [ ] `README.md` explains the plugin; `LICENSE` is present.
- [ ] `npm run lint` passes: `eslint-plugin-obsidianmd` recommended config, Stylelint on `styles.css`, and `scripts/check-api-versions.mjs` (no unguarded API newer than `minAppVersion`).
- [ ] `minAppVersion` in `manifest.json` is 1.15.1 and no code reads a newer API unguarded.

## Disclosures for the PR and reviewers

- [ ] Network: the plugin makes no network requests and has no telemetry.
- [ ] Data stored: settings in `data.json`; import state (`index.json`, `<hash>.json` with hashes of last imported values) and undo data (`<hash>.undo.json`, previous note content, may contain row data) in `.obsidian/plugins/csv-importer/imports/`. Documented in the README under "Privacy and data".
- [ ] Files outside notes: optional `.base` file, optional import report note. The CSV is never modified.
- [ ] Only documented APIs are used (no `metadataTypeManager`, no file-explorer internals). Search `src/` for `as unknown as` before submitting.
- [ ] `vault.adapter` is used only for plugin-folder state (`imports/`); notes are written with the Vault API (`vault.process`, `processFrontMatter` where applicable).
- [ ] README has no screenshot placeholder; screenshots are optional (`docs/images/`; `node ui-preview/build.mjs && node ui-preview/screenshot.mjs` produces candidates).
- [ ] README labels match the UI (tabs Columns, Notes, Re-import, File & rows; buttons Import now, Save, Cancel).

## Automated review

After the PR is opened, a validation bot checks the entry and the release (manifest fields, matching version and id, release assets, JSON format) and then runs a code scan using the same rules as `eslint-plugin-obsidianmd`. Expect:

- Labels such as "Ready for review" when the checks pass, or comments listing required changes.
- Fix findings in the plugin repo, publish a new release if needed, and push to the PR branch or re-trigger by commenting as instructed by the bot.
- A human reviewer takes over after the bot checks pass; reviews can take weeks.
- Run `npm run lint` locally first to catch most issues before submitting.

## Lessons from the first automated review (0.1.0)

The review bot checks more than `eslint-plugin-obsidianmd`'s recommended config locally reports. Those findings are now covered by `npm run lint`. Before each release, check:

- `npm run lint` passes: ESLint and Stylelint, with no warnings.
- The settings tab never reads properties through the `Plugin` type that are newer than `minAppVersion`. The local `eslint-plugin-obsidianmd` 0.6.0 `no-unsupported-api` rule checks methods, such as `setDestructive()`, but not plain properties with `@since`, such as `Plugin.settings`. The review bot checks both. `scripts/check-api-versions.mjs` closes this gap: it runs in `npm run lint` and uses the TypeScript compiler to report every unguarded Obsidian method or property whose `@since` is newer than `minAppVersion`. It caught `Workspace.revealLeaf` (`@since 1.7.2`), which ESLint let through. `Plugin.settings` is `@since 1.13.0`, so a plugin's own `settings` field must be read through its own type, not through `Plugin`.
- The release has artifact attestations for `main.js` and `styles.css`. The Release workflow creates them, so check that the attestation step passed.
- `styles.css` has no duplicate properties, such as `vh` fallbacks before `dvh` values.
