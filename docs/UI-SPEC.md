# CSV Importer: UI redesign spec

Evidence: `ui-preview/screenshots/` (`node ui-preview/build.mjs && node ui-preview/screenshot.mjs`). In file names, `x` means light or dark.

## 1. Top problems (ranked)

1. **The settings dialog is one scroll of over 2400px**, with every section at the same level (`c-config-extras-x-desktop-tall`, `d-config-advanced-x-desktop-tall`).
2. **An active row filter is hidden inside collapsed "Advanced"**, and the preview still says "Row 1 of 6" (`c-config-extras-filter-*`).
3. **Phone column cards are about 250px each.** The column name is right-aligned under "Use", and "Template…" is cryptic (`c-config-x-phone`).
4. **The run dialog CTA scrolls away on phone**, and the done-state button row is clipped ("…do import") (`e-run-preview-dark-phone`, `f-run-done-light-phone`).
5. **Banners and badges are inconsistent**: stacked drift and parser banners (`b-table-drift-*`), two callout styles in the run dialog (`e-run-preview-*`), saturated badge fills.
6. **Two `mod-cta` buttons compete in the table view**, Configure and Import are duplicated as header icons, and the phone toolbar wraps to 4 rows (`b-table-drift-light-phone`).
7. **Key matching is weak**: the free-text column is suggested, and a composite key is a dropdown plus a stray chip (`c-config-*-tall`).
8. **"Save" vs "Save and import" is ambiguous**, and button order differs between dialogs.
9. **Run list noise**: repeated folder prefixes, unchanged rows not listed, stat tiles wrap on phone.
10. **Index view** (`h-index-*`): duplicate H2, misaligned meta columns, "Re-import" on a never-imported CSV, border plus badge for a missing CSV, an icon-only Re-import on phone, and filter controls in the empty state.
11. **Settings tab** (`g-settings-*`): full-width short inputs, labels that differ from the dialog, no link to the imports view.

## 2. Import settings dialog

**Decision: tabs inside the modal**, with a sticky header and footer so only the panel scrolls. Collapsible sections were rejected: they keep the long scroll and hide state (problem 2).

| Tab | Content |
|---|---|
| **Columns** | Columns table, Re-detect types, extra properties |
| **Notes** | Target folder, file name, body, tags, source link, base |
| **Re-import** | When a note exists (+ sub-toggles), match notes by (key), adopt existing notes |
| **File & rows** | Encoding, delimiter, header, decimal/date order, list separator, empty cells, precision, **row filter** |

**Tab bar.** `role="tablist"` with arrow keys, scrolling horizontally on phone. A tab with a non-default setting gets a dot ("File & rows •").

**Summary line** under the title, each item linking to its tab: `6 rows · comma · → Data/timesheet/ · key: Datum + Rolle · filter: 4 of 6 rows`.

**Preview.**
- From 900px, a right pane (about 40%) on every tab; narrower, a "Preview" footer toggle.
- The pager respects the filter: "Row 1 of 4 (filtered)".

**Footer.** A `.modal-button-container` outside the scroll: `[Import now] [Save] [Cancel]`. "Import now" also saves. On phone, drop Cancel (use ×).

**Columns, desktop.** One 36px row per column, on a grid of `24px | 1fr | 1fr | 120px | 32px | 1.2fr`:
- Use checkbox.
- Source header: muted, ellipsized.
- Property input.
- Type dropdown.
- Options `clickable-icon` (`sliders-horizontal`, with an accent dot when anything is set). It expands an inline row (not a popover, so it works on touch) with:
  - "Value template": input, token chips and a live result.
  - For numbers only, "Ignore units (€, %, kg)".
- Sample `before → after`: each side ellipsized, full value in `title`.

The "Template…" pill and the per-row unit checkbox are removed.

**Columns, phone.** A list.
- Line 1: checkbox, **source name** (bold), type dropdown on the right.
- Line 2, muted: `→ property · sample`.
- Tapping a row expands its options. About 64px per collapsed row.

**Extra properties.** The same row grid: name, type, default, `trash-2`. Under the list, a single "Add property" button with a menu: Empty / ID (`{{uuid}}`).

**Key (Re-import tab).**
- "Match notes by" is a checkbox list of columns. Suggest only unique, short columns (never an average length over 30 characters).
- Selecting 2 or more columns reveals "Key property" with an example: `2026-11-18 | Softwareentwickler`.

## 3. Table view

**Toolbar.**
- Left: the filter input.
- Right: `Configure` (plain) and **one** `mod-cta` `Import 6 rows`.
- Below, a muted status line: `6 rows · 5 columns · semicolon · Imported 2 hours ago · Undo`. The absolute time goes in `title`.
- Remove the duplicate header icons except `file-plus`.

**Banners.** Show at most one callout, at the highest severity, with bullets and **one** action. Severity order:
1. Parser error.
2. Column drift, with a "Review columns" action that opens the Columns tab.
3. First-import info.

An active filter adds the bullet "Importing 4 of 6 rows (Rolle equals Softwareentwickler)".

**States.** Empty file: "This file has no rows." Parse failure: the callout. No filter match: `No rows match “…”`.

**Phone.**
- Row 1: filter input and a `sliders-horizontal` icon button.
- Row 2: the full-width primary button.
- The table scrolls horizontally with a sticky header row.

## 4. Import run dialog

- The header (title, `→ Data/timesheet/`) and the footer are sticky; only the list scrolls.
- **Stats.** One text line, no tiles: `2 new · 2 updated · 1 unchanged · 2 skipped · 1 failed`.
- **Groups.** `<details>` groups with counts, in this order:
  - Failed and Skipped: open.
  - New and Updated: open when there are 10 or fewer rows.
  - Unchanged: closed, but listed.

  Each row shows the path **relative to the target folder**, a muted `row 3`, and its detail line.
- **Callout.** "No key" and drift are merged into one callout (§7).
- **Preview footer.** `[Import 4 notes] [Cancel]`.
- **Done state.**
  - Title: "Import finished".
  - Footer: `[Close]` (cta) and `[Open base]`, plus a `more-horizontal` menu with Open first note, Save report as note, and Undo import (warning).
  - On phone, Close is full width and everything else goes into the menu.

## 5. Index view

- Drop the H2. Toolbar: search, `Re-import all`, `refresh-cw` icon.
- **Rows, not cards.**
  - A list with `--background-modifier-border` dividers, about 48px per row.
  - Header row, then a grid of `1fr name+folder | 140px last import | 80px notes | auto actions`.
- **Actions.**
  - A primary text button: `Import` if the CSV was never imported, otherwise `Re-import`.
  - A `more-horizontal` menu: Configure, Open base, Undo last import, a separator, then Delete imported notes… and Remove from index… (warning).
  - On desktop, Configure also appears as a hover icon.
- **Missing CSV.** Muted name, a `--text-warning` `alert-triangle` and "CSV missing". No colored border.
- **Phone.** Two lines per row:
  - Line 1: name, action button, menu.
  - Line 2: `Data · 2 h ago · 8 notes`.
- **Empty state.** A muted `table-properties` icon (32px), "No imports yet" and "Open a CSV file and choose **Import** to set one up." The search and "Re-import all" are hidden.

## 6. Settings tab

- **Headings.** Reading files · New notes · Re-import · Table view · Imports ("Open CSV imports" button) · Danger zone ("Reset all import settings…").
- **Widths.**
  - Single-character inputs: `4em`, centered.
  - Number inputs: `8em`.
  - Body template: a full-width textarea below its row.
- **Labels.** One shared set of `labels.ts` option maps with examples (e.g. "Dot (0.625)"), used by both the dialog and the settings tab.

## 7. Component rules

**Spacing.** `--size-4-1`, `--size-4-2`, `--size-4-3` and `--size-4-4` only: an 8px gap within groups, 16px between sections. No other raw px values, except borders.

**Type.**
- Body: `--font-ui-small`.
- Meta text: `--font-ui-smaller` with `--text-muted`.
- Headings: `Setting.setHeading()`.
- Monospace only for samples, tokens and YAML.

**Badges.** One `.csv-importer-badge`:
- Transparent background, 1px `--background-modifier-border`, `--radius-s`.
- `mod-success`, `mod-warning` and `mod-error` change only the text color (`--text-success` / `--text-warning` / `--text-error`). No filled badges.

**Callouts.** One component, `renderCallout(el, "info"|"warning"|"error", {title?, items[], action?})`. It emits native `.callout[data-callout]` markup so themes style it. No custom bars.

**Icons (Lucide).** `sliders-horizontal` configure, `file-plus` import, `refresh-cw` re-import, `undo-2`, `layout-list` base, `more-horizontal`, `trash-2`, `alert-triangle`, `info`, `chevron-right`, `key-round`, `filter`, `table-properties`.

**Focus.** Keep native outlines. Custom controls use `:focus-visible { box-shadow: 0 0 0 2px var(--background-modifier-border-focus) }`.

**Touch.** Targets are at least 44px under `.is-phone`. Icon buttons use `clickable-icon`.

**Motion.** None besides native `<details>`.

## 8. Copy changes

| Now | New |
|---|---|
| Import 7 rows as notes | Import 7 rows |
| Columns changed since the import settings were saved. Added: … Removed: … / Review | The CSV has new or missing columns: + Tage, − Kostenstelle. / Review columns |
| Template… | Options → "Value template" |
| Save and import | Import now |
| Match notes by column | Match notes by |
| Suggested: Beschreibung | Suggested: ID (unique in every row) |
| Import only some rows / Keep rows where | Filter rows / Import rows where |
| Row 3: Data/timesheet/timesheet 3.md | timesheet 3.md · row 3 |
| No imports yet. Open a CSV file and click Import to get started. | No imports yet. Open a CSV file and choose Import to set one up. |
| Add link to the CSV file / Add source link | Link notes to the CSV |

## 9. Work breakdown

**Step 0: Owner C does this first (about 1h); A and B rebase on it.**
- `dom.ts`: new `renderCallout`, plus `badge()`, `iconButton()` and `relPath()`.
- `labels.ts`: unified option maps and all §8 strings.
- `styles.css`: split into marked blocks `/* === owner:shared|config|table-run|index-settings === */`. Each owner edits only its own block; only C edits `shared`.

Block names (final, as used in `styles.css`): `owner:shared` (C only), `owner:config` (A), `owner:table-run` (B), `owner:index-settings` (C). The file header in `styles.css` repeats this. Step 0 is done: helpers `renderCallout/badge/iconButton/relPath` are in `src/view/dom.ts`, option maps and §8 strings are in `src/view/labels.ts`.

| Owner | Files | Scope |
|---|---|---|
| **A: Settings dialog** | `ImportConfigModal.ts`, `config/*` (new `Tabs.ts`, `ColumnRow.ts`, `copy.ts`) | §2 |
| **B: Table + run** | `CsvView.ts`, `TableRenderer.ts`, `ImportRunModal.ts` (new `runCopy.ts`) | §3, §4 |
| **C: Index + settings + shared** | `ImportIndexView.ts`, `settings.ts`, `dom.ts`, `labels.ts`, `shared.ts`, the shared CSS block | Step 0, §5, §6, §7 |

**Rules after step 0.**
- A and B put new strings in their own copy files and ask C for changes to the shared files.
- Each owner adds its scenarios to `ui-preview/scenarios.ts` in a named block and verifies light and dark, desktop and phone.
