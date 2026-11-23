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
- Commands and file-menu entries for importing and configuring.
