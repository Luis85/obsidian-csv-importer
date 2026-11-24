# User flows covered by the end-to-end suite

Every flow of the README, mapped to the spec and test that runs it in real Obsidian. Specs are in `test/e2e/specs/`. Flows marked "set-up" configure a CSV through the plugin's settings store (`patchConfig`) so the test can focus on the result; the matching dialog control has its own test in `import-settings`.

Screenshots of the key steps (light and dark where the step is UI heavy) are written to `reports/e2e/screenshots/<spec>/<step>.png`.

| Flow (README section) | Spec | Test |
| --- | --- | --- |
| Plugin loads, five commands registered | smoke | is enabled and has registered its commands |
| Settings tab, declarative definitions | smoke | registers a declarative settings tab with definitions |
| Settings tab sections and Imports/Danger zone rows | smoke, settings-tab | shows its sections in the settings tab; opens the CSV imports index from its Imports section |
| Reset all import settings (confirm) | settings-tab | resets all import settings after a confirmation |
| Settings defaults apply to unconfigured CSV | settings-defaults | applies a default target folder from the settings tab |
| Ribbon icon opens the index | smoke | opens the CSV imports index from the ribbon icon |
| File-menu entries (Import rows, Configure, Undo) | smoke, undo-index | offers the plugin's entries in the file menu; offers Undo last CSV import in the file menu |
| Quick start: open CSV as table with type badges | table-view | opens a .csv file in the plugin's view |
| Table view: filter box | table-view | filters the rows with the filter box |
| Table view: badge menu, change type | table-view | changes a column's type from the badge menu |
| Table view: Link values / Unlink values | table-view | links values as wikilinks |
| Table view: Exclude / Include | table-view | excludes a column from the import |
| Table view: Show more (pages) | table-view | shows more rows in pages |
| Table view: select rows (checkboxes, shift-click, header checkbox, Clear selection) | table-selection | selecting rows changes the primary button ...; shift-click selects a range; the header checkbox selects every matching row |
| Table view: import only the selected rows | table-selection | imports only the selected rows and clears the selection afterwards; keeps the selection when the dialog is cancelled |
| Table view: follows file changes, settings and imports made elsewhere | table-refresh | shows a CSV that changed on disk; shows the settings saved with the Configure command; shows the import made with the import command |
| Table view: "Changed since last import" and Re-import link | table-refresh | says when the CSV changed since the last import and re-imports from the status line |
| Import dialog: choose which notes to import (row and group checkboxes) | run-selection | starts with every New note checked ...; the group checkbox toggles the whole group; covers rows beyond the 200 listed ones |
| Table view: status line and Undo link | undo-index | undoes from the Undo link in the table view's status line |
| Table view: changed-columns callout, Review columns | encoding-drift-warnings | warns about columns that were added or removed |
| Table view / preview: parser warnings | encoding-drift-warnings | shows parser warnings for rows with the wrong number of fields |
| Import: first import through the dialog (Quick start) | import, import-dialog | imports every row through the preview dialog; imports from the table view's primary button |
| Import: German file, decimal comma | import | imports the German file |
| Import settings: tabs, summary parts, Cancel | import-settings | opens from the Configure button; jumps to a tab; cancel closes without saving |
| Import settings: Notes tab (folder, file name, tags), Import now | import-settings | saves notes settings and imports with Import now |
| Import settings: Re-import tab, composite key | import-settings | saves a composite key chosen on the Re-import tab |
| Import settings: Replace whole note + confirm | import-settings | asks for confirmation before choosing Replace whole note; declining keeps the strategy |
| Import settings: column Options, value template | import-settings | sets a value template under a column's Options |
| Import settings: Extra properties, ID | import-settings | adds an ID extra property from the Add property menu |
| Import settings: extra properties as rows of the Columns table (add, type, default `{{uuid}}`, sample and preview, import, remove, inline warning) | config-extra-properties | adds a row, sets a {{uuid}} default, shows it in the sample and preview, and imports it; flags a name that is also a CSV column and removes the row with the trash button |
| Import settings: summary parts and tabs are flat (no Obsidian button chrome, also on hover), tabs fit on a phone | appearance | gives the summary parts / tabs only what their style says; keeps them flat while hovered; does not reach past the dialog and shows all four tabs |
| Import settings: row filter | import-settings | filters rows from the File & rows tab |
| Import settings: live preview | import-settings | shows the live note preview |
| Typed properties (text IDs, numbers, checkboxes, empty cells) | import-options | writes typed properties |
| Value templates | table-view, import-settings | links values as wikilinks; sets a value template |
| Extra properties and IDs, `{{uuid}}`, `{{today}}`, never overwritten | import-options | adds extra properties with {{uuid}} and {{today}} |
| Templates and folders (file name, body, target folder) | import-options | uses the file name, body and target folder templates |
| Tags, source link off | import-options | adds tags and omits the source link |
| Existing notes: Update (keeps edits, extra property, body) | import | keeps user edits when the CSV is imported again |
| Existing notes: Skip | import-options | skips existing notes with the Skip strategy |
| Existing notes: Create a copy | import-options | creates copies with the Create a copy strategy |
| Existing notes: Replace whole note | import-settings | asks for confirmation ..., and replaces notes on re-import |
| Notes not created by this import, Update existing notes setting | import-options | skips notes this import did not create |
| Matching notes: key column, renamed notes | import-options | matches by a key column |
| Matching notes: composite key | import-options, import-settings | matches by a composite key; saves a composite key |
| Matching notes: no key warning | encoding-drift-warnings | warns on re-import when no key column is set |
| Row filter | import-options | imports only the rows that match the row filter |
| Date formats, units, ambiguous slash dates | import-options | reads German dates, currency amounts ...; leaves ambiguous slash dates as text |
| Import dialog: preview groups, Cancel | import-dialog | shows a preview grouped by outcome |
| Import dialog: preview of updates with change list | import-dialog | updates a changed note with a visible change list |
| Import dialog: Stop import | import-dialog | stops a long import |
| Import dialog: finished, Close, Open base | import-dialog | opens the generated base |
| Import dialog: more menu, Open first note | import-dialog | opens the first note ... |
| Import dialog: Save report as note | import-dialog | saves a report note |
| Import dialog: Undo import from the menu | import-dialog | undoes the import from the more-actions menu |
| Undo command, confirm, notice | undo-index | undoes the last import after confirmation; moves created notes to the trash |
| Undo restores modified notes | undo-restores | puts the earlier values back after undoing a re-import |
| Re-import all (command) | import-dialog | re-import all opens the dialog |
| Index: Import for never imported CSV | index-flows | lists a configured but never imported CSV |
| Index: Re-import, last import, note count | index-flows | shows last import and note count |
| Index: filter box, open CSV from name | index-flows | filters the list and opens a CSV |
| Index: Re-import all | index-flows | re-imports every listed CSV |
| Index: row menu (Configure, Open base, Undo) | index-flows | offers ... in the row menu; opens the base; undoes the last import |
| Index: Delete imported notes (+ base option) | index-flows | deletes the imported notes and, when ticked, the base |
| Index: Remove from index | index-flows | removes a CSV from the index but keeps its notes |
| Index: CSV missing | index-flows | marks a CSV that no longer exists |
| Index: Scan vault (list, add, re-scan, empty state) | index-scan | lists CSV files that are not in the index; adds the checked files with default settings; shows an empty state |
| Index: Add CSV file from outside the vault | index-add-outside | copies the picked file's bytes ...; asks what to do when the file exists |
| Index: Changed badge, banner, Re-import changed | index-changed | marks a modified CSV as Changed live; does not mark a CSV that was only touched; treats an import without a recorded fingerprint as changed |
| Index: last import counts, edited since import | index-counts | shows the counts of the last import; counts notes edited since the import |
| Index: empty state | smoke | opens the CSV imports index from the ribbon icon |
| Encoding: Windows-1252, UTF-16, manual choice | encoding-drift-warnings | detects Windows-1252; reads UTF-16; lets the encoding be set by hand |
| Persistence across restarts | persistence | keeps import settings, history and undo data after the plugin is reloaded |
| Privacy: no network requests | no-network | requests no web resource |
| Look: contrast >= 4.5:1, overflow, no button chrome | appearance | all tests |
| Mobile emulation | mobile, appearance, table-view, smoke | mobile emulation smoke |
| README images from real Obsidian | readme-screenshots | only with `README_SCREENSHOTS=1` |

## Known findings the suite records

- Known low-contrast texts (Obsidian's own accent button) are listed in `KNOWN_LOW_CONTRAST`; `E2E_STRICT_CONTRAST=1` fails on them.
