# Examples

Two sample timesheets with the same six rows, to try the plugin.

| File | Format |
| --- | --- |
| `timesheet.csv` | Comma delimiter, decimal point, datetimes (`2026-11-18 00:00:00`) |
| `timesheet-de.csv` | Semicolon delimiter, decimal comma (`0,625`), dates (`2026-11-18`) |

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

The delimiter and decimal separator are detected automatically; if the German file shows `Stunden` as text, set the decimal separator to `,` in the import settings. See the walkthrough in the main README for using the result in Bases.
