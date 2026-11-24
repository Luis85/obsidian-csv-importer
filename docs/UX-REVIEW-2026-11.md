# UI/UX review and information architecture, November 2026 (second pass)

Follows `docs/UI-SPEC.md` (first redesign). Evidence: `node ui-preview/build.mjs && node ui-preview/screenshot.mjs`, all scenarios, light and dark, desktop and phone. This review looks at the plugin as one product: can a user tell where they are, what to do next, and where a setting lives?

## 1. The user's goals

| # | Goal | Where it happens today |
|---|---|---|
| G1 | See what is in a CSV | Table view |
| G2 | Turn rows into notes with the right property types | Table view → Import settings → Import preview |
| G3 | Keep the notes in step when the CSV changes, without losing edits | Table view or CSV imports → Import preview |
| G4 | Find, fix or undo an import | CSV imports index, file menu, commands |
| G5 | Set sensible defaults once | Plugin settings tab |

## 2. Information architecture

The plugin has four places. Each answers one question, and every surface uses the same names for them.

| Place | Question it answers | Name used everywhere |
|---|---|---|
| Table view | What is in this CSV, and is it ready to import? | (the file name) |
| Import settings dialog | What does each note look like, and how are re-imports matched? | **Import settings** |
| Import preview / report dialog | What will happen (or happened) to each note? | **Import preview**, **Import finished** |
| CSV imports view | Which CSVs are set up, which need attention? | **CSV imports** |
| Plugin settings tab | What do new CSVs start with? | **Defaults for new CSV files** (intro) |

### Vocabulary (one word per concept)

| Concept | Use | Do not use |
|---|---|---|
| The per-CSV configuration and its dialog | Import settings | Configure, Configure CSV import, config |
| Running an import | Import / Re-import (when imported before) | Import rows as notes, Save and import |
| Reverting | Undo last import | Undo last CSV import, Undo import |
| The list of set-up CSVs | CSV imports | imports index, index |
| The key | Match notes by | key column, ID column (in UI copy) |

### Import settings tabs, ordered as the user thinks

The old **File & rows** tab mixed *how to read the file* (encoding, delimiter) with *which rows to import* (row filter), and the filter was the only content decision on that tab. Output-value settings (empty cells, number precision) were also there although they change the properties.

| Tab | Content | Why here |
|---|---|---|
| **Properties** | Columns → properties (use, name, type, options), **Extra properties** with its own heading, then **Values**: empty cells, number precision | Everything that decides a property's value |
| **Notes** | Target folder, file name, body, tags, link to the CSV, create a base | Everything that decides the note file |
| **Rows** | Filter rows (with live "4 of 6 rows match") | Which rows become notes |
| **Re-import** | **Match notes by** first, then When a note already exists (+ options), then Update notes not created by this import | Ordered by importance for G3 |
| **File format** | Encoding, delimiter, first row has names, decimal separator, date order, list separator | Rarely touched; last |

The summary line under the title keeps linking to these tabs, in plain words: `6 rows · comma · → Data/timesheet/ · matched by file name` (not `no key`).

## 3. Findings, ranked

Severity: **H** blocks or misleads a goal, **M** costs time or trust, **L** polish.

### Cross-cutting

1. **H Vocabulary drifts between surfaces.** "Configure" (button), "Configure CSV import" (file menu), "Configure import for current CSV file" (command), "Import settings" (dialog title). "Undo last CSV import" vs "Undo import" vs "Undo". Users cannot learn one name per place. → §2 vocabulary.
2. **M Generic callout titles.** "Warning" in the run dialog; "Columns changed" in the table view also carries an unrelated parser warning. A title should name the problem; unrelated problems get their own bullet under a neutral title ("2 things to check").

### Table view

3. **M The callout title lies when it merges issues** (`b-table-drift`): a parse error appears under "Columns changed".
4. **M Row checkboxes have no explanation** until one is ticked. The header checkbox needs a tooltip ("Select rows to import only those"), and the primary button must say "Import 2 selected rows".
5. **L Undo is an accent link glued to the status line** (" · Undo"). It reads as a primary action. Make it a muted link button with a tooltip "Undo last import".
6. **L No route from the table to CSV imports.** Add "Open CSV imports" to the view's more-options menu and make "Imported 3 days ago" link to the run history where possible.
7. **L Phone header row is tall** because type badges wrap under names.

### Import settings dialog

8. **H Row filter lives on the "File & rows" tab** with encoding and delimiters. → **Rows** tab.
9. **H Extra properties have no heading.** "Add property" and an unexplained sentence float under the columns table (`c-config`). → own heading "Extra properties" and description "Properties that are not columns, such as status or an ID. Written to the notes only."
10. **M Duplicate heading** "Columns" right under the "Columns" tab.
11. **M Re-import tab buries the key.** "Match notes by" is the decision that makes re-import safe, yet comes after the update-mode dropdown. Every column says "unique in every row", which is noise; the suggestion picks a long free-text column (`Beschreibung`), against UI-SPEC §2. Show the hint only where it helps (suggested, or "has duplicates" as a warning), never suggest a column whose average length is over 30 characters, and render "Use …" as a real button, not a code chip.
12. **M "no key"** in the summary is jargon. → "matched by file name" (or `key: Datum + Rolle`).
13. **M The Preview toggle in the footer is shown while the preview pane is already visible** on wide screens. Hide it when the pane is shown.
14. **L Sample column truncates both sides** (`2026-11-18 00… → 2026-1…`). Show the converted value first, raw value in `title` when they differ.

### Import preview and report

15. **M No headline.** The user has to add numbers. Lead with one sentence: "4 notes will be written to Data/timesheet/." plus "3 rows need attention" when failed/skipped > 0.
16. **M Done state: the main next step is secondary.** "Close" is the CTA and "Open base" secondary. The user's goal (G2) ends in the base. When a base exists, **Open base** is the CTA; otherwise **Open first note**; Close is always a plain button.
17. **L The "…" button has no label or tooltip**; Undo hides there. Give it `aria-label`/tooltip "More actions".

### CSV imports view

18. **H Nothing tells which CSVs need attention per row.** `changed` is known (summary callout), but rows look identical. Show a "Changed" badge (warning) and make that row's Re-import button `mod-cta`; other rows stay plain.
19. **M File names are rendered as buttons** (bordered pills), which competes with the real buttons. Render them as links (text, accent on hover, underline on focus).
20. **M Toolbar has four equal buttons** (Scan vault, Add CSV file…, Re-import all, refresh). Group the two "add" actions under one **Add CSV** menu button (Scan vault…, From your computer…); keep Re-import all and the refresh icon.
21. **L Phone rows repeat "2 edited since import"** (line 1 and line 2).
22. **L Notes column shows "…" while counting** with no width reserved; fine, but use a muted dash when 0 notes.

### Plugin settings tab

23. **M The tab is ordered by implementation** (Reading files first). Order by the user's journey: intro + "Open CSV imports" button at the top, then New notes, Re-import, Reading files, Table view, Danger zone. Intro: "Defaults for CSV files you have not set up yet. Each CSV keeps its own import settings."
24. **L The danger button is not styled as a warning.** Use `setWarning()`.
25. **L Labels differ from the dialog** ("Leave empty to create notes in a folder named like the CSV file" vs the dialog's wording). Use one string from `labels.ts` for both.

### Preview harness

26. **L `ui-preview` index host lacked `countEditedNotes` and the scan/add methods**, so the index scenarios crashed after the first row. Fixed with this review.

## 4. Work split (subagent pass)

| Owner | Files | Findings |
|---|---|---|
| A: Import settings | `src/view/ImportConfigModal.ts`, `src/view/config/*`, `owner:config` CSS block, config scenarios, README "Import settings" sections | 8–14, vocabulary in its files |
| B: Table + run | `src/view/CsvView.ts`, `src/view/TableRenderer.ts`, `src/view/ImportRunModal.ts`, `src/view/runCopy.ts`, `owner:table-run` CSS, table/run scenarios, README "Table view" | 2–7, 15–17 |
| C: Index, settings, shared, entry points | `src/view/ImportIndexView.ts`, `src/settings.ts`, `src/view/labels.ts`, `src/view/dom.ts`, `src/main.ts`, `AddCsvModal.ts`, `ScanVaultModal.ts`, `owner:shared` + `owner:index-settings` CSS, index/settings scenarios, other README sections | 1, 18–25 |
