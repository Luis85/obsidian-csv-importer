# CSV Importer: UI spec

The current spec for the plugin's interface. It describes the UI as built; when you change the UI, change this file in the same commit. Where it and the code differ, the strings in `src/view/labels.ts`, `src/view/config/copy.ts` and `src/view/runCopy.ts` are authoritative for wording, and this file is authoritative for structure. User-facing behavior is documented in the [README](../README.md).

History: the first redesign ([archive/UI-SPEC-first-pass.md](archive/UI-SPEC-first-pass.md)) introduced tabs, the summary line, one callout at a time and the component rules. The second pass ([archive/UX-REVIEW-2026-11.md](archive/UX-REVIEW-2026-11.md)) set the information architecture, the vocabulary and the current tab order. Both are implemented; this file merges them.

Evidence for layout decisions: `node ui-preview/build.mjs && node ui-preview/screenshot.mjs` (screenshots in `ui-preview/screenshots/`; in file names, `x` means light or dark). Final spacing is checked in real Obsidian with the end-to-end suite.

## 1. Places and vocabulary

The plugin has five places. Each answers one question, and every surface uses the same name for it.

| Place | Question it answers | Name used everywhere |
|---|---|---|
| Table view | What is in this CSV, and is it ready to import? | (the file name) |
| Import settings dialog | What does each note look like, and how are re-imports matched? | **Import settings** |
| Import run dialog | What will happen (or happened) to each note? | **Import preview**, **Importing**, **Import finished** |
| CSV imports view | Which CSVs are set up, and which need attention? | **CSV imports** |
| Plugin settings tab | What do new CSVs start with? | Intro: "Defaults for CSV files you have not set up yet." |

User goals, and where they happen:

| Goal | Where |
|---|---|
| See what is in a CSV | Table view |
| Turn rows into notes with the right property types | Table view → Import settings → Import preview |
| Keep the notes in step when the CSV changes, without losing edits | Table view or CSV imports → Import preview |
| Find, fix or undo an import | CSV imports, file menu, commands |
| Set sensible defaults once | Plugin settings tab |

### Vocabulary (one word per concept)

| Concept | Use | Do not use |
|---|---|---|
| The per-CSV configuration and its dialog | Import settings | Configure, Configure CSV import, config |
| Running an import | Import, or Re-import when the CSV was imported before | Import rows as notes, Save and import |
| Reverting | Undo last import (the table view's status line may say **Undo**, with "Undo last import" as tooltip) | Undo last CSV import, Undo import |
| The list of set-up CSVs | CSV imports | imports index, index (in UI copy) |
| The key | Match notes by | key column, ID column (in UI copy) |
| No key set | matched by file name | no key |
| Notes the CSV did not create | not created by this import | foreign, adopted (in UI copy) |

Command names follow the same words: **Open CSV imports**, **Import current CSV file**, **Open import settings for current CSV file**, **Undo last import of current CSV file**, **Re-import all CSV imports**. Command IDs are stable and do not change with the names.

## 2. Import settings dialog

**Structure.** Tabs inside the modal, with a sticky header (title, summary line, tab bar) and footer, so only the panel scrolls. Collapsible sections were rejected in the first pass: they keep the long scroll and hide state, such as an active row filter.

**Tabs, ordered as the user decides.** Tab ids are stable (`columns`, `notes`, `rows`, `reimport`, `file`); tests and other views open tabs by id.

| Tab | Content |
|---|---|
| **Properties** | Column table (use, property name, type, options, sample), **Re-detect types**. **Extra properties** with its own heading. **Values**: **Empty cells**, **Number precision**. The tab name is the heading; the column table has none of its own. |
| **Notes** | **Target folder**, **File name template**, **Body template**, **Comma-separated tags**, **Link notes to the CSV**, **Create a base**. |
| **Rows** | **Filter rows** (**Import rows where** column, operator, value) with a live count: "4 of 6 rows match." |
| **Re-import** | **Match notes by** first, then **When a note already exists** (with **Keep values edited in Obsidian** and **Keep values when the CSV cell is empty** under Update properties), then **Update notes not created by this import**. |
| **File format** | **Encoding**, **Delimiter**, **First row contains column names**, **Decimal separator**, date order, **List separator**. Rarely touched, so last. The dialog opens on this tab when the file looks misread. |

**Tab bar.** `role="tablist"`, arrow keys plus Home and End, scrolls horizontally on phone. A tab whose settings differ from the defaults gets a dot, and its `aria-label` adds "changed from default".

**Summary line** under the title. Each part is a flat button that opens its tab: `6 rows · comma · → Data/timesheet/ · matched by file name · filter: 4 of 6 rows`. With a key: `matched by Datum + Rolle`. "matched by file name" is muted.

**Preview.**
- From 900px wide, a preview pane on the right on every tab, and no **Preview** button.
- Narrower, a **Preview** button at the start of the footer swaps the settings for the preview.
- The pager follows the filter: "Row 1 of 4 (filtered)".

**Footer.** A `.modal-button-container` outside the scroll: `[Preview] … [Import now] [Save] [Cancel]`. **Import now** (`mod-cta`) saves, closes and opens the import preview. On phone, Cancel is hidden (use ×). Choosing **Replace whole note** asks for confirmation on save.

**Columns, desktop.** One row per column on a grid of `24px | 0.8fr | 1fr | 120px | 32px | 1.3fr`:
- **Use** checkbox.
- Source header: muted, ellipsized, full name in `title`.
- Property name input.
- Type dropdown.
- **Options** `clickable-icon` (`sliders-horizontal`, accent dot when anything is set; tooltip **Show options** / **Hide options**). It expands an inline row (not a popover, so it works on touch) with **Value template** (input, token chips, live **Result**) and, for numbers only, **Ignore units (€, $, %)**.
- **Sample**: the converted value; the raw cell and the conversion (`raw → converted`) in `title` when they differ.

**Columns, phone.** A list. Line 1: checkbox, **source name** (bold), type dropdown on the right. Line 2, muted: `→ property · sample`. Tapping a row expands its options.

**Extra properties.** Heading **Extra properties** and the description "Properties that are not columns, such as status or an ID. Written to the notes only, the CSV is not changed." Rows on the same grid: name, type, default, `trash-2`. Under the list, one **Add property** button with a menu: **Empty property**, **ID (unique per note)** (`id` with default `{{uuid}}`). A name that is also a CSV column gets an inline warning.

**Match notes by (Re-import tab).**
- A checkbox list of columns. A column shows a hint only when it helps: "suggested", or "has duplicates" / "has empty cells" as a warning.
- While no key is set and a good column exists: "Suggested: ID (unique in every row)" and a real **Use ID** button.
- Suggestions never pick free text: no column with an average value over 30 characters, and no column whose values are mostly several words unless its name says it is an ID. Code-like columns come first.
- Ticking two or more columns shows **Key property** (default `import_key`) with an example: `Example: 2026-11-18 | Softwareentwickler`.

## 3. Table view

**Toolbar.**
- Left: the filter box ("Filter rows…").
- Right: **Import settings** (plain; icon only on phone, with the name as tooltip) and **one** `mod-cta` button, **Import 6 rows**, or **Import 2 selected rows** while rows are selected.
- The view header keeps one action icon, `file-plus` (Import). The more-options menu (⋮) has **Import settings** and **Open CSV imports**.

**Status line** below, muted: `6 rows · 5 columns · semicolon · + 1 extra property · Imported 2 hours ago · Undo`. The absolute time is in `title`. **Undo** is a muted link button with the tooltip "Undo last import". When the CSV changed since the last import: "Changed since last import · Re-import". While rows are selected: "2 rows selected · Clear selection". On phone the import history starts its own line.

**Row selection.** A checkbox per row; the header checkbox (tooltip "Select rows to import only those") selects every row that matches the filter; shift-click selects a range.

**Callouts.** At most one, at the highest severity, with bullets and at most one action:
1. Read error ("Could not read this file").
2. Column drift and parser warnings, with **Review columns** (opens the Properties tab).
3. First import ("Ready to import") or an active row filter ("Row filter").

The title names the problem ("Columns changed", "Unclosed quote in the file"). When unrelated problems are merged, the title counts them ("2 things to check"). An active filter adds the bullet "Importing 4 of 6 rows (Rolle equals Softwareentwickler)".

**States.** Empty file: "This file has no rows." No filter match: `No rows match “…”`. Long tables are paged; **Show more** appends rows.

**Phone.** Row 1: filter box and the **Import settings** icon button. Row 2: the full-width primary button. The table scrolls horizontally with a sticky header row; type badges stay on the header line.

## 4. Import run dialog

One dialog for preview, progress and report. The header (title, headline, `→ Data/timesheet/`) and the footer are sticky; only the list scrolls.

- **Titles.** **Import preview** (dry run, nothing written), **Importing** (progress with **Stop import**), **Import finished**.
- **Headline.** One sentence first: "4 notes will be written to Data/timesheet/. 3 rows need attention." When done: "4 notes written to Data/timesheet/."
- **Counts.** One text line, zero counts left out: `2 new · 2 updated · 1 unchanged · 2 skipped · 1 failed`.
- **Groups.** `<details>` with counts, in this order: **Failed** and **Skipped** open; **New** and **Updated** open with 10 rows or fewer; **Unchanged** closed but listed. Each row shows the path relative to the target folder, a muted `row 3`, and its detail line (changed properties, reason).
- **Choosing notes.** In the preview, **New** and **Updated** rows and groups have checkboxes; the button follows: **Import 6 notes**, or **Import 4 of 6 notes**.
- **Callout.** Warnings (parser, no key, duplicate keys, large import, row filter, extra property ignored) share one callout. Its title names the problem ("Notes are matched by file name") or counts kinds ("2 things to check").
- **Preview footer.** `[Import 4 notes] [Cancel]`.
- **Done footer.** The `mod-cta` button is where the user is headed and closes the dialog: **Open base** when the import has a base, otherwise **Open first note**. Then a plain **Close**, and a `more-horizontal` button (**More actions**) with **Open first note** (when Open base is primary), **Save report as note** and **Undo last import**. On phone, the primary button (or Close, if there is none) fills the row and More actions sits at the end.

## 5. CSV imports view

- **No H2.** Toolbar: filter box ("Filter imports..."), **Add CSV** (menu button: **Scan vault for CSV files...**, **Copy a file from your device...**), **Re-import all**, and a `refresh-cw` icon button.
- **Changed CSVs.** When any CSV changed since its last import, an info callout above the list: "2 CSV files changed since their last import" with **Re-import changed**.
- **Rows, not cards.** A list with `--background-modifier-border` dividers. Header row, then a grid of `1fr name+folder | 140px last import | 80px notes | actions`.
  - The file name is a link (text, accent on hover, underline on focus), not a button.
  - Under the name: the last result ("12 new · 5 updated · 120 unchanged · 2 skipped") and "N edited since import" (with the edited properties on hover).
  - A **Changed** badge (warning) when the CSV changed.
  - Notes column: the count of notes the import owns, a muted dash when there are none.
- **Actions per row.**
  - A primary text button: **Import** if the CSV was never imported, otherwise **Re-import**. It is `mod-cta` only on changed rows.
  - On desktop, an **Import settings** icon button (`sliders-horizontal`) on hover.
  - A `more-horizontal` menu: **Import settings**, **Open base**, **Undo last import**, a separator, then **Delete imported notes...** and **Remove from CSV imports...** (warning).
- **Missing CSV.** Muted name, a `--text-warning` `alert-triangle` and "CSV missing". No colored border, no primary button.
- **Phone.** Two lines per row. Line 1: name, action button, menu. Line 2: `Data · 2 h ago · 8 notes`. Nothing repeats between the lines.
- **Empty state.** A muted `table-properties` icon, "No imports yet" and "Open a CSV file and choose **Import** to set one up, or use **Add CSV**." The filter box and **Re-import all** are hidden.

## 6. Settings tab

Declarative settings (`getSettingDefinitions()`), ordered by the user's journey:

1. Intro: "Defaults for CSV files you have not set up yet. Each CSV keeps its own import settings."
2. **CSV imports**: an **Open CSV imports** button.
3. **New notes**: Target folder, File name template, Body template, Comma-separated tags, Link notes to the CSV, Create a base.
4. **Re-import**: When a note already exists, Keep values edited in Obsidian, Keep values when the CSV cell is empty.
5. **Reading files**: Encoding, Delimiter, First row contains column names, Decimal separator, List separator, Empty cells, Treat midnight timestamps as dates.
6. **Table view**: Rows shown per page.
7. **Danger zone**: **Reset all import settings**, with a destructive **Reset…** button that opens a confirmation.

- **Widths.** Single-character inputs: `4em`, centered. Number inputs: `8em`. Body template: a full-width textarea below its row.
- **Labels.** Names, option maps (with examples, such as "Dot (0.625)") and descriptions come from `labels.ts`. A setting that exists in both the settings tab and the import settings dialog uses the same name and description in both.

## 7. Component rules

**Spacing.** `--size-4-1`, `--size-4-2`, `--size-4-3` and `--size-4-4` only: an 8px gap within groups, 16px between sections. No other raw px values, except borders and the grid tracks above.

**Type.**
- Body: `--font-ui-small`.
- Meta text: `--font-ui-smaller` with `--text-muted`.
- Headings: `Setting.setHeading()` (`sectionHeading()` in `dom.ts`).
- Monospace only for samples, tokens and YAML.

**Badges.** One `.csv-importer-badge` (`badge()` in `dom.ts`):
- Transparent background, 1px `--background-modifier-border`, `--radius-s`.
- `mod-success`, `mod-warning` and `mod-error` change only the text color (`--text-success` / `--text-warning` / `--text-error`). No filled badges.

**Callouts.** One component, `renderCallout(el, "info" | "warning" | "error", { title?, items, action? })` in `dom.ts`. It emits native `.callout[data-callout]` markup so themes style it. No custom bars.

**Icons (Lucide).** `sliders-horizontal` import settings, `file-plus` import, `refresh-cw` refresh, `undo-2` undo, `layout-list` base, `more-horizontal` more actions, `trash-2` delete, `x-circle` remove from CSV imports, `alert-triangle` missing, `table-properties` CSV imports, `link` link values, `eye` / `eye-off` include / exclude, `chevron-down` menu buttons, `search` scan, `upload` copy from device.

**Focus.** Keep native outlines. Custom controls use `:focus-visible { box-shadow: 0 0 0 2px var(--background-modifier-border-focus) }`.

**Touch.** Targets are at least 44px under `.is-phone`. Icon buttons use `clickable-icon`.

**Motion.** None besides native `<details>`.

**CSS constraints** (checked by `npm run lint`, see [SUBMISSION.md](SUBMISSION.md)):
- Obsidian CSS variables, no inline styles, no `!important`, no repeated property in one rule.
- No `:has()`: the community directory review flags it, and Stylelint forbids it. Add a class in code instead (for example `has-primary` on the run dialog's button row).
- Only features fully supported in Chrome 120 and later (`stylelint-no-unsupported-browser-features`). Use the `gap` shorthand, not `column-gap`; avoid `display: contents` and `scrollbar-width`.

## 8. Copy changes

Wording that was replaced, so it does not come back. Current strings live in `labels.ts`, `config/copy.ts` and `runCopy.ts`.

| Before | Now |
|---|---|
| Import 7 rows as notes | Import 7 rows |
| Columns changed since the import settings were saved. Added: … Removed: … / Review | The CSV has new or missing columns: + Tage, − Kostenstelle. / Review columns |
| Template… | Options → Value template |
| Save and import | Import now |
| Configure, Configure CSV import | Import settings |
| Configure import for current CSV file | Open import settings for current CSV file |
| Undo last CSV import, Undo import | Undo last import |
| Re-import all configured CSV files | Re-import all CSV imports |
| Remove from index | Remove from CSV imports... |
| Match notes by column | Match notes by |
| no key (summary) | matched by file name |
| Suggested: Beschreibung | Suggested: ID (unique in every row), only for short, unique, non-free-text columns |
| Import only some rows / Keep rows where | Filter rows / Import rows where |
| Columns, File & rows (tabs) | Properties, Notes, Rows, Re-import, File format |
| Row 3: Data/timesheet/timesheet 3.md | timesheet 3.md · row 3 |
| Warning (callout title) | A title that names the problem, or "2 things to check" |
| No imports yet. Open a CSV file and click Import to get started. | No imports yet. Open a CSV file and choose Import to set one up, or use Add CSV. |
| Add link to the CSV file / Add source link | Link notes to the CSV |

## 9. Working on the UI

- `styles.css` is split into marked blocks: `owner:shared` (badges, callouts, buttons, focus and touch rules), `owner:config` (import settings dialog), `owner:table-run` (table view and run dialog), `owner:index-settings` (CSV imports view and settings tab). Edit the block for the code you change; see [CONTRIBUTING.md](../CONTRIBUTING.md#styles).
- New strings go in the copy file of the surface (`config/copy.ts`, `runCopy.ts`) or, when shared, in `labels.ts`. Keep README labels in step.
- Add a scenario to `ui-preview/scenarios.ts` for every new dialog state and check light and dark, desktop and phone. Elements that end-to-end specs assert get a `data-testid`.
