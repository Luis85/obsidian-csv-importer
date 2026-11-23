# Changelog

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
