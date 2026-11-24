# Contributing

## Development setup

Requires Node 20.19 or newer.

```sh
npm install
npm run dev      # watch build
```

Copy (or symlink) `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/csv-importer/` to try a build, then reload Obsidian.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | esbuild watch build |
| `npm run build` | typecheck and production build |
| `npm run typecheck` | `tsc` only |
| `npm test` | vitest, single run |
| `npm run test:watch` | vitest in watch mode |
| `npm run lint` | ESLint (with `eslint-plugin-obsidianmd`), Stylelint and the API version check |
| `npm run lint:css` | Stylelint only |
| `npm run lint:api` | API version check only |
| `npm run test:e2e` | End-to-end tests in real Obsidian (see below) |
| `npm run test:e2e:mobile` | The same suite's UI specs in mobile emulation |
| `npm run screenshots:readme` | Regenerates the README images from real Obsidian |

## Architecture

Modules in `src/`:

| Path | Role |
| --- | --- |
| `main.ts` | Plugin class: commands, ribbon icon, file menu, view registration, wiring |
| `host.ts` | Interfaces the views and modals use to talk to the plugin (no circular imports) |
| `types.ts`, `defaults.ts` | Shared types, default settings and config migration (schema version) |
| `settings.ts` | Settings tab, declarative (`getSettingDefinitions()`), intro and "Open CSV imports" first, then grouped as New notes, Re-import, Reading files, Table view, Danger zone |
| `configStore.ts` | In-memory per-file configs keyed by vault path |
| `storage.ts` | Persistence: `data.json`, and under `imports/` the `index.json`, `<hash>.json` (snapshot) and `<hash>.undo.json` per CSV |
| `core/result.ts`, `core/util.ts` | Outcome reasons and small pure helpers |
| `csv/parser.ts` | Quote-aware CSV parsing, delimiter detection, warnings |
| `csv/encoding.ts` | Encoding detection and decoding |
| `csv/typeInference.ts` | Per-column type inference and value conversion (dates, date order, units, numbers) |
| `import/templates.ts` | The single template engine (`{{Column}}`, `{{row}}`, `{{file}}`, `{{value}}`, `{{today}}`, `{{now}}`, `{{uuid}}`) |
| `import/yaml.ts` | Typed YAML serialization |
| `import/folders.ts` | File name sanitizing and target folder resolution |
| `import/noteBuilder.ts` | Turns rows into planned notes (templates, key, row filter, extra properties), no vault access |
| `import/merge.ts` | Merges a planned note into an existing one (update mode, edit protection) |
| `import/ownership.ts` | Pure policy: may an import change this existing note? |
| `import/importer.ts` | Runs an import: matching, outcomes, dry run |
| `import/vaultGateway.ts` | `VaultGateway` interface over Obsidian's vault, so the importer can be tested with a fake |
| `import/pathIndex.ts` | Case-insensitive lookup of paths the run touches |
| `import/checkpointer.ts` | Decides when a running import persists snapshot and undo data |
| `import/undo.ts` | Undo manifest recording and applying |
| `import/baseFile.ts` | Generates the `.base` file content |
| `obsidian/importService.ts` | Import, undo, delete and index flows against the vault and dialogs |
| `obsidian/vaultEvents.ts` | Keeps configs and import state in step with renames and deletions |
| `obsidian/baseFiles.ts` | Locates, creates and opens `.base` files |
| `view/CsvView.ts`, `view/TableRenderer.ts` | Table view and its table |
| `view/ImportConfigModal.ts`, `view/config/*` | Import settings dialog: `Tabs`, `ColumnsSection`, `ColumnRow`, `ExtraPropertiesSection`, `OutputSection`, `AdvancedSection`, `PreviewPane`, `ConfigDraft` (shared draft state), `keys`, `chips`, `FolderSuggest`, `copy.ts` (dialog strings) |
| `view/ImportRunModal.ts`, `view/runCopy.ts` | Preview, progress and report dialog, and its strings |
| `view/ImportIndexView.ts` | CSV imports index |
| `view/labels.ts` | Shared strings and option maps (settings tab, dialog, table view) |
| `view/dom.ts` | `renderCallout`, `badge`, `iconButton`, `relPath` and other DOM helpers |
| `view/ConfirmModal.ts`, `view/shared.ts`, `view/relativeTime.ts` | Small shared UI pieces |

Pure logic (`core/`, `csv/`, and most of `import/`) does not need Obsidian at runtime beyond types, so it is tested without it. UI strings live in `view/labels.ts`, `view/config/copy.ts` and `view/runCopy.ts`; reuse them rather than writing literals, and keep `README.md` labels in step. `docs/UI-SPEC.md` is the design spec for the interface.

## Testing

Tests are in `tests/` and run with vitest. `tests/mocks/obsidian.ts` is a mock of the parts of the `obsidian` module the code uses (vault, files, `Notice`, and so on); `tests/mocks/setup.ts` wires it in. Add a test with every behavior change. `acceptance.test.ts` and `reimport.test.ts` cover end-to-end imports and re-imports.

## Lint

`npm run lint` runs three checks, in this order:

1. `eslint .` with `eslint-plugin-obsidianmd` (the rules the community plugin review applies). Typical points: sentence case UI text, no `innerHTML`, no default hotkeys, `vault.process` instead of `vault.modify`, no stray `console.log`.
2. `stylelint styles.css` (`.stylelintrc.json`), mainly to catch duplicate declarations, which the community directory review reports.
3. `node scripts/check-api-versions.mjs`. It uses the TypeScript compiler to report every Obsidian API (method or property) whose `@since` is newer than `minAppVersion` in `manifest.json` and is not guarded by `requireApiVersion`. Why: the community directory review checks this, but `eslint-plugin-obsidianmd`'s `no-unsupported-api` rule only checks methods, not plain properties (for example `Plugin.settings`). Run it alone with `npm run lint:api`; `npm run lint:css` runs Stylelint alone.

`minAppVersion` is 1.15.1. Raising it relaxes the API check; lowering it can make the check fail. See [docs/SUBMISSION.md](docs/SUBMISSION.md) for the full checklist.

## UI preview

`ui-preview/` renders the real view code and `styles.css` in headless Chromium against a stand-in for Obsidian, so UI changes can be checked in light and dark, on desktop and phone sizes, without Obsidian.

```sh
node ui-preview/build.mjs && node ui-preview/screenshot.mjs [filter]
```

Screenshots go to `ui-preview/screenshots/`; `filter` is a substring of a scenario name (for example `c-config`). Scenarios are in `ui-preview/scenarios.ts`: add one when you add a dialog state. The theme is an approximation, so check final spacing in Obsidian itself. Details are in `ui-preview/README.md`.

## End-to-end tests

`test/e2e/` runs the plugin in real Obsidian with [WebdriverIO](https://webdriver.io) and [wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service). The service downloads Obsidian, installs the built plugin (`main.js`, `manifest.json`, `styles.css` from the repository root) into a copy of the fixture vault `test/e2e/vaults/base/`, and drives the app. Every user flow of the README has a spec; `test/e2e/USER-FLOWS.md` maps flows to specs and lists the flows still pending. Unit tests (`npm test`, vitest) are separate and unchanged.

How the specs work: functional specs use the plugin's commands, its real dialogs and `app` APIs through `browser.executeObsidian`. UI clicks are used where the UI is under test (badge menus, dialogs, index rows). Elements the specs assert have `data-testid` attributes. Each spec ends by asserting that the plugin logged no errors or warnings. State is reset before every test (`resetEverything` in `test/e2e/support.ts`: fixture files, the plugin's saved data, plugin restart).

```sh
npm run test:e2e                    # builds first (pretest:e2e), then runs earliest and latest Obsidian
npm run test:e2e:mobile             # builds first, runs the UI specs in Obsidian's mobile emulation (390x844)
OBSIDIAN_VERSIONS="latest/latest" npm run test:e2e   # one version, "app/installer" pairs separated by spaces
npm run screenshots:readme          # rewrites docs/images/*.png from real Obsidian (see below)
```

Environment variables: `OBSIDIAN_VERSIONS` (default `earliest/earliest latest/latest`; `earliest` is `minAppVersion`), `WDIO_MAX_INSTANCES` (default 1), `E2E_MOBILE` (`1` adds a mobile-emulation run to the desktop ones, `only` runs just that), `E2E_STRICT_CONTRAST=1` (turns on the check listed under known findings in `USER-FLOWS.md`).

On Linux Obsidian needs a display. Locally: `xvfb-run -a npm run test:e2e`. If Node's `fetch` does not use your proxy when downloading Obsidian versions, run with `NODE_USE_ENV_PROXY=1` (Node 22.21 or newer). CI (`.github/workflows/e2e.yml`) installs `herbstluftwm dzen2 x11-xserver-utils`, starts `Xvfb :99` and a window manager, runs the desktop job and the mobile job, and uploads `reports/e2e/` (screenshots, contrast reports, logs) on every run. It runs on pull requests that touch the plugin or the suite, nightly, and on demand. The Obsidian download cache `.obsidian-cache/` is keyed on `manifest.json` and `wdio.conf.mts`.

Outputs, all gitignored: `reports/e2e/screenshots/<spec>/<step>.png` (key steps of each flow, light and dark for UI-heavy steps), `reports/e2e/appearance-contrast.json` (measured contrast per text), `reports/e2e/failures/` (a screenshot per failed test) and `reports/e2e/logs/`.

Limitations: Obsidian downloads come from GitHub (`raw.githubusercontent.com` and `github.com` release assets), so the first run needs network access; later runs use `.obsidian-cache/`. Mobile emulation is the desktop app in a phone-sized window, not the real mobile app. The functional import and undo specs run on desktop only. Beta versions need an Obsidian account and are not used.

README images: `npm run screenshots:readme` runs only `readme-screenshots.e2e.ts`, which sets up the example vault state in the latest Obsidian with the default light theme, resizes the window and captures the five images at a device scale factor of 2 into `docs/images/` under the names the README uses. Run it after UI changes and commit the new images.

## Styles

`styles.css` is split into marked blocks, one per owner area. Edit only the block for the code you are changing:

| Block | Used by |
| --- | --- |
| `owner:shared` | Badges, callouts, buttons, focus and touch rules used by every view |
| `owner:config` | Import settings dialog (`ImportConfigModal`, `config/*`) |
| `owner:table-run` | Table view and import run dialog |
| `owner:index-settings` | CSV imports index and settings tab |

Use Obsidian CSS variables and the spacing rules in `docs/UI-SPEC.md` section 7. Do not repeat a property in one rule (Stylelint fails on it).

## Release process

Releases are automated by the [release workflow](.github/workflows/release.yml).

1. Add your changes under a `## Unreleased` heading in `CHANGELOG.md`. The workflow renames it to the version and uses it as release notes.
2. Run the **Release** workflow from the Actions tab, or `gh workflow run release.yml -f version=minor`. The `version` input is one of `current` (release the version already in `manifest.json`), `patch`, `minor`, `major` or an explicit `x.y.z`.
3. The workflow bumps `package.json`, `manifest.json` and `versions.json`, runs lint, tests and build, creates build provenance attestations for `main.js` and `styles.css`, commits `Release x.y.z`, pushes the tag (no `v` prefix) and publishes a GitHub release with `main.js`, `manifest.json` and `styles.css`. BRAT picks it up automatically.

Notes:

- Run the workflow from a branch. The selected ref must be a branch, not a tag; the workflow pushes the release commit to it. The workflow file must exist on the default branch to be run manually.
- If the branch is protected, allow `github-actions[bot]` to push.
- Alternatives that do not bump the version: push a tag equal to the `manifest.json` version (`git push origin 1.2.3`), or publish a release in the GitHub UI with such a tag. Both build and attach the files.
- To publish to the community directory (community.obsidian.md), see [docs/SUBMISSION.md](docs/SUBMISSION.md).
