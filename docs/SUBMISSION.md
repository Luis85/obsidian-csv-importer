# Publishing to the Obsidian community directory

Plugins are submitted through the **community directory portal** at [community.obsidian.md](https://community.obsidian.md). Opening a pull request against `obsidianmd/obsidian-releases` is no longer how new plugins are submitted, and you don't need to edit `community-plugins.json` yourself. The portal launched on 2026-05-12 ([announcement](https://obsidian.md/blog/future-of-plugins/)). Every release is reviewed automatically.

Sources, checked 2026-11-23:

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Set up and claim](https://docs.obsidian.md/community-directory/set-up-and-claim)
- [Manage your entry](https://docs.obsidian.md/community-directory/manage-entry)
- [Submission requirements for plugins](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Developer policies](https://docs.obsidian.md/Community+directory/Developer+policies)
- [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Manifest reference](https://docs.obsidian.md/Reference/Manifest)
- [Community directory FAQ](https://docs.obsidian.md/community-directory/faq)

## Steps

1. **Check that `main` is green.** CI must pass on Node 20, 22 and 24 (lint, test, build). `npm run lint` runs ESLint (`eslint-plugin-obsidianmd`), Stylelint and the API version check.
2. **Check the repository root.** It must contain `README.md`, `LICENSE` (MIT) and `manifest.json`. The directory reads `manifest.json` from the **default branch**, so it must be committed there.
3. **Publish a release** with the Release workflow (see CONTRIBUTING.md): `version=patch|minor|major|x.y.z`.
   - The tag equals the manifest `version`, with no `v` prefix.
   - The assets are `main.js`, `manifest.json` and `styles.css`, uploaded individually.
   - `main.js` and `styles.css` get build-provenance attestations. The directory shows these as a passed check. Missing attestations are only a recommendation, not a blocker.
   - Versions are semver `x.y.z`. The docs suggest `1.0.0` for a first public release. Earlier `0.x` releases (0.1.0, 0.2.0) were BRAT betas.
4. **Claim the plugin in the portal.**
   1. Sign in at [community.obsidian.md](https://community.obsidian.md) with your Obsidian account.
   2. Connect GitHub with the repository owner account (`luis85`). The link is read-only and only verifies ownership.
   3. Go to **Plugins → New plugin**.
   4. Enter `https://github.com/luis85/obsidian-csv-importer` and its owner.
   5. Agree to the Developer policies, confirm that you will maintain the entry, and submit.
5. **Watch the scorecard.** The automated review usually finishes within minutes.
   - Fix any **Error** in the repository, then publish a new release with a higher version.
   - Once the scan passes, the plugin becomes installable within about 24 hours.
6. **Optional:** announce the plugin in the forum's "Share & showcase" category and the Discord #updates channel.

## Review and re-review

- **When scans run.** Every release is scanned, not only the first one. The scorecard has four sections: **Manifest**, **Releases**, **Source code** and **Build verification**. Each finding is an **Error**, **Warning**, **Recommendation** or **Pass**.
- **Severity.** Errors block installation, and a new version that fails is removed from search. Warnings and recommendations don't block, but fix them anyway.
- **Build verification.** The scanner runs the first of the `build`, `build:plugin` or `compile` scripts it finds. Ours is `build`: type check, then the esbuild production bundle.
- **License.** The scanner reads the license type from GitHub. A custom or unrecognized license produces a warning. MIT is recognized.
- **Re-running a review.** Publish a new release; the directory also checks for new releases periodically. The entry's **…** menu has these options:
  - **Check for new releases**
  - **Request review**: runs an immediate re-check.
  - **Review branch**: a preview scan of any branch, tag or commit without publishing a release. Use it before releasing.
- **Manual review** mostly concerns popular, featured or reported plugins.

## Requirements checklist

Manifest (`manifest.json`):

- [ ] The required fields are present: `id`, `name`, `version`, `minAppVersion`, `description`, `author` and `isDesktopOnly`. `authorUrl` is optional.
- [ ] `id` is `csv-importer`. It uses lowercase letters and hyphens only, does not contain "obsidian", does not end in "plugin", and is unique.
- [ ] `name` is `CSV Importer`. It uses basic Latin characters, does not contain "Obsidian" or "Plugin", and is unique.
- [ ] `description` meets the rules:
  - it starts with an action verb ("Turn …");
  - it is at most 250 characters (currently 188);
  - it ends with a period;
  - it has no emoji or special characters;
  - proper nouns are capitalized correctly ("CSV", "Bases").
- [ ] `minAppVersion` is the oldest Obsidian version that works: 1.15.1. No code uses an unguarded API newer than that (`npm run lint` checks this).
- [ ] `isDesktopOnly` is `false`. That's correct because the plugin uses no Node or Electron APIs.
- [ ] `fundingUrl` is left out, because the plugin takes no donations. It may only point to donation services.
- [ ] `versions.json` maps each released version to its `minAppVersion`. 0.1.0 maps to 1.6.6, which was historically correct, and 0.2.0 maps to 1.15.1. The Release workflow adds the entry.

Code and repository:

- [ ] Command IDs don't contain the plugin id. Current IDs: `open-import-index`, `import-current-csv`, `reimport-all-csv`, `undo-import-current-csv` and `configure-current-csv`.
- [ ] Command names don't contain the plugin name, and there are no default hotkeys.
- [ ] No sample-plugin code is left over.
- [ ] No `innerHTML`, `outerHTML` or `insertAdjacentHTML`. Build the DOM with `createEl` and `createDiv`.
- [ ] UI text uses sentence case. ESLint enforces `obsidianmd/ui/sentence-case`.
- [ ] Settings use the declarative settings API (`getSettingDefinitions()`), with group headings, no "settings" in the headings and no top-level heading.
- [ ] No global `app`; the plugin uses `this.app`.
- [ ] Notes are written with the Vault API (`vault.create`, `vault.process`, `fileManager.processFrontMatter`) and deleted with `fileManager.trashFile`. `vault.adapter` is used only for plugin-folder state (`imports/`).
- [ ] User paths go through `normalizePath()`.
- [ ] Listeners are registered with `registerEvent` and `registerDomEvent`, so none leak.
- [ ] Styles live in `styles.css` and use Obsidian CSS variables. There are no inline styles and no `!important`.
- [ ] Only documented APIs are used (no `metadataTypeManager`, no file-explorer internals). Before submitting, search `src/` for `as unknown as`.
- [ ] There is no `console.log` noise.
- [ ] The code is not obfuscated, and `main.js` stays well under 5 MB (currently about 135 KB).
- [ ] `LICENSE` is MIT, which GitHub recognizes. The repository is not a fork and is public, open source code.

## README disclosures (Developer policies)

The Developer policies forbid client-side telemetry, ads in the plugin UI, obfuscation and self-updating code. Some things are allowed only if the README discloses them: network use, accounts, paid features, files accessed outside the vault, and server-side telemetry. Our README section "Privacy and data" covers:

- [ ] **Network:** none. The plugin makes no network requests and has no telemetry.
- [ ] **Clipboard:** not used. If the code ever reads or writes the clipboard, disclose it, because the scanner flags undisclosed clipboard use.
- [ ] **Data stored:**
  - settings in `data.json`;
  - import state in `.obsidian/plugins/csv-importer/imports/`: `index.json` and `<hash>.json`, which hold hashes of the last imported values;
  - undo data in `<hash>.undo.json`, which holds the previous note content and may contain row data.
- [ ] **Files written:** notes, an optional `.base` file and an optional import report note. The CSV is never modified. Nothing outside the vault is accessed.
- [ ] **Account requirement, paid features and ads:** none.

## Lessons from the review of 0.1.0

The automated review checks more than the locally installed `eslint-plugin-obsidianmd` 0.6.0 reports, so `npm run lint` covers these extra checks:

- **API version.** The local `no-unsupported-api` rule checks methods such as `setDestructive()`, but not plain properties with `@since`, such as `Plugin.settings`. The review checks both. `scripts/check-api-versions.mjs` uses the TypeScript compiler to report every unguarded Obsidian method or property that is newer than `minAppVersion`.
- **Settings.** "`PluginSettingTab` does not implement `getSettingDefinitions()`" was a warning. The plugin now uses the declarative settings API.
- **CSS.** The review reported duplicate properties in `styles.css`. Stylelint now runs in `npm run lint`, so CI and releases catch them.
- **Attestations.** Missing attestations were a recommendation. The Release workflow now attests `main.js` and `styles.css`.

To check a change before releasing, run `npm run lint`, then use **Review branch** in the portal.
