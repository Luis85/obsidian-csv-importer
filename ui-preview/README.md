# ui-preview: screenshot harness for design review

Renders the plugin's **real** UI code (`src/view/CsvView.ts`, `ImportConfigModal.ts` + `config/*`,
`ImportRunModal.ts`, `src/settings.ts`) plus the repo's `styles.css` in headless Chromium, against a
stand-in for Obsidian, and takes screenshots. Nothing under `src/`, `styles.css`, or `tests/` is modified;
everything lives in this folder.

## Run

```
node ui-preview/build.mjs && node ui-preview/screenshot.mjs
```

- `build.mjs` bundles `scenarios.ts` with esbuild (the `obsidian` import is replaced by `obsidian-shim.ts`)
  and writes `ui-preview/dist/index.html` (theme CSS + `styles.css` + bundle inlined).
- `screenshot.mjs [filter]` writes `ui-preview/screenshots/<scenario>-<light|dark>-<viewport>.png`
  (it clears the folder first; the optional filter is a substring of the scenario name, e.g. `c-config`).
  Console errors / page errors are printed per screenshot.
- Viewports: `desktop` 1280x860, `phone` 390x844, and `desktop-tall` 1280x2400 for the dialog scenarios
  (c to g) so long dialogs are visible without internal scrolling. deviceScaleFactor is 1.
- Open a scenario manually: `dist/index.html?theme=dark&mobile=1#c-config` (`theme=light|dark`, `mobile=1`
  adds `is-phone`/`is-mobile` body classes; hash = scenario name).

Scenarios: see the `scenarios` object at the end of `scenarios.ts` (table view `a-`/`b-`, import settings `c-`/`d-`, run dialog `e-`/`f-`, settings tab `g-`, CSV imports `h-`). Add more there.

If `src/view` has a transient compile error the build fails: fix or wait, then rerun. Any value the plugin
imports from `obsidian` that the shim lacks is auto-stubbed at build time (a warning is printed and using it
logs `ui-preview shim gap` to the console) so new imports do not break the build.

## Limitations (it is an approximation)

- `obsidian-theme.css` approximates Obsidian's default light/dark theme from memory (colors, 30px controls,
  toggles, modals, settings rows, view header). Fonts, exact spacing, focus rings, scrollbars, and the mobile
  layout (bottom sheet modals, stacked settings rows) are close but not exact. Obsidian's real mobile
  `.modal-button-container` behavior is not reproduced exactly (here buttons do not wrap).
- The settings tab is declarative (`getSettingDefinitions()`). `scenarios.ts` renders the definitions as
  `Setting` rows with `renderDefinitions()`; Obsidian's own renderer is not emulated exactly, so group headings
  and row styling may differ slightly.
- `node ui-preview/readme-shots.mjs` regenerates the README screenshots in `docs/images/` at 2x.
- Menu, Notice, `AbstractInputSuggest` (no-op, no folder dropdown), Platform are minimal. Icons: only the
  lucide icons the plugin uses are embedded; unknown names render as a dot.
- No real vault: `App.vault` is a stub with a few fake folders; the host (`FakeHost`) keeps config in memory
  and the import run uses canned `ImportResult` data, not the real importer.
- Only static states are captured (no hover/focus, open menus, progress bar mid-run, or toasts).
