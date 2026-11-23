# Submitting to the Obsidian community plugins

## Checklist

1. Make sure `main` is green (CI passes: lint, test, build).
2. Confirm `manifest.json` has `id` `csv-importer`, version `1.0.0`, and the same description as below. `versions.json` contains `"1.0.0": "1.5.0"`.
3. Create the release. Either push the tag (the release workflow publishes it):
   ```sh
   git tag 1.0.0 && git push origin 1.0.0
   ```
   or run `npm version` as described in the README. The tag must be `1.0.0` (no `v` prefix) and equal the manifest version.
4. Verify the GitHub release has `main.js`, `manifest.json` and `styles.css` as individual assets.
5. Fork `obsidianmd/obsidian-releases`, and append this entry at the end of `community-plugins.json`:
   ```json
   {
     "id": "csv-importer",
     "name": "CSV Importer",
     "author": "Luis Mendez",
     "description": "View CSV files in a table and import every row as a note with correctly typed properties. Import settings are saved per file.",
     "repo": "luis85/obsidian-csv-importer"
   }
   ```
6. Open a PR to `obsidianmd/obsidian-releases` using the plugin PR template and tick every checkbox honestly.

## Plugin guidelines checklist

- [ ] No `innerHTML`, `outerHTML` or `insertAdjacentHTML`; build DOM with `createEl` / `createDiv`.
- [ ] UI text in sentence case (for example "Import rows", not "Import Rows").
- [ ] No default hotkeys for commands.
- [ ] Settings headings use `new Setting(el).setHeading()`, no "settings" word in headings, no top-level heading.
- [ ] Command names do not include the plugin name.
- [ ] No global `app`; use the plugin's `this.app`.
- [ ] Use the Vault API / `processFrontMatter` instead of adapter or manual YAML writes where possible.
- [ ] Clean up listeners with `registerEvent` / `registerDomEvent`; no leaked intervals.
- [ ] Styles in `styles.css` using Obsidian CSS variables; no inline static styles.
- [ ] No `console.log` noise in production.
- [ ] `isDesktopOnly` is accurate (no Node/Electron APIs when `false`).
- [ ] `README.md` explains the plugin; `LICENSE` is present.
- [ ] `npm run lint` passes with `eslint-plugin-obsidianmd` recommended config.

## Automated review

After the PR is opened, a validation bot checks the entry and the release (manifest fields, matching version and id, release assets, JSON format) and then runs a code scan using the same rules as `eslint-plugin-obsidianmd`. Expect:

- Labels such as "Ready for review" when the checks pass, or comments listing required changes.
- Fix findings in the plugin repo, publish a new release if needed, and push to the PR branch or re-trigger by commenting as instructed by the bot.
- A human reviewer takes over after the bot checks pass; reviews can take weeks.
- Run `npm run lint` locally first to catch most issues before submitting.
