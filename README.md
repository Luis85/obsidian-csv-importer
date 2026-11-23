# CSV Importer

Keep a CSV file in your vault, view it as a table, and turn every row into a note with typed properties, so Bases can sum, filter and sort them. When the CSV changes, replace the file and import again: the properties you edited or added in Obsidian are kept. Every import can be previewed first and undone afterwards.

It works with Excel and German exports: semicolon delimiter, decimal comma, Windows-1252 encoding and `DD.MM.YYYY` dates.

<!-- screenshots: docs/images/table-view.png, docs/images/import-preview.png -->

## Quick start

1. Put a CSV file in your vault, for example `Data/timesheet.csv`.
2. Click the file. It opens in a table view with a type badge on every column.
3. Check the column types (click a badge to change it) and run **Import rows from current CSV file**.
4. Review the preview, then select **Import**. The notes appear in `Data/timesheet/`.

Sample files are in [`examples/`](examples).

## Walkthrough: timesheet to Bases

This uses [`examples/timesheet.csv`](examples/timesheet.csv): one row per working day with `Datum`, `Rolle`, `Beschreibung`, `Stunden` and `Tage`.

1. Copy `timesheet.csv` to `Data/timesheet.csv` and open it. `Stunden` and `Tage` show a number badge, `Datum` a date badge.
2. Open **Configure import for current CSV file**. **Create a base** is on by default. Under **Match notes by column**, pick a column that is unique per row. The sample timesheet has one entry per day, so `Datum` works. Real timesheets often have several entries per day, so add an ID column to the export if you can. Without a key, notes are matched by file name (for example `{{Datum}} {{Rolle}}`).
3. Run **Import rows from current CSV file** and import. You get one note per row, and a `.base` file next to the folder that lists them as a table.
4. Open the base. In the table view, use the column menu of `Stunden` to add a summary and choose **Sum**. This works because `Stunden` is a real number in every note, not text. (Menu names depend on your Obsidian version.)
5. Add a property `Abgerechnet` (checkbox) to a few notes, or add the column in the base.
6. Edit `Data/timesheet.csv` outside Obsidian, or replace the file with a version where some `Stunden` values changed, keeping the same name and path.
7. Run the import again. The preview lists the notes that will be updated and which properties change. `Abgerechnet` is not touched. Select **Import**.

The Sum in the base now reflects the new hours, and `Abgerechnet` is still set.

## Table view

Clicking a `.csv` file opens it as a table. Each column header shows a type badge (text, number, checkbox, date, datetime, list). Click a badge to:

- change the column's type,
- link its values (writes each value as `[[value]]`),
- exclude the column from the import.

Long tables are shown in pages; **Show more** appends rows. Parser warnings (for example an unterminated quote) and changed columns are shown above the table.

## Typed properties

Obsidian Bases and Dataview can only sum, average, sort or filter a property if the value in the note's YAML has the right type. CSV Importer writes typed values:

- Numbers unquoted, with decimal comma and thousands separators normalized (`0,5` becomes `0.5`) and no floating-point noise. Optional rounding via **Number precision**.
- Dates as `YYYY-MM-DD`, datetimes as `YYYY-MM-DDTHH:mm:ss`, unquoted. Source formats: `YYYY-MM-DD[ HH:mm[:ss]]`, `DD.MM.YYYY`, `YYYY/MM/DD`, and Excel serial numbers (for columns typed date).
- Booleans as `true` / `false`.
- Text quoted only when YAML requires it, including text that would otherwise read as a number, date or boolean (`id: "007"`).
- Empty cells as an empty property or omitted, never `""`.
- One type per column, so every note has the same type for the same property.

A column's type is inferred from all its non-empty values. A type is chosen only if every value fits; otherwise the column is text.

| Type | Recognized values | Example |
| --- | --- | --- |
| checkbox | `true` / `false`, `yes` / `no` (case-insensitive) | `true` |
| number | integers and decimals; decimal comma when the decimal separator is `,` | `0.625`, `0,625` |
| date | `YYYY-MM-DD`, `YYYY/MM/DD`, `DD.MM.YYYY`, or datetimes at midnight (setting: midnight as date) | `2026-11-18`, `18.11.2026` |
| datetime | datetimes with a time component | `2026-11-18 14:30:00` |
| list | never inferred; choose it per column. Values are split by the list separator | `a, b, c` |
| text | everything else | `Backend` |

Values that look like numbers but are identifiers stay text: leading zeros (`007`), phone numbers (`+49…`), very long digit strings, and exponent notation (`1e5`). A column that contains only `no` is text, not a checkbox.

Because the values themselves are typed, Obsidian recognizes the property types from the notes. The plugin does not edit Obsidian's property type settings. If you set a different type for a property in Obsidian yourself, the editor follows your setting, but the stored values stay typed.

## Value templates

Each column can have a value template applied after type conversion. `{{value}}` (or `$value`) is the cell value; `{{Other column}}`, `{{row}}` and `{{file}}` work too.

| Template | Cell | Property |
| --- | --- | --- |
| `[[{{value}}]]` | `Softwareentwickler` | `Rolle: "[[Softwareentwickler]]"` |
| `{{value}} h` | `0,5` | `Stunden: 0.5 h` (text) |

For list columns the template is applied to every item, so `[[{{value}}]]` creates a list of links. Empty cells stay empty. The **Link** button in the import settings and the badge menu in the table set `[[{{value}}]]` in one click.

## Extra properties and IDs

In the import settings, **Extra properties** adds properties to the imported notes that are not columns of the CSV, for example `status: open` for every new note. Extra properties are written only to the notes: the CSV file is never changed.

Each extra property has a name, a type and a default value. The default value can use:

| Placeholder | Replaced with |
| --- | --- |
| `{{Column}}`, `{{row}}`, `{{file}}` | the same values as in other templates |
| `{{today}}` | today's date, `YYYY-MM-DD` |
| `{{now}}` | the current date and time, `YYYY-MM-DDTHH:mm:ss` |
| `{{uuid}}` | a new random ID (UUID) per note |

The default only fills in. It is written when a note is created, and on re-import only if the property is missing or empty, so a value you set in Bases (for example `status: done`) is never overwritten. If an extra property has the same name as a CSV column, the column wins and you get a warning.

**Add ID property** adds an `id` property with the default `{{uuid}}`. You can rename it. Every new note gets its own UUID, and the ID stays the same on re-imports. Because the ID exists only in the notes, it can't be used to match rows on re-import. Use a key column from the CSV for that.

## Templates and folders

Templates are used for the note file name, the note body and the target folder.

| Placeholder | Replaced with |
| --- | --- |
| `{{Column}}` | the value of the column with that header |
| `{{row}}` | the 1-based data row number |
| `{{file}}` | the CSV file name without extension |

Example file name template: `{{Datum}} {{Rolle}}`. Typed values are formatted in file names (`2026-11-18 00:00:00` becomes `2026-11-18`). Characters that are not allowed in file names are removed, and names that Windows reserves (such as `CON`) get a `_` prefix. Long names are shortened to fit the file system.

The target folder accepts the same placeholders, for example `Projects/{{Client}}` creates one folder per client. An empty target folder means a folder next to the CSV named like the CSV (`Data/hours.csv` imports into `Data/hours/`). A folder containing `..` is rejected.

## Existing notes

Choose what happens when a row's note already exists (per file, in the import settings):

| Option | Behavior |
| --- | --- |
| **Update properties** (default) | Updates only the CSV's own properties. Properties you added in Obsidian and the note body are kept. Notes whose values did not change are not rewritten. |
| **Skip** | Leaves existing notes untouched. |
| **Create a copy** | Creates a new note such as `Name 1.md`. |
| **Replace whole note** | Replaces frontmatter and body. Properties added in Obsidian and the body are lost. You are asked to confirm. |

With **Update properties** two more options apply:

- **Keep values edited in Obsidian** (on by default): if you changed a CSV property in a note, re-imports keep your value. The plugin remembers the last imported value per note and property, so it can tell your edits from changes in the CSV.
- **Keep values when the CSV cell is empty** (on by default): an empty cell never clears a value in the note.

Notes that were not created by this import are never changed. A note counts as created by this import if the plugin has import state for it or if its source link points to this CSV. Any other note, for example an unrelated note with the same name, is skipped with the reason "not created by this import". To change that, turn on **Update existing notes not created by this import**.

## Matching notes on re-import

Notes are matched in one of two ways:

- **Match notes by column** (key column, recommended): pick a column with unique values, such as an ID. Notes in the target folder whose property matches are updated, even if you renamed or moved them within that folder. The key column is always written to the notes, even if you excluded it, because it has to be stored to find the note again. The plugin suggests a unique column when you have none set.
- **File name**: without a key column, notes with the same generated file name are updated. If you insert or re-sort rows, or change the file name template, notes no longer line up and you get wrong updates or duplicates. The preview warns when no key column is set.

If the CSV has a column named `source`, the source link is written to `source_csv` instead so the column is not overwritten.

## Import dialog

Importing first shows a preview without writing anything: how many notes will be new, updated, unchanged, skipped or failed, and per note which properties change or are kept. Parser warnings are shown here too. After **Import** you see progress with **Stop import**, then a report with these buttons:

- **Save report as note**: writes the report as a note.
- **Open first note**: opens the first created or updated note.
- **Open base**: opens the generated base, if there is one.
- **Undo last import** (also in the toolbar, command palette and file menu): moves notes created by the import to the trash and restores the previous content of notes it modified. Notes you changed after the import are skipped and listed.

The command **Re-import all configured CSV files** runs this for every CSV that has saved settings.

## CSV imports index

The ribbon icon **Open CSV imports** (or the command of the same name) opens an index of every CSV file with saved import settings. It opens in its own tab; opening it again reveals the existing one. Files are sorted by last import, newest first, then by name, and a filter box narrows the list.

Each row shows the CSV (click to open it in the table view), its target folder, when it was last imported, how many notes this import owns, and badges for **CSV missing** and **Undo available**. Actions per row:

- **Re-import**: runs the normal import dialog.
- **Configure**: opens the import settings.
- **Open base**: opens the base file next to the notes folder, if it exists.
- **Undo last import**: same as the command, shown when an undo is available.
- **...** menu: **Delete imported notes...** and **Remove from index...**. On narrow views the other actions move into this menu too.

**Re-import all** at the top runs the import dialog for every listed CSV that still exists.

**Delete imported notes** moves the notes this import owns to the trash (using your Obsidian trash setting). A note counts as owned when the import history lists it and it still exists; notes you created yourself, even in the same folder, are never touched. You can also delete the base file in the same step. Afterwards the import history and undo are cleared, but the CSV's settings stay, so you can import again. This works even when the CSV file is missing.

**Remove from index** deletes the CSV's settings and import history. Imported notes stay.

## Encoding

The encoding is detected automatically: byte order mark, then UTF-8, and Windows-1252 as the fallback (typical for Excel "CSV" exports). UTF-16 files with a BOM are supported. You can also set the encoding by hand per file.

## Settings reference

Global settings provide defaults for CSV files you configure for the first time. Per-file settings can override them in the import settings.

**Reading CSV files**

- Delimiter (auto, `,`, `;`, tab, `|`)
- First row is a header
- Decimal separator
- Encoding
- List separator

**Creating notes**

- Target folder (empty: folder named like the CSV)
- File name template and body template
- Tags added to every note
- Source link to the CSV
- Empty cells (leave property empty or omit it)
- Treat midnight datetimes as dates
- Create a base

**Existing notes**

- Existing notes: Update properties, Skip, Create a copy, Replace whole note
- Keep values edited in Obsidian
- Keep values when the CSV cell is empty

**Table view**

- Rows per page

**Data** (per file only)

- Key column, number precision, column types and value templates, and Update existing notes not created by this import

`tags`, `aliases` and `cssclasses` columns are always written as lists.

## Privacy and data

- CSV Importer makes no network requests and collects no telemetry.
- Settings, including per-file import settings, are stored in `.obsidian/plugins/csv-importer/data.json`.
- Import state (a hash of the last imported value per note and property, used to protect your edits) and undo data (the previous content of notes the last import changed) are stored in `.obsidian/plugins/csv-importer/imports/`. These files can contain row data. If you sync your vault's configuration folder, they are synced too.
- The CSV file is never modified.
- Files the plugin creates: the notes, an optional `.base` file, and an optional import report note.
- It uses only Obsidian's documented plugin API. It does not write `.obsidian/types.json`: because values are written as typed YAML, Obsidian picks up the property types from the notes.

## Limitations

- Import is one-way, from the CSV to notes. Changes in notes are not written back to the CSV.
- Rows removed from the CSV leave their notes in place.
- Renaming a column in the CSV needs re-mapping in the import settings.
- Time zones are dropped from datetimes.
- Undo covers only the last import of a file. Very large imports may not be fully undoable because the stored undo data is capped; you get a warning when that happens.
- Column types are inferred from all rows, so very large files take longer to open.

## Troubleshooting

**Numbers are imported as text.**
Check the decimal separator in the import settings: `0,625` needs `,`. A single non-numeric value in a column makes it text. Fix the value or set the column type to number.

**Nothing happens when I click a CSV file.**
Another plugin probably handles `.csv` files. Obsidian lets only one plugin register an extension. Disable the other plugin's CSV view, or use the commands and file-menu entries of CSV Importer, which work without the table view.

**I got duplicate notes after changing the file name template.**
Without a key column, notes are matched by file name. Set a key column, then import again. Remove the duplicates by hand or with **Undo last import** if it was the last run.

**Characters look garbled.**
The encoding was detected wrongly. Set it by hand in the import settings (Windows-1252 for most Excel exports).

**Rows are skipped with "not created by this import".**
A note with that name or key already exists but this CSV did not create it. Rename or move that note, or turn on **Update existing notes not created by this import**.

**Dates are not recognized.**
`YYYY-MM-DD`, `YYYY/MM/DD` and `DD.MM.YYYY`, optionally followed by a time, are inferred. Excel serial numbers are inferred as numbers; set the column type to date to convert them.

## FAQ

**Does it change my CSV?**
No. The plugin only reads CSV files.

**A property shows the wrong type in Obsidian.**
If the property already had a different type in your vault, CSV Importer does not change it and shows a warning. Change the type in Obsidian's properties view.

**Can I filter rows or import only some of them?**
Not yet. Exclude columns in the table view; rows are all imported.

**Does it keep the notes in sync automatically?**
No. You run the import. There is no automatic re-import when the file changes.

## How it compares

Competitor facts are taken from the plugins' own documentation and listings as read on 2026-11-23 and may have changed since. See [`docs/RESEARCH.md`](docs/RESEARCH.md) for sources.

| | CSV Importer | Importer (official), CSV format | Bases Data Studio |
| --- | --- | --- | --- |
| Focus | CSV only | Many formats, including CSV | Importing data into Bases |
| Typed property values | One type per column, written as typed YAML | Per its documentation, column values become properties | See its listing |
| Table view of the CSV | Yes | No | See its listing |
| Preview before writing | Yes | No | Yes, with key matching |
| Re-import without losing edits | Per property, edits and added properties kept | Skips notes modified in Obsidian (whole note) | Key matching |
| Undo | Last import | Not documented | Tells users to back up the vault |
| Excel and German exports | Delimiter, decimal comma, encoding detection | See its documentation | See its listing |
| Base file | Optional, generated | Optional, generated | Native focus |

## Installation

Requires Obsidian 1.15.1 or later (desktop and mobile).

### Community plugins

Once CSV Importer is listed in the community store:

1. Open **Settings > Community plugins** and turn off restricted mode.
2. Select **Browse**, search for **CSV Importer**, then **Install** and **Enable**.

### BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. Run **BRAT: Add a beta plugin for testing** and enter `luis85/obsidian-csv-importer`.
3. BRAT installs the latest GitHub release and keeps it updated.

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/luis85/obsidian-csv-importer/releases/latest).
2. Copy them to `<vault>/.obsidian/plugins/csv-importer/`.
3. Reload Obsidian and enable **CSV Importer** under **Settings > Community plugins**.

Developing the plugin? See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
