# Examples

Two sample timesheets with the same six rows, to try the plugin, and a messy Excel export.

| File | Format |
| --- | --- |
| `timesheet.csv` | Comma delimiter, decimal point, datetimes (`2026-11-18 00:00:00`) |
| `timesheet-de.csv` | Semicolon delimiter, decimal comma (`0,625`), dates (`2026-11-18`) |
| `excel-export.csv` | What Excel writes on Windows: byte order mark, semicolons, Windows line endings, decimal comma with thousands separators (`1.234,50`), a cell with a line break inside, a cell with a semicolon and one with quotes |

Copy one into your vault, for example `Data/timesheet.csv`, and open it.

## Expected types

| Column | Type | Notes |
| --- | --- | --- |
| `Datum` | date | Midnight datetimes in `timesheet.csv` become dates |
| `Rolle` | text | |
| `Beschreibung` | text | |
| `Stunden` | number | `0,625` in the German file is read as `0.625` |
| `Tage` | number | |

The first row produces a note with this frontmatter, from either file:

```yaml
---
Datum: 2026-11-18
Rolle: Softwareentwickler
Beschreibung: Architektur und Harness Vorbereitung Backend
Stunden: 0.625
Tage: 5
---
```

The delimiter and decimal separator are detected automatically; if the German file shows `Stunden` as text, set **Decimal separator** to Comma on the **File format** tab of the import settings (**Import settings** in the table view). See the walkthrough in the main README for using the result in Bases.

## The Excel export

`excel-export.csv` has a header `Nr;Kunde;Betrag;Notiz` and three rows. Open it as is: the encoding, the delimiter and the decimal comma are detected. The first row becomes:

```yaml
---
Nr: 1
Kunde: Müller GmbH
Betrag: 1234.5
Notiz: "Erste Zeile\nzweite Zeile"
---
```

The line break inside the cell is written as `\n` in a quoted string, and Obsidian shows it as two lines. The source link and any tags you set are left out here. Change the second line of that cell in a text editor and import again: the note is updated, and values you edited in Obsidian are kept.

