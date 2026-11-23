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

## Usage

Sample files are in [`examples/`](examples): `timesheet.csv` (comma) and `timesheet-de.csv` (semicolon, decimal comma).

1. Put a CSV file in your vault, for example `Data/timesheet.csv`.
2. Click it in the file explorer. It opens in the table view.
3. Run **Configure import for current CSV file** (or use the file menu) to review delimiter, header row, column names and types, templates, target folder and conflict handling.
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

## Type inference

Each column is inspected over all its non-empty values. A type is chosen only if every value fits; otherwise the column is text.

| Type | Recognized values | Example |
| --- | --- | --- |
| checkbox | `true` / `false`, `yes` / `no` (case-insensitive) | `true` |
| number | integers and decimals; decimal comma when the decimal separator is `,` | `0.625`, `0,625` |
| date | ISO dates, or datetimes at midnight (setting: midnight as date) | `2026-11-18`, `2026-11-18 00:00:00` |
| datetime | ISO datetimes with a time component | `2026-11-18 14:30:00` |
| list | values containing the list separator | `a, b, c` |
| text | everything else | `Backend` |

Override any column in the import settings. Empty cells are not written.

## Templates

Templates are used for the note file name and the note body.

| Placeholder | Replaced with |
| --- | --- |
| `{{Column}}` | the value of the column with that header |
| `{{row}}` | the 1-based data row number |
| `{{file}}` | the CSV file name without extension |

Example file name template: `{{Datum}} {{Rolle}}`. Characters that are not allowed in file names are removed.

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
3. With the **Update properties** or **Overwrite** strategy, notes with the same generated file name are updated instead of duplicated. Use a file name template that is stable and unique per row (for example `{{Datum}} {{Rolle}}`).

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
- Treat midnight datetimes as dates
- Register inferred types in Obsidian's property type registry
- Rows per page in the table view

Per-file settings can override all of these and are stored in the plugin's `data.json`.

## FAQ

**Another plugin already opens `.csv` files. Which one wins?**
Obsidian lets only one plugin register an extension. If another CSV viewer (for example a CSV table or editor plugin) also registers `.csv`, the one loaded last may win or Obsidian may report a conflict. Disable the other plugin's CSV view, or use the commands and file-menu entries of CSV Importer, which work without the table view.

**My numbers are imported as text.**
Check the decimal separator in the import settings. `0,625` needs `,`. A single non-numeric value in a column makes it text; override the type manually.

**Dates are not recognized.**
Only ISO formats (`YYYY-MM-DD`, optionally with `HH:MM[:SS]`) are inferred. Convert other formats in the source file.

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

1. Update `CHANGELOG.md`.
2. Run `npm version patch` (or `minor` / `major`). This bumps `package.json`, `manifest.json` and `versions.json` and creates a git tag without a `v` prefix.
3. Push the commit and the tag: `git push && git push --tags`.
4. The [release workflow](.github/workflows/release.yml) checks that the tag equals the `manifest.json` version, builds, tests and publishes a GitHub release with `main.js`, `manifest.json` and `styles.css`.

To submit the plugin to the community catalog, see [docs/SUBMISSION.md](docs/SUBMISSION.md).

## License

[MIT](LICENSE)
