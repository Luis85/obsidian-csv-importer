# Changelog

## Unreleased

### Fixes
- **Empty cells: Omit property**: a value you add in Obsidian to a property the CSV left empty is now protected on re-import (with **Keep values edited in Obsidian**), instead of being overwritten once the CSV has a value. Omitted properties stay managed by the import, and a tags cell that holds no tags (for example `#`) is treated like an empty cell.

## 0.4.0
### UI and UX
Second UI/UX pass with a clearer information architecture; see `docs/archive/UX-REVIEW-2026-11.md`.
- **One name per concept** across buttons, menus and commands: **Import settings** (was Configure / Configure CSV import), **Undo last import**, **CSV imports**. Command names changed, command IDs did not: **Import current CSV file**, **Open import settings for current CSV file**, **Re-import all CSV imports**.
- **Import settings** tabs are ordered as you decide: **Properties** (columns, **Extra properties** with its own heading, **Values**: empty cells and number precision), **Notes**, **Rows** (the row filter, moved out of the file tab), **Re-import** (**Match notes by** first), **File format**. The summary says "matched by file name" instead of "no key"; the Preview button is hidden while the preview pane is visible; samples show the converted value once, with the raw value in the tooltip.
- **Key suggestion** never picks free text (columns whose values are mostly several words), prefers code-like columns, and marks columns with duplicates or empty cells; **Use X** is a real button.
- **Table view**: callout titles name the problem ("Columns changed", or "2 things to check" when several kinds are merged); the header checkbox explains row selection; **Undo** is a muted link; the more-options menu has **Import settings** and **Open CSV imports**; the phone header row stays compact.
- **Import preview and report** open with one sentence ("4 notes will be written to Data/timesheet/. 3 rows need attention."). When done, **Open base** (or **Open first note**) is the main button and closes the dialog; **Close** is plain.
- **CSV imports**: file names are links; changed CSVs get a **Changed** badge and a highlighted **Re-import**; **Scan vault** and **Add CSV file** are under one **Add CSV** menu; a dash when an import owns no notes; no repeated text on phones.
- **Settings tab** is ordered as the journey (CSV imports, New notes, Re-import, Reading files, Table view, Danger zone), shares descriptions with the import settings, and marks the reset button as destructive.

### Development
- Code quality: fallow dead-code and duplication findings fixed (30 and 14 to 0), complex functions split into named helpers (94 to 67 above the threshold).
- All tests are under `tests/`: unit tests in `tests/unit/`, end-to-end tests in `tests/e2e/` (was `test/e2e/`).
- CSS: `:has()` replaced by a class (flagged by the community directory review) and forbidden by Stylelint.
- Mutation testing with Stryker (`npm run test:mutation`). The release workflow runs it in an advisory `mutation` job next to the release: a score below 90 % shows as a warning and does not block the release yet. The score went from 68.2 % to 93.8 % with 236 new behavior tests (607 unit tests in total).
- Code-quality checks with fallow (`npm run quality`): dead code, duplication and complexity. The release workflow reports findings that are not in `.fallow-baselines/` as warnings; it does not block the release yet.

## 0.3.0
### Fixes
- CSS: replaced `column-gap` (flagged as partially supported multi-column CSS in the 0.2.0 review) with `gap`, and removed other partially supported features; Stylelint now checks browser support.

### Features
- **Scan vault** in the CSV imports index lists every CSV file that is not in the index yet (size and row count, all checked) and adds the chosen ones with default settings, without importing.
- **Add CSV file...** copies a CSV from outside the vault into a folder you choose (system file picker, works on mobile; bytes unchanged; **Replace** or **Keep both** when the name exists), adds it to the index and opens it.
- **Changed CSV files**: the index marks CSV files that changed since their last import (**Changed** badge with the time, highlighted **Re-import**), shows "N CSV files changed since their last import" with **Re-import changed**, and updates live when a CSV is modified, renamed or deleted. The table view can ask the plugin for the same status.
- The index shows the counts of the last import ("12 new · 5 updated · 120 unchanged · 2 skipped") and "N edited since import" for notes whose managed properties you changed.
- The plugin announces changes (settings saved, import, undo, delete, remove) on the workspace event `csv-importer:changed`, and `importFile` accepts the rows to import.

### Fixes
- The **Open CSV imports** command now brings an already open index to the front.

### Privacy
- The file picker of **Add CSV file...** reads only the file you select, only when you do, and copies it into the vault. Documented in the README and the submission guide.

### Docs
- Submission guide rewritten for the community directory portal (community.obsidian.md), which replaced pull requests to obsidian-releases: claim flow, scorecard severities, re-review, current requirements and README disclosures.

## 0.2.0
### Features
- **CSV imports index**: a ribbon icon and command **Open CSV imports** open a list of every configured CSV with last import, note count and status. Re-import, configure, open the base or undo from the list, re-import everything at once, and **Delete imported notes** (moves only the notes this import owns to the trash) or **Remove from index**.
- **Extra properties**: add properties that are not in the CSV (name, type, default value with `{{Column}}`, `{{row}}`, `{{file}}`, `{{today}}`, `{{now}}`). Defaults fill new notes and empty properties on re-import; values set in Obsidian are kept.
- **ID generator**: `{{uuid}}` in extra property defaults and an **Add ID property** button give every note a unique, stable ID under a name you choose.
- More date formats: `DD/MM/YYYY`, `MM/DD/YYYY`, `DD-MM-YYYY`, month names (English and German). Ambiguous slash dates follow the new **Date order** setting and are never guessed.
- **Ignore units** for number columns: `1.234,56 €`, `$1,234.56`, `12 %`, space and narrow-space thousands separators.
- Composite key: match notes by several columns, stored in a key property.
- **Import only some rows**: a row filter per file.
- Preview warnings for duplicate keys in the CSV, duplicate notes in the vault (e.g. sync conflict copies), very large imports, active row filters and extra properties that clash with columns.
- Requires Obsidian 1.15.1 or later. Version guards were removed; settings use the declarative settings API and appear in Obsidian's settings search.

### Interface overhaul
- Import settings: tabs (Columns, Notes, Re-import, File & rows), a summary line, preview beside the settings on wide screens, buttons that stay visible, compact column rows with an options button, key suggestions that skip free-text columns, and a preview that follows the row filter.
- Table view: one primary action, a status line with last import and Undo, at most one callout at a time.
- Import dialog: results grouped by outcome with paths relative to the target folder; on phones the buttons stay visible and nothing overflows.
- CSV imports index: dense rows, Import vs Re-import, clearer missing-CSV and empty states.
- Settings tab regrouped; consistent wording, outline badges and native callouts throughout.

### Marketplace review fixes
- Release assets (`main.js`, `styles.css`) carry GitHub artifact attestations (build provenance).
- The settings tab no longer touches `Plugin.settings` (an Obsidian 1.13 API) and uses the declarative settings API.
- Removed duplicate CSS declarations; styles are now checked with Stylelint in CI.

### Reliability
- Saved data has a schema version and old configurations are migrated.
- If notes were written but the import history could not be saved, the import reports a warning instead of failing.

### Development
- Architecture refactor: vault gateway, pure ownership policy, single template engine, import service, UI sections; more tests.
- CI on Node 20, 22 and 24; release assets get build provenance attestations; sentence-case lint rule.

## 0.1.0 (beta) - 2026-11-23

First beta release, installable with BRAT.

### Features
- Table view for `.csv` files with sorting, filtering and type badges; click a badge to change a column's type, link its values or exclude it.
- Import every row as a note with typed properties: unquoted numbers (decimal comma and thousands separators normalized), ISO dates and datetimes, booleans, lists; minimal text quoting; Excel serial dates; number precision; empty cells left empty or omitted.
- Automatic type inference with per-column overrides; per-column value templates such as `[[{{value}}]]`.
- Per-file import settings, kept in sync when files are renamed.
- File name, body and folder templates with `{{Column}}`, `{{row}}`, `{{file}}` (for example `Projects/{{Client}}`).
- "When a note already exists": Update properties, Skip, Create a copy, Replace whole note. Update keeps properties added in Obsidian, the note body, values edited in Obsidian and values for empty CSV cells; unchanged notes are not rewritten.
- Match notes by a key column on re-import, even after renaming; key column suggestion.
- Import dialog with preview, progress with Stop, a saveable report, Open base and Open first note.
- Undo last import.
- Encoding detection (UTF-8, UTF-16, Windows-1252) and delimiter detection.
- Optional `.base` file (Obsidian 1.9+), optional source link and tags, list normalization for tags/aliases/cssclasses, warning when CSV columns change.
- Commands and file-menu entries, including "Re-import all configured CSV files".
- Uses only documented Obsidian APIs; no network access.

### Safety
- Re-imports only change notes this CSV created. Other notes are skipped as "not created by this import". New option **Update existing notes not created by this import** turns this off.
- A CSV column named `source` is no longer overwritten by the source link; the link uses `source_csv` then.
- Without a key column the plugin suggests one and the preview warns about row-number matching.
- Safer file names: limited by bytes, normalized, Windows reserved names handled, case-insensitive collisions detected. Target folders containing `..` are rejected.
- Stricter type inference: `+49...`, `1e5`, a column with only `no` and Excel serial 60 stay text or valid values; very small numbers are no longer turned into 0.
- Parser warnings (for example an unterminated quote) are shown; blank rows are skipped.
- Undo skips notes changed after the import and lists them. Undo data is saved while the import runs, so a crashed import can be undone.

### Performance
- Faster imports and a smoother UI on large files; import state and undo data are stored per CSV in `.obsidian/plugins/csv-importer/imports/` with a size cap and a warning.
- The table view caches the parsed CSV and **Show more** appends rows.

### Interface
- Reorganized import settings: Columns, Output, Preview, Advanced. Phone layout, larger touch targets.
- Shows where notes will go; the button reads "Import N rows as notes". Replacing whole notes asks for confirmation.
- Existing notes options renamed: **Update properties**, **Skip**, **Create a copy**, **Replace whole note**.
- Consistent labels (New, Updated, Unchanged, Skipped, Failed), **Stop import**, readable type badges, full text of long cells on hover.
- After an import: **Open base** and **Open first note**.
- **Create a base** is on by default when Obsidian supports Bases.
- New command: **Re-import all configured CSV files**.

### Docs and compliance
- README rewritten: quick start, timesheet and Bases walkthrough, privacy and data, limitations, troubleshooting, comparison. Developer docs moved to CONTRIBUTING.md.
- Uses `vault.process` for writes; only real errors are logged.
- New manifest description.
