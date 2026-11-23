# Changelog

## 1.0.0

- Initial release.
- Table view for `.csv` files.
- Per-file import settings, kept in sync on rename.
- Automatic type inference (number, checkbox, date, datetime, list, text) with per-column overrides.
- Semicolon delimiter and decimal comma support.
- File name and body templates with `{{Column}}`, `{{row}}`, `{{file}}`.
- Conflict strategies: skip, overwrite, update properties, create with suffix.
- Optional source link property and tags.
- Commands and file-menu entries for importing and configuring.
