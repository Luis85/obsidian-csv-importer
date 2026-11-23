# Changelog

## Unreleased

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
- After an import: **Open base** and **Reveal folder**.
- **Create a base** is on by default when Obsidian supports Bases.
- New command: **Re-import all configured CSV files**.

### Docs and compliance
- README rewritten: quick start, timesheet and Bases walkthrough, privacy and data, limitations, troubleshooting, comparison. Developer docs moved to CONTRIBUTING.md.
- Uses `vault.process` for writes; only real errors are logged.
- New manifest description.

## 0.1.0 (beta)

- First beta release, installable with BRAT.
- Table view for `.csv` files.
- Per-file import settings, kept in sync on rename.
- Automatic type inference (number, checkbox, date, datetime, text; list on request) with per-column overrides.
- Semicolon delimiter and decimal comma support.
- File name and body templates with `{{Column}}`, `{{row}}`, `{{file}}`.
- Conflict strategies: skip, overwrite, update properties, create with suffix.
- Optional source link property and tags.
- Typed YAML output: unquoted numbers, ISO dates and datetimes, booleans; minimal text quoting; Excel serial dates; number precision; empty cells left empty or omitted.
- Property types merged into Obsidian's registry without overwriting existing types (conflicts are reported).
- Key column for idempotent re-imports.
- Change column types and link values directly from the table header.
- Per-column value templates, e.g. `[[{{value}}]]` for wikilinks.
- "Existing notes" option (Update, Skip, Create a copy, Overwrite). Update keeps properties added in Obsidian, the note body, values edited in Obsidian, and values for empty CSV cells; unchanged notes are not rewritten.
- Import dialog with dry-run preview, progress with Stop, and a saveable report.
- Undo last import.
- Encoding detection (UTF-8, UTF-16, Windows-1252).
- Folder placeholders such as `Projects/{{Client}}`, optional `.base` file, list normalization for tags/aliases/cssclasses, warning when CSV columns change.
- Commands and file-menu entries for importing and configuring.
