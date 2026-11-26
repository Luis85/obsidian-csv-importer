# Release review before 1.0.0

This review checked 0.4.1 before its first community directory release, as 1.0.0. Three read-only reviewers looked at data safety, directory compliance and the release pipeline, and product, docs and performance. Each data-safety finding was reproduced with a unit test before it was fixed; those tests are now in `tests/unit/dataSafety.test.ts` and next to the code they cover.

Status as of 2026-11-26. **Done** means it is on the branch for 1.0.0. The [earlier review](REVIEW-2026-11.md) covers findings up to 0.4.

## Checks at the start

- Lint, the three type checks, 613 unit tests, the build and fallow passed. `npm audit` found no vulnerabilities in production dependencies.
- The directory requirements in [SUBMISSION.md](SUBMISSION.md) were checked against the code, not the checklist, and all passed:
  - manifest rules;
  - command ids and names;
  - no `innerHTML`, and only `console.error`;
  - no network or clipboard use;
  - Vault API writes and `normalizePath`;
  - registered listeners and declarative settings;
  - the MIT license and no committed build output.

## Checks at the end

- Lint, the type checks, 644 unit tests, the build and fallow pass.
- End-to-end tests pass: 50 desktop specs (Obsidian 1.15.1 and latest) and 3 mobile emulation specs, locally and in CI.
- The mutation score is 92.9 % (3,659 of 3,937 mutants detected); the threshold is 90 %.

## Blocking

| # | Finding | Change | Status |
| --- | --- | --- | --- |
| R1 | The working branch was behind `main`, where 0.4.1 had already been released. The Release workflow would have committed 1.0.0 to that branch, while the directory reads `manifest.json` from `main`. | Branch merged with `main`. Manual releases now refuse any ref other than the default branch. | Done |
| R2 | `main` had no "Unreleased" changelog section, so 1.0.0 would have shipped with the notes "Release 1.0.0.". | 1.0.0 section written. A release without notes for its version now fails (`release-notes.mjs --require`). | Done |
| D1 | **Multi-line cells from CRLF CSVs never updated again.** Quoted cells kept `\r\n` in the snapshot hash while the note got `\n`, so every re-import treated the cell as edited in Obsidian. | Line breaks in quoted fields become `\n` in the parser. Old CRLF hashes still match (`matchesHash`). | Done |
| D2 | **Gap in 0.4.1's omit fix.** Notes imported by 0.4.0 had no snapshot entry for an omitted property, and none was ever added, so a value the user added was overwritten once the CSV had one. | Rule 1 of the merge records the empty hash for such keys. | Done |
| D3 | **A damaged snapshot silently turned off edit protection.** It was read as empty, the next re-import overwrote edits, and the next save destroyed the file. | Writes go through `<file>.tmp`, with fallback to it on read. An unreadable file is kept as `.unreadable` and reported in the import preview. A failed write is retried. | Done |
| D4 | **Deleting a CSV inside Obsidian wiped its settings and history at once**, against the README's "CSV missing" promise. Restoring the file from the trash, or a delete and re-create by a sync tool, lost ownership and undo. | The delete event no longer forgets anything. **Remove from CSV imports** does. | Done |
| D5 | **No format versions.** The state files had no version, and `data.json` written by a newer version was overwritten. | `version` in `<hash>.json` and `<hash>.undo.json`; newer files are not read. Newer `data.json` is read but never saved (a notice says so). Global settings are sanitized. | Done |

## Should fix

| # | Finding | Change | Status |
| --- | --- | --- | --- |
| S1 | With a placeholder folder, a row whose folder changed (or a note moved to a sibling folder) got a second note. | The key index also searches the folders of the notes in the snapshot (outermost folders only). | Done |
| S2 | An undo cut off halfway could not be finished. The second run treated restored notes as edited, and later re-imports kept the restored values as edits. | A note that already holds its previous content counts as restored. | Done |
| S3 | **Re-import all** could not be stopped as a whole. | Asks whether to go on after a dialog closed without importing, or after a stopped import. | Done |
| S4 | Read errors dropped their cause. | Notices name the reason (`readFailureText`). | Done |
| S5 | Large files froze Obsidian with no feedback. | Confirmation above 50 MB; a notice while a large import is prepared. | Done |
| S6 | The table view re-ran type inference on every redraw and kept appending rows forever. | Inference is cached per parse and config. The table stops at 5,000 rows with a hint. One delegated listener handles the row checkboxes. | Done |
| S7 | The CSV imports view rechecked every imported note on any metadata change and refreshed on every rename or delete in the vault. | It reacts only to CSVs, bases and notes inside an import's folder (`metadataCache` `changed`). | Done |
| S8 | BRAT and beta wording in the README, CONTRIBUTING.md and SUBMISSION.md. | Removed. The 0.x history was reworded. | Done |
| S9 | "Privacy and data" left out note folders in `index.json` and the CSV path in `<hash>.json`, and hardcoded `.obsidian/`. | Rewritten, including `.tmp` and `.unreadable`. | Done |
| S10 | The `csv-importer:changed` event and `importFile` were not documented, with no statement about their stability. | README section "For other plugins": these are stable within 1.x; everything else is internal. | Done |
| S11 | The end-to-end tests did not run on release. | `e2e.yml` is a reusable workflow, and the release job needs it. | Done |
| S12 | The release could not recover from a failure after the tag push, and the `major` input would have bumped twice. | `version=current` finishes the release of a tag that points to the current commit. The docs recommend an explicit `x.y.z`. | Done |
| S13 | A CSV with only a header row said "This file has no rows." | Own message. | Done |

## Nice to have

| # | Finding | Change | Status |
| --- | --- | --- | --- |
| N1 | `1.10` and `2.0` were imported as 1.1 and 2. | Columns named Version, Release or Build stay text. Other columns are unchanged, because prices like `2.50` are common. | Done |
| N2 | The merge used `metadataCache`, which can lag behind an edit made just before. | The merge is decided again inside `processFrontMatter`, on the current frontmatter. | Done |
| N3 | A note renamed during a run got its old path back at the final save. | `ImportStorage.trackNoteMoves` applies renames to the run's own state. | Done |
| N4 | Vault names were not NFC-normalized in lookups. | `PathIndex` compares NFC and lower case. | Done |
| N5 | Paths over Windows' limit only failed at write time. | Preview warning above 200 characters. Names are not shortened, because that would change the names of existing notes. | Done |
| N6 | `a, "b,c"` split inside the quotes. | A quote after leading spaces opens a quoted field. | Done |
| N7 | A failed state write cleared the dirty flag. | The flag is restored, so the next save retries. | Done |
| N8 | The keyboard type menu used a synthetic `MouseEvent`, and the select-all checkbox had only a tooltip. | `showAtPosition` with focus returned to the badge; the checkbox has an `aria-label`. | Done |
| N9 | Actions were pinned by major tag. | Pinned by SHA, with Dependabot. | Done |
| N10 | `version-bump.mjs` duplicated `prepare-release.mjs`. `package.json` lacked `repository`, `bugs` and `homepage`, and its description differed from the manifest's. | Removed and added; `npm version` uses `prepare-release.mjs`. | Done |
| N11 | `check-api-versions` skipped method overrides. | Also checks class members that override newer base members. | Done |
| N12 | A crash during an import can lose up to 200 rows or about 2 s of history (checkpoint cadence). | Not changed: checkpointing more often would multiply writes of large snapshots, now written twice through the temporary copy. Documented in the README limitations, with the source link as the fallback. | Documented |
| N13 | The `obsidian` type package (1.14.4, the newest published) is older than `minAppVersion` 1.15.1. | Nothing to do until a newer package is published. | Open |
| N14 | A release published in the GitHub UI can start the workflow twice (release and tag push). | Left as is: the concurrency group runs the two one after the other, and the second only re-uploads the same files. | Accepted |

## Backlog after 1.0

The earlier [open backlog](REVIEW-2026-11.md#open-backlog) still applies:

- stub notes for linked values;
- automatic re-import;
- more than one row filter condition;
- a link from "Imported 3 days ago" to the run history.

None of these blocks 1.0. The quality gates from that backlog (fallow and mutation tests) now block releases; see [SUBMISSION.md](SUBMISSION.md#quality-gates).
