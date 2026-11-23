# Changelog

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
