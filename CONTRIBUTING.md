# Contributing

## Development setup

Requires Node 20.19 or newer.

```sh
npm install
npm run dev      # watch build
```

Copy (or symlink) `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/csv-importer/` to try a build, then reload Obsidian.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | esbuild watch build |
| `npm run build` | typecheck and production build |
| `npm run typecheck` | `tsc` only |
| `npm test` | vitest, single run |
| `npm run test:watch` | vitest in watch mode |
| `npm run lint` | eslint with `eslint-plugin-obsidianmd` |

## Architecture

Modules in `src/`:

| Path | Role |
| --- | --- |
| `main.ts` | Plugin class: commands, menus, view registration, rename handling, wiring |
| `host.ts` | Interface the view and modals use to talk to the plugin (no circular imports) |
| `types.ts`, `defaults.ts` | Shared types and default settings |
| `settings.ts` | Settings tab |
| `configStore.ts` | In-memory per-file configs keyed by vault path |
| `storage.ts` | Persistence: `data.json`, per-CSV import state and undo data under the plugin folder |
| `csv/parser.ts` | Quote-aware CSV parsing, delimiter detection, warnings |
| `csv/encoding.ts` | Encoding detection and decoding |
| `csv/typeInference.ts` | Per-column type inference and value conversion |
| `import/noteBuilder.ts` | Turns rows into planned notes (templates, YAML serialization, file names), no vault access |
| `import/merge.ts` | Merges a planned note into an existing one (update mode, edit protection) |
| `import/importer.ts` | Runs an import: matching, outcomes, dry run, undo |
| `import/baseFile.ts` | Generates the `.base` file |
| `view/CsvView.ts` | Table view |
| `view/ImportConfigModal.ts` | Import settings dialog |
| `view/ImportRunModal.ts` | Preview, progress and report dialog |
| `view/ConfirmModal.ts`, `view/shared.ts` | Small shared UI pieces |

Pure logic (`csv/`, `import/noteBuilder.ts`, `import/merge.ts`) does not touch the vault, so it is tested without Obsidian.

## Testing

Tests are in `tests/` and run with vitest. `tests/mocks/obsidian.ts` is a mock of the parts of the `obsidian` module the code uses (vault, files, `Notice`, and so on); `tests/mocks/setup.ts` wires it in. Add a test with every behavior change. `acceptance.test.ts` and `reimport.test.ts` cover end-to-end imports and re-imports.

## Lint rules

`npm run lint` uses `eslint-plugin-obsidianmd` (the rules the community plugin review applies). Typical points: sentence case UI text, no `innerHTML`, no default hotkeys, `vault.process` instead of `vault.modify`, no stray `console.log`. See [docs/SUBMISSION.md](docs/SUBMISSION.md) for the full checklist.

## Release process

Releases are automated by the [release workflow](.github/workflows/release.yml).

1. Add your changes under a `## Unreleased` heading in `CHANGELOG.md`. The workflow renames it to the version and uses it as release notes.
2. Run the **Release** workflow from the Actions tab, or `gh workflow run release.yml -f version=minor`. The `version` input is one of `current` (release the version already in `manifest.json`), `patch`, `minor`, `major` or an explicit `x.y.z`.
3. The workflow bumps `package.json`, `manifest.json` and `versions.json`, runs lint, tests and build, commits `Release x.y.z`, pushes the tag (no `v` prefix) and publishes a GitHub release with `main.js`, `manifest.json` and `styles.css`. BRAT picks it up automatically.

Notes:

- Run the workflow from a branch. The selected ref must be a branch, not a tag; the workflow pushes the release commit to it. The workflow file must exist on the default branch to be run manually.
- If the branch is protected, allow `github-actions[bot]` to push.
- Alternatives that do not bump the version: push a tag equal to the `manifest.json` version (`git push origin 1.2.3`), or publish a release in the GitHub UI with such a tag. Both build and attach the files.
- To submit to the community catalog, see [docs/SUBMISSION.md](docs/SUBMISSION.md).
