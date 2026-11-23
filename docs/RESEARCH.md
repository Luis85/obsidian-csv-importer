# User needs research

Research into the problems people have importing CSV files into Obsidian and similar tools (November 2026), and how this plugin addresses them. Direct complaints about Obsidian CSV import are fairly sparse. Several findings are inferred from what competing plugins chose to build, and each one is labelled with how strong its evidence is.

## Pain points

| # | Pain point | Evidence | How CSV Importer addresses it |
| --- | --- | --- | --- |
| 1 | Numbers, dates and booleans end up as text, so sums, sorting and filters in Bases and Dataview break | Medium: [Bases sum on "$" text](https://forum.obsidian.md/t/attempting-to-summarize-numbers-with-dollar-sign-added-bases/109282), [number type mismatch](https://forum.obsidian.md/t/property-numbers-type-mismatch-expected-number-with-filter-in-base/111879), [date-like text treated as a date](https://forum.obsidian.md/t/bases-formulas-type-is-not-inferred-correctly-from-manually-set-property-of-string-type/112607) | One type per column, written as typed YAML. IDs with leading zeros stay text. Types are merged into `types.json`. Decimal comma and Excel serial dates are supported. |
| 2 | No built-in "one note per row with typed properties" option, so people fall back to scripts | Strong: [bulk page creation from CSV](https://forum.obsidian.md/t/import-base-from-csv-file-bulk-page-creation/106864), [bulk import into Bases](https://forum.obsidian.md/t/bases-bulk-import-notes-from-external-files-using-the-most-used-data-formats-json-csv-xml/104834), [database structure as notes](https://forum.obsidian.md/t/import-a-database-structure-as-notes/102267), [Logseq: one row per page](https://discuss.logseq.com/t/import-excel-csv-files-and-have-each-row-become-a-page/27220) | This is the core feature: a table view, per-file settings, templates, and folders per column. |
| 3 | YAML breaks on special characters | Weak: [YAML rules for CSV import](https://forum.obsidian.md/t/yaml-syntax-rules-for-db-folder-csv-import/74892) | Values are quoted only when YAML needs it, and raw-text tests check the result. |
| 4 | Encoding and delimiter problems with Excel exports (ANSI, UTF-16, semicolon) | Indirect: Notion and Redmine guides, and competing plugins that auto-detect delimiters | The delimiter is detected automatically. Encoding is detected too: BOM, UTF-8, UTF-16, and Windows-1252 as a fallback. |
| 5 | Re-importing creates duplicates or loses edits made in Obsidian | Inferred: [Bases Data Studio](https://community.obsidian.md/plugins/bases-data-studio) has key matching and a preview, and [JSON/CSV Importer](https://github.com/farling42/obsidian-import-json) handles duplicates only within one import | A key column matches notes. Update only changes the CSV's own properties, keeps added properties and the body, and keeps values you edited in Obsidian. |
| 6 | Awkward column names and note names | [JSON/CSV Importer](https://github.com/farling42/obsidian-import-json) needs Handlebars-safe column names. The [official Importer](https://obsidian.md/help/import/csv) needs bracket syntax. | `{{Column with spaces}}` works as written. File names are sanitized and formatted. |
| 7 | No undo | [Bases Data Studio](https://community.obsidian.md/plugins/bases-data-studio) tells users to back up their vault | **Undo last import** moves created notes to the trash and restores modified notes. |

## Feature requests seen

- A file-name column, with the other columns as properties and comma-separated cells as tags or lists. Covered.
- A destination folder, a body template, and an auto-generated Base. Covered, including the optional `.base` file.
- Wikilinks and tags from cell values. Covered by value templates such as `[[{{value}}]]` and list columns.
- Nested folders built from column values. Covered: `Projects/{{Client}}`.
- A preview before writing. Covered: the import dialog runs a dry run first.
- Two-way sync and exporting back to CSV. Not planned, since there is no evidence of demand yet.

## Ideas adopted from the official Obsidian Importer

- The "Existing notes" setting, with Update, Skip and Create a copy (plus Overwrite).
- Outcomes for each row: created, updated, unchanged, skipped, failed. Unchanged notes are not rewritten.
- Protection for edits made in Obsidian. The Importer compares file modification times, which protects the whole note. We track each property separately, so properties you add in Bases don't stop the CSV values from updating.
- A progress view with Stop, and an import report you can save as a note.
- An auto-generated `.base` file.
