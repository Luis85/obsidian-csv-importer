# Plan for 0.2: architecture, rules, user needs

This plan draws on three reviews from November 2026:

- **User research, round 2:** Bases workflows, common CSV sources, competitor issues, mobile, locales and sync.
- **Obsidian rules and linter:** current guidelines, the sample plugin, every `eslint-plugin-obsidianmd` rule, and the toolchain.
- **Architecture and code quality:** layering, duplication, types and tests.

## Phase 1: contracts (done)

- `src/core/util.ts`: `errorMessage`, `parentOf`, `plural`.
- `src/core/result.ts`: `ROW_REASON` constants and the `RowReason` type, plus `emptyResult()`.
- `types.ts`:
  - `UndoManifest.truncated` replaces two casts.
  - `HeaderDrift` is shared.
- `host.readCsvDecoded(file, encoding)`: the settings dialog no longer decodes bytes itself.

## Phase 2: refactor with no behaviour change

The existing 220 tests must stay green. Each worker has its own files:

| Worker | Owns | Changes |
| --- | --- | --- |
| W1, importer | `src/import/importer.ts`, new `src/import/{vaultGateway,ownership,undo,pathIndex,checkpointer}.ts` | <ul><li>Split the 364-line `writeNotes`.</li><li>A `VaultGateway` interface sits between the import code and the Obsidian vault, with an Obsidian implementation behind it.</li><li>The rule for which notes an import may change becomes a pure function, `isOwned`.</li><li>`PathIndex` handles case-insensitive paths and free names.</li><li>`Checkpointer` handles the timing of progress saves.</li><li>`writeNotes` keeps the same signature.</li></ul> |
| W2, core planning | `src/import/noteBuilder.ts` (stays a barrel), `src/csv/*`, new `src/import/{templates,yaml,folders}.ts` | <ul><li>One template engine.</li><li>The YAML serializer moves out.</li><li>Folder rules, including `staticPrefix`, move to `folders.ts`.</li><li>Shared builders for conversion and inference options.</li></ul> |
| W3, Obsidian adapters | `src/main.ts`, `src/storage.ts`, `src/configStore.ts`, new `src/obsidian/{importService,vaultEvents,baseFiles}.ts` | <ul><li>`main.ts` keeps only wiring.</li><li>`ImportService` runs the import and undo flows.</li><li>Event handlers catch rejections.</li><li>`storage.migrate` is split into rebuilding the index and migrating the legacy layout.</li><li>Dead code is removed.</li></ul> |
| W4, UI | `src/view/*`, `src/settings.ts`, `styles.css` | <ul><li>`labels.ts` holds a single copy of the labels.</li><li>`dom.ts` holds the callout and safe-folder helpers.</li><li>The settings dialog is split into sections around a shared draft state.</li><li>`TableRenderer` for the table view.</li><li>Use `ROW_REASON`.</li><li>Rename the unscoped `.is-hidden` class to a prefixed one.</li><li>`.catch` on undo.</li></ul> |
| T, tests | `tests/**` | <ul><li>Shared harness.</li><li>Characterization tests for `ConfigStore`, value templates, and old vs compiled templates.</li><li>Replace the timing test that measures wall-clock time.</li></ul> |

## Phase 3: features and rules

### User needs

- **More date formats:** `DD/MM/YYYY`, `MM/DD/YYYY`, `DD-MM-YYYY` and month names such as `18 Nov 2026`.
  - Ambiguous slash dates are read using a per-file **Date order** setting: Auto, Day first or Month first. Auto infers the order only when a value has a day above 12.
- **Currency and percent:** an optional per-column **Strip units** setting turns `1.234,56 €`, `$1,234.56` and `12 %` into numbers.
- **Composite key:** **Match notes by column** accepts several columns, joined with ` | `.
- **Filter rows before import:** an optional rule per file such as "column equals, contains, is not empty, or is greater than a value". It is applied in the preview and in the import.
- **Duplicate keys:** the preview warns when a key repeats inside the CSV, or when more than one note in the folder has the same key, for example a sync `Conflicted copy`.
- **Large imports:** the preview warns above 5,000 notes.
- **Locale regression tests:** `;` must win over decimal commas, `1 234,56`, and a narrow no-break space as the thousands separator.

### Obsidian rules and toolchain

- The release workflow adds build provenance attestations for `main.js` and `styles.css`, as the sample plugin does.
- Declarative settings with `getSettingDefinitions()`. Update: `minAppVersion` was raised to 1.15.1 at the user's request, so version guards and the `display()` fallback were removed.
- Saved data gets a schema version (`version: 1`), so later versions can migrate it.
- Final saves after a write are caught like checkpoints. The notes were written, so the user is told that the history could not be saved.
- CI runs on Node 20, 22 and 24.
- Sentence-case lint rule as a warning.

## Phase 4: strict TypeScript

This runs last and on its own, because it touches every file:

- `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters` and `noImplicitOverride`.
- `noUncheckedIndexedAccess`: 71 errors in `src`, worth fixing in a CSV parser.
- A separate `tsconfig.test.json`, so Node types can't leak into plugin code.

## Not planned

- Merging several columns into one list.
- Multi-CSV deduplication.
- Summaries in the generated base.
- A German UI.
- Exporting back to CSV.
