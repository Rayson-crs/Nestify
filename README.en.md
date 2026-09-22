<div align="center">

<img src="./apps/desktop/resources/nestify-icon.png" width="72" alt="Nestify" />

**Nestify**

A local file-governance workbench. It indexes directories you point it at, then searches, organizes, renames, and deduplicates against that index. Disk writes only happen after a change plan is confirmed. Completed jobs can be rolled back.

</div>

The product version lives in the root `package.json` `version` field, currently `1.9.0`. Start and pack copy that value into the desktop app; About, Electron `app.getVersion()`, and the exe name all read it. The UI is Chinese. Windows x64 is the primary target. The repo is an npm workspace: the Electron shell lives in `apps/desktop`, while scanning, search, rules, planning, and execution live in `packages/core`.

Author: [Rayson](https://github.com/Rayson-crs)

- Gitee: <https://gitee.com/rayson_code/nestify>
- GitHub: <https://github.com/Rayson-crs/Nestify>

## What it is for

Explorer can open a folder. It is a poor tool once tens or hundreds of thousands of files pile up. Download trees, USB disks, and mapped NAS shares usually fail in the same way: the problem is not “find one file”, it is all of this at once:

- Deep trees, copies with the same name, archives sitting next to the folder they already unpacked into.
- The useful name is often not on the file. It sits on a parent folder, a grandparent, or the one real video inside the directory.
- OS search is slow and filters are weak. PowerToys can rename in bulk, Everything can search fast, duplicate cleaners can hash files. None of them share rules, and none of them give you one preview-and-rollback path.
- A script that writes the disk immediately is the most expensive option. Path collisions, locked files, and dropped SMB shares tend to show up after half the tree has already moved.

Nestify turns that into one local pipeline: scan into SQLite, match with rules, emit a dry-run plan, then write. Index and cache files stay in the app data directory. They are not dropped into the library root being scanned.

It is not a cloud drive, not backup software, and not a replacement for Explorer. Preview exists so you can check a rule, not so Nestify can become a media player. v1 has no cloud accounts, no two-way sync, and no unattended scheduled deletes.

## Why it exists

Every existing tool does one slice of the job and throws the index away. Search uses one catalog, rename walks the disk again, dedupe hashes a third time, and a rule written for one folder cannot be reused. Once names are wrong at the current level, tools that only look at `entry.name` cannot do `a/b/c/a.txt -> b.txt`.

The project is a workbench on purpose:

1. A library is a governance scope, not another drive window.
2. Rules read path context, extensions, and directory children, not just the current filename.
3. Anything that mutates disk goes through a plan first. Deletes land in quarantine by default. Silent unlink is not a supported path.

Electron + Node.js + TypeScript is the v1 bet: freeze the SQLite schema, the rule YAML, the IPC, and the plan/rollback contract while the product is still moving. Query and incremental writes already have workers. If a million-file library saturates JS, the replacement target is the worker, not the UI or the protocol.

## What works now

The Electron window is a library sidebar plus five workspaces: Files, Organize, Rename, Duplicates, and Jobs. Settings has an About tab with the logo, app name, version, author, and repository links.

| Surface | What it does |
| --- | --- |
| Libraries | Add a local folder, multiple folders, or one library per drive. Scans can pause, resume, and cancel. |
| Files | Search names and paths. Filters such as `ext:`, `kind:`, `parent:`, `size:` work here. A directory-tree mode walks children one level at a time. |
| Spotlight | `Ctrl+Space` by default. Searches already indexed entries and opens them. The shortcut is configurable. |
| Organize | Pick a folder, then define move / rename-file / rename-dir / flatten / quarantine rules. Preview first. |
| Rename | Template + rule groups, with old/new names shown side by side. |
| Duplicates | Size buckets, then hashing. Keep newest, oldest, shortest path, name quality, and similar policies. |
| Jobs | Execution history, per-op logs, rollback of successful ops. |
| Settings / About | Scan and thumbnail concurrency, search debounce, minimize to tray on close; About shows the current version. |

The table is just the map. What actually separates this workbench from a pile of one-off file tools is one input assistant sitting on search, organize, rename, and duplicates.

### Magic wand / input assistant

The search bar, Spotlight, organize filters, rename scope, rename-group conditions, and rename templates all hang the same spark button on the right. It opens one catalog, not a different helper per page. The host boxes stay separate; only the wand is shared.

What it inserts is what the engine actually understands:

- Search fields: `ext:`, `kind:`, `parent:`, `size:`, `mtime:`, `ctime:`, `depth:`, `has:`, `missing:`, `child_count:`, `unique_video:`.
- Recipes: empty folders, folders with a single video, videos missing subtitles, numeric names, `CD` / `DISC` folders.
- Rename templates: `{name}`, `{parent}`, `{ancestor(n)}`, `{children.main_video.stem}`, then chains such as `.trim()`, `.remove_ads()`, `.extract_year()`.
- Insertion is context-aware. Duplicate scope does not offer `dup:true`. Rename templates can trial-render against the current file.

You can still type it by hand: `kind:dir AND unique_video:true`, or `{name.trim().remove_bracket_content()}{ext}`. The wand is a catalog, not a second engine.

### Organize

Organize rewrites a directory tree. It is not a set of “dump by extension” buttons. The flow is: pick a folder, filter with the assistant, edit rules and preview, then confirm.

One rule can run several actions in order: move, rename file, rename directory, flatten nested folders, send to quarantine. Later actions see the virtual path after earlier ones; a parent rename carries down to children. Direct delete is disabled on this page. Cleanup goes to quarantine.

Preview uses a frozen snapshot, not a live walk while executing. Step 3 already shows hits, source, destination, and risk. Step 4 is the final checkbox pass. Conflict rows stay unchecked by default. The rule draft belongs to this organize session and does not rewrite the global rule-set page.

### Rename

Rename works in groups: a filter expression plus a template. Filters use search syntax. Templates use placeholders and chain functions. The table shows old and new names side by side.

The templates are built for names that live one level up, not on the current file:

```text
a/b/c/a.txt -> {parent}{ext}
folder follows its only video -> {children.main_video.stem}
download name cleanup -> {name.trim().remove_ads().remove_bracket_content().collapse_space()}{ext}
numeric name -> {name.take_parent_if_numeric()}{ext}
```

Directory and file renames can sit in the same plan. Illegal characters, empty names, overlong paths, and collisions are marked in preview and left unchecked. `{seq}` numbers the checked rows and resequences when you uncheck one.

### Duplicates

Duplicate analysis does not hash the whole library first. It size-buckets (only buckets with two or more continue), then quick-hashes, then full-hashes to confirm. Same inode / hard links count as one physical file, not wasted space.

Results are grouped. Each group keeps one copy; the rest go to quarantine. Execute-delete is gone from this page. Keep policies: newest, oldest, shortest/longest path, shortest/longest name, name quality, preferred directory. You can still flip rows by hand before the plan is built.

Hash depth is selectable: duplicate-candidate (default, faster), on-demand, or all. Disk does not change until you confirm. The job lands on the Jobs tab and can be rolled back.

Search hits SQLite. It does not walk the disk again. Longer tokens go through FTS5, short tokens and arbitrary substrings go through n-grams, with LIKE as a fallback. Image thumbnails are generated in the main process and cached. Small images can inline; common video files play from a file URL.

All writes go through a Change Plan. Same-volume work uses rename; cross-volume work copies, verifies, then removes the source. Overwrite is off by default. The executor does not silent-delete. Duplicate cleanup and rule cleanup go to quarantine.

Built-in profiles live in `packages/rules/profiles`: download inbox and media path rename. Both default to dry-run. Organize/rename rules in the desktop UI belong to the current job. Nothing hits disk until you confirm the plan.

## What is still incomplete

The main loop runs on a local machine. Treat design-doc targets as targets, not as shipped claims:

- Video thumbnails / ffmpeg frame grabs are not wired. Without a decoder, video preview degrades.
- `mediaStrategy` is mostly a library setting. Deep media signals are not in the live data path yet.
- Scan, rules, planning, and dedupe still have main-process work. Query and incremental writes already use workers; a huge library can still stall the UI.
- `scan_cursors` exists in schema. Resume-after-restart is not implemented. Pause/cancel only apply to the current process.
- Some million-file search cases have benchmarks. Not every query meets the p95 numbers in the design docs.
- Dev Electron still runs with a loose `sandbox` / `webSecurity` setup. That has to be tightened before a real release.

Functional checks only count inside the Electron window. `electron-vite` prints a Vite URL; a browser has no `window.nestify` and will show “Nestify IPC is not ready”. Use that URL for CSS only.

## Repository layout

```text
nestify/
  apps/desktop/                 desktop shell
    electron/                   Main, preload, IPC, query/writer/preview workers
    src/                        React workbench
    resources/                  app icons
    release/                    pack output (gitignored)
  packages/
    shared/                     shared types, IPC, rule schema
    core/                       domain logic, no Electron import
      src/app                   NestifyRuntime
      src/scan                  scan + index
      src/search                FTS / n-gram query
      src/rules                 match, templates, placeholders
      src/plan                  dry-run, collisions, execute, rollback
      src/duplicates            duplicate analysis
      src/organize              organize preview + snapshot
      src/db                    SQLite schema, migrations, repos
    rules/                      built-in rule sets
      profiles/                 YAML / JSON profiles
  config/                       defaults packed into the app
    app.default.yaml
    windows.yaml
    darwin.yaml
    library.default.yaml
    exclusions.default.yaml
  docs/                         product, architecture, schema, delivery status
  tools/                        search benchmark
  scripts/                      copy root version into the desktop package
  package.json                  workspace root, dev and pack entry
```

`packages/core` has to run under Node tests with no window. The renderer does not call `fs` and does not open SQLite. It talks to Main through a preload whitelist.

Path contracts: [docs/05-directory-layout.md](docs/05-directory-layout.md). Module ports: [docs/06-module-contracts.md](docs/06-module-contracts.md).

## Runtime data

Windows default: `%APPDATA%\Nestify`. Override the root with `NESTIFY_APPDATA`, the database file with `NESTIFY_DB_PATH`.

```text
%APPDATA%/Nestify/
  nestify.sqlite          single SQLite database, WAL
  config/app.yaml         user overlay
  logs/
  cache/thumbnails/       disposable thumbs
  quarantine/             app-level quarantine
  rules/                  imported / saved user rules
  tmp/
```

v1 uses one database file. Libraries are rows, distinguished by `library_id`. There is no per-library sqlite, and the index is never written into a scanned root. Same-volume quarantine folders are named `.nestify-quarantine` and are excluded from scans by default.

Config overlay order:

1. `config/app.default.yaml`
2. `config/windows.yaml` or `config/darwin.yaml`
3. `%APPDATA%/Nestify/config/app.yaml`
4. that library’s roots, exclude globs, depth, and related fields in SQLite
5. environment variables

Objects deep-merge. Arrays replace as a whole. A missing user file is an empty overlay.

## Environment

- Node.js `>= 22`. Indexing uses built-in `node:sqlite`. Older Node will not start.
- npm workspaces. Install from the repo root. Installing only inside `apps/desktop` gives you a broken tree.
- Windows 10/11 x64 is the current pack and dev target. A Darwin overlay exists in config; macOS is not the shipped artifact.
- Dev machines need Electron 37. The first `npm install` pulls Chromium and is large.

## Development

From the repo root:

```powershell
npm install
npm start
```

`npm start` and `npm run dev` both launch `@nestify/desktop` via `electron-vite dev`. Use the Electron window that appears: add a library, scan, then search.

Root scripts:

| Command | What it does |
| --- | --- |
| `npm run sync:version` | copy root version into `apps/desktop/package.json` |
| `npm start` / `npm run dev` | Electron dev window |
| `npm run build` | desktop build, no pack |
| `npm run dist` | build + Windows portable exe |
| `npm test` | `@nestify/core` and `@nestify/rules` tests |
| `npm run typecheck` | shared / core / rules / desktop |
| `npm run benchmark:search` | search bench, `tools/search-benchmark.mjs` |

The root `postinstall` script runs `npm run dist`. A first install compiles and packs after dependencies land. That is the current pack entry, not a broken install.

If you only want to hack on the app, wait for `npm install` to finish and run `npm start`. Do not treat `http://localhost:5173/` as a functional app.

A short acceptance path:

1. Start Electron. There should be no “IPC is not ready” and no database init error.
2. Use a throwaway folder with a few images, one video, and two identical files.
3. Add it as a library and scan. Watch file counts, current path, and progress. Pause and resume once.
4. Search on the Files tab, switch to directory mode, open a preview.
5. Preview one rename, execute a single op, roll it back from Jobs.
6. Analyze the identical files on Duplicates, quarantine one copy, roll that back too.

The longer matrix is in [docs/07-delivery-status.md](docs/07-delivery-status.md).

## Packaging

The shipped artifact is a Windows x64 portable exe, not an NSIS installer. Output directory is `apps/desktop/release`. Change the version in the root `package.json`, then `npm start` or `npm run dist`. The artifact name is `Nestify-v${version}.exe`, currently `Nestify-v1.9.0.exe`.

```powershell
npm install
```

Installing from the root runs `postinstall`, which is the same as:

```powershell
npm run dist
```

You can pack again later without reinstalling. `dist` runs `electron-vite build`, builds the worker, then electron-builder:

```powershell
npm run dist
```

The file you want:

```text
apps/desktop/release/Nestify-v1.9.0.exe
```

It is a portable single file. App data still goes to `%APPDATA%\Nestify`, not next to the exe. `release/` is gitignored. Do not commit a locally packed exe.

Relevant desktop pack fields:

```json
{
  "build": {
    "productName": "Nestify",
    "directories": { "output": "release" },
    "win": {
      "target": [{ "target": "portable", "arch": ["x64"] }],
      "artifactName": "Nestify-v${version}.exe"
    }
  }
}
```

The pack copies root `config/` and `apps/desktop/resources/` into extraResources. Icon: `apps/desktop/resources/nestify-icon.ico`.

## Tests

```powershell
npm test
npm run typecheck
```

Unit tests cover incremental scan, search, rule match, templates, plan collisions, execute/rollback, duplicates, and thumbnail cache — the parts that do not need a window. There is no full desktop click suite. The main path is still a manual pass in Electron.

## Docs

This README is the operator’s map of the repo. Design detail is in `docs/`:

| Doc | Contents |
| --- | --- |
| [docs/00-product-requirements.md](docs/00-product-requirements.md) | product boundary and rule model |
| [docs/01-six-core-modules.md](docs/01-six-core-modules.md) | scan, search, dedupe, rename, preview, organize |
| [docs/02-tech-stack.md](docs/02-tech-stack.md) | Electron / Node / SQLite / shadcn |
| [docs/03-architecture.md](docs/03-architecture.md) | process model and data flow |
| [docs/04-database.md](docs/04-database.md) | schema and migrations |
| [docs/05-directory-layout.md](docs/05-directory-layout.md) | repo tree and runtime dirs |
| [docs/06-module-contracts.md](docs/06-module-contracts.md) | module ports |
| [docs/07-delivery-status.md](docs/07-delivery-status.md) | what works and what does not |
| [docs/08-performance-sync-trd.md](docs/08-performance-sync-trd.md) | search performance and incremental sync |
| [docs/09-input-assistant-unification-trd.md](docs/09-input-assistant-unification-trd.md) | input assistant / magic wand |
| [docs/10-organize-trd.md](docs/10-organize-trd.md) | organize module |

Chinese README: [README.md](README.md).

## License

There is no LICENSE file in the repo yet. Ask the author before using or redistributing it.
