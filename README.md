# CSV Importer

View CSV files inside Obsidian as a table and import every row as a note with correctly typed properties.

Inspired by [obsidianmd/obsidian-importer](https://github.com/obsidianmd/obsidian-importer), but focused only on CSV: open a file, check the preview, adjust the column types, import.

## Features

- **Table view**: clicking a `.csv` file in the file explorer opens it in a table view.
- **Per-file import settings**: stored in the plugin data, keyed by the file path, and kept in sync when you rename or move the CSV.
- **Typed properties**: numbers, checkboxes, dates, datetimes, lists and text are inferred automatically and can be overridden per column.
- **European number formats**: supports the `;` delimiter and the German decimal comma (`0,625`).
- **Templates** for note file names and note bodies with `{{Column}}`, `{{row}}` and `{{file}}` placeholders.
- **Conflict strategies**: skip, overwrite, update properties, or create with a numeric suffix.
- **Sensible default target folder**: a folder next to the CSV named like the CSV (`Data/hours.csv` imports into `Data/hours/`).
- **Optional extras**: a source link property pointing back to the CSV, and tags added to every note.
- **Re-import**: update the CSV, run the import again, and existing notes are updated.
- **Commands and menus**: command palette entries and file-menu entries for `.csv` files.

## Screenshots

Screenshots live in the [`docs/`](docs) folder. (Placeholder: add `docs/table-view.png` and `docs/import-settings.png` and reference them here.)

## Installation

### Community plugins

1. Open **Settings > Community plugins** and turn off restricted mode.
2. Select **Browse**, search for **CSV Importer**, then **Install** and **Enable**.

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/luis85/obsidian-csv-importer/releases/latest).
2. Copy them to `<vault>/.obsidian/plugins/csv-importer/`.
3. Reload Obsidian and enable **CSV Importer** under **Settings > Community plugins**.

### BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. Run **BRAT: Add a beta plugin for testing** and enter `luis85/obsidian-csv-importer`.
3. BRAT installs the latest GitHub release and keeps it updated.

## Usage

Sample files are in [`examples/`](examples): `timesheet.csv` (comma) and `timesheet-de.csv` (semicolon, decimal comma).

1. Put a CSV file in your vault, for example `Data/timesheet.csv`.
2. Click it in the file explorer. It opens in the table view.
3. Set types before importing: click a column's type badge in the table header to change its type, link its values or exclude it. Or run **Configure import for current CSV file** (or use the file menu) to review delimiter, header row, column names and types, value templates, templates, target folder, key column and conflict handling.
4. Run **Import rows from current CSV file**.

With this row:

```csv
Datum,Rolle,Beschreibung,Stunden,Tage
2026-11-18 00:00:00,Softwareentwickler,Architektur und Harness Vorbereitung Backend,0.625,5
```

the resulting note in `Data/timesheet/` has this frontmatter:

```yaml
---
Datum: 2026-11-18
Rolle: Softwareentwickler
Beschreibung: Architektur und Harness Vorbereitung Backend
Stunden: 0.625
Tage: 5
---
```

`Stunden` and `Tage` are written as numbers, not strings, and `Datum` as a date (midnight timestamps become dates by default).

## Typed YAML

Obsidian Bases and Dataview can only sum, average, sort or filter a property if the YAML value itself has the right type; the property type in `.obsidian/types.json` only controls the editor widget. CSV Importer therefore writes typed values:

- Numbers unquoted, with decimal comma and thousands separators normalized (`0,5`, `"0.5"` → `pt: 0.5`) and no floating-point noise. Optional rounding via **Number precision**.
- Dates as `YYYY-MM-DD`, datetimes as `YYYY-MM-DDTHH:mm:ss`, unquoted. Source formats: `YYYY-MM-DD[ HH:mm[:ss]]`, `DD.MM.YYYY`, `YYYY/MM/DD`, and Excel serial numbers (for columns typed date).
- Booleans as `true` / `false`.
- Text quoted only when YAML requires it, including text that would otherwise be read as a number, date or boolean (`id: "007"`).
- Empty cells as an empty property (`pt:`) or omitted, never `""`.
- One type per column, so every note gets the same type for the same property.

Inferred types are also registered in Obsidian's property types. A property that already has a different type is left unchanged and you get a warning.

## Value templates

Each column can have a value template applied after type conversion. `{{value}}` (or `$value`) is the cell value; `{{Other column}}`, `{{row}}` and `{{file}}` work too.

| Template | Cell | Property |
| --- | --- | --- |
| `[[{{value}}]]` | `Softwareentwickler` | `Rolle: "[[Softwareentwickler]]"` |
| `{{value}} h` | `0,5` | `pt: 0.5 h` |

For list columns the template is applied to every item, so `[[{{value}}]]` creates a list of links. The **Link** button in the import settings and the badge menu in the table set `[[{{value}}]]` in one click.

## Type inference

Each column is inspected over all its non-empty values. A type is chosen only if every value fits; otherwise the column is text.

| Type | Recognized values | Example |
| --- | --- | --- |
| checkbox | `true` / `false`, `yes` / `no` (case-insensitive) | `true` |
| number | integers and decimals; decimal comma when the decimal separator is `,` | `0.625`, `0,625` |
| date | `YYYY-MM-DD`, `YYYY/MM/DD`, `DD.MM.YYYY`, or datetimes at midnight (setting: midnight as date) | `2026-11-18`, `18.11.2026`, `2026-11-18 00:00:00` |
| datetime | ISO datetimes with a time component | `2026-11-18 14:30:00` |
| list | never inferred — choose it per column; values are split by the list separator | `a, b, c` |
| text | everything else | `Backend` |

Values with leading zeros (`007`) and very long digit strings (IDs, phone numbers) stay text so nothing is lost.

Override any column in the import settings. Empty cells become empty properties, so every note has the same set of properties.

## Templates

Templates are used for the note file name and the note body.

| Placeholder | Replaced with |
| --- | --- |
| `{{Column}}` | the value of the column with that header |
| `{{row}}` | the 1-based data row number |
| `{{file}}` | the CSV file name without extension |

Example file name template: `{{Datum}} {{Rolle}}`. Typed values are formatted in file names (`2026-10-20 00:00:00` becomes `2026-10-20`, datetimes become `2026-10-20 14-30`). Characters that are not allowed in file names are removed.

## Conflict strategies

| Strategy | Behavior when the note already exists |
| --- | --- |
| Skip | leave the note untouched |
| Overwrite | replace the whole note (properties and body) |
| Update properties | merge imported properties into the existing properties and keep the body |
| Create with suffix | create a new note such as `Name 1.md` |

## Re-importing

1. Edit and save the CSV (keep the same file name and path).
2. Run **Import rows from current CSV file** again.
3. With the **Update properties** or **Overwrite** strategy, existing notes are updated instead of duplicated.

Notes are matched in one of two ways:

- **Key column** (recommended): pick a column with unique values, such as an ID. Notes in the target folder whose property matches the value are updated, even if you renamed or moved them within that folder.
- **File name**: without a key column, notes with the same generated file name are updated. Use a file name template that is stable and unique per row (for example `{{Datum}} {{Rolle}}`).

## Settings reference

Global settings provide defaults for CSV files you configure for the first time:

- Default delimiter (auto, `,`, `;`, tab, `|`)
- First row is a header
- Decimal separator
- Default target folder (empty = folder named like the CSV)
- Default file name template and body template
- Default conflict strategy
- Default tags and source link
- List separator
- Empty cells (leave property empty or omit it)
- Treat midnight datetimes as dates
- Register inferred types in Obsidian's property type registry
- Rows per page in the table view

Per-file settings can override all of these and add number precision, key column, column types and value templates. They are stored in the plugin's `data.json`.

## FAQ

**Another plugin already opens `.csv` files. Which one wins?**
Obsidian lets only one plugin register an extension. If another CSV viewer (for example a CSV table or editor plugin) also registers `.csv`, the one loaded last may win or Obsidian may report a conflict. Disable the other plugin's CSV view, or use the commands and file-menu entries of CSV Importer, which work without the table view.

**My numbers are imported as text.**
Check the decimal separator in the import settings. `0,625` needs `,`. A single non-numeric value in a column makes it text; override the type manually.

**Dates are not recognized.**
`YYYY-MM-DD`, `YYYY/MM/DD` and `DD.MM.YYYY`, optionally followed by a time, are inferred. Excel serial numbers are inferred as numbers; set the column type to date to convert them.

**A property shows the wrong type in Obsidian.**
If the property already had a different type in your vault, CSV Importer does not change it and shows a warning. Change the type in Obsidian's properties view.

**Does it change my CSV?**
No. The plugin only reads CSV files.

## Development

```sh
npm install
npm run dev      # watch build
npm run build    # typecheck and production build
npm test         # vitest
npm run lint     # eslint with eslint-plugin-obsidianmd
```

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/csv-importer/` to try a build.

## Release process

Releases are fully automated by the [release workflow](.github/workflows/release.yml).

1. Add your changes under a `## Unreleased` heading in `CHANGELOG.md` (it is renamed to the version on release and used as release notes).
2. Run the **Release** workflow from the Actions tab (or `gh workflow run release.yml -f version=minor`, or let an agent trigger it through the GitHub API). Choose `patch`, `minor`, `major`, an explicit `x.y.z`, or `current` to release the version already in `manifest.json`.
3. The workflow bumps `package.json`, `manifest.json` and `versions.json`, runs lint, tests and build, commits `Release x.y.z`, pushes the tag (no `v` prefix) and publishes a GitHub release with `main.js`, `manifest.json` and `styles.css`. BRAT picks the new release up automatically.

The workflow must exist on the default branch to be run manually, and it pushes the release commit to the branch it runs on; allow `github-actions[bot]` to push if the branch is protected.

Pushing a tag equal to the `manifest.json` version, or publishing a release with such a tag in the GitHub UI, also builds and attaches the files (without bumping).

To submit the plugin to the community catalog, see [docs/SUBMISSION.md](docs/SUBMISSION.md).

## License

[MIT](LICENSE)
