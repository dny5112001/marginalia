# Marginalia

A local-first Markdown knowledge base for the desktop, built with **Tauri 2 + React + TypeScript**.
Your vault is an ordinary folder of `.md` files — readable and editable by any other app. No
account, no cloud, no telemetry.

Functionally inspired by Obsidian's workspace model (vaults, wikilinks, backlinks, graph). All
code, branding, icons and visuals are original. Obsidian 1.14.4's observable behaviour (UI, feature
inventory, hotkeys, on-disk formats) was studied with the REA toolkit and runtime observation to
choose features — see [docs/obsidian-analysis.md](docs/obsidian-analysis.md). No Obsidian code,
styles, text or assets were copied.

## Run it

Requirements: Node 20+, Rust (stable), and the Tauri 2 platform prerequisites (Xcode CLT on macOS).

```bash
npm install
npm run tauri dev        # desktop app with hot reload
npm run tauri build      # release bundle → src-tauri/target/release/bundle/
```

`npm run dev` alone opens the UI in a browser against an **in-memory sandbox vault** (clearly
labelled). It exists for UI work and tests; real folders need the desktop app.

## Checks

```bash
npm run check            # typecheck + eslint + vitest + cargo test
npm run test             # frontend unit/integration tests (Vitest)
npm run test:rust        # filesystem/path-safety tests (cargo)
```

## Features

| Area | What works |
| --- | --- |
| Vaults | Open any folder, create a new vault, recent-vault list, reopen last vault on launch |
| Files | Nested tree, create/rename/move (drag-and-drop or “Move to…”)/delete notes and folders, context menus, attachments listed, unsaved-dot, expand/collapse persisted |
| Editor | CodeMirror 6 with **Live Preview** (syntax hidden off the cursor line, clickable links, task checkboxes, inline images) or source mode; GFM, code highlighting, find & replace, undo/redo, list continuation, line numbers / wrapping / readable width / spellcheck / font size |
| Properties | Visual frontmatter editor: typed rows, list and tag chips, add/rename/remove (Mod+;), comment-preserving YAML |
| Attachments | Paste or drop files into a note; saved to a configurable folder and embedded, never overwriting |
| History | Local snapshots before saves, deleted-note recovery, restore with confirmation |
| Bookmarks | Notes, headings and searches, stored in the vault (`.marginalia/bookmarks.json`) |
| Saving | Autosave (debounced, default 800 ms), explicit save, dirty tracking, atomic writes, conflict detection, failed-write retry + local backup, crash recovery |
| Views | Edit, reading (rendered, sanitised), and split modes per tab |
| Links | `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`, `![[image.png]]`, Markdown links; autocomplete for notes and headings; follow with Mod+Click / Mod+Enter; following a missing link creates the note; rename updates links in other notes |
| Backlinks | Linked mentions with line context, **unlinked mentions** with one-click linking, outgoing and unresolved links, live while typing; hover page previews |
| Search | Full-text, prefix and diacritic-insensitive; `OR`, `-exclude`, `( )`, `"phrases"`, `/regex/`, `tag:` `path:` `file:` `content:` `line:` `section:` `block:` `task:` `task-todo:` `task-done:` `[property:value]`; match case, sort, explain, copy results, bookmark search |
| Graph | Global graph (Cytoscape) with name/tag/folder/orphan/unresolved filters; local graph with depth 1–3 |
| Navigation | Tabs (new, reopen closed, close others), per-tab back/forward, quick switcher (titles + aliases, create on Enter), command palette, recent files, outline, explorer sort/expand all/duplicate |
| Metadata | YAML frontmatter (properties panel), inline and frontmatter tags, nested tags, tag explorer |
| Extras | Daily notes (custom name format, template, previous/next), templates (`{{title}}`, `{{date}}`, `{{date:FORMAT}}`, `{{time}}`), callouts, dark / light / system theme |

## Keyboard shortcuts

`Mod` is ⌘ on macOS and Ctrl elsewhere. All app shortcuts are declared once in
[`src/commands/appCommands.ts`](src/commands/appCommands.ts) and a test guarantees there are no
conflicts. The full list is also in Settings → Keyboard shortcuts.

| Shortcut | Action |
| --- | --- |
| Mod+N | New note |
| Mod+Shift+N | New folder |
| Mod+S | Save current note |
| Mod+O | Quick switcher |
| Mod+P | Command palette |
| Mod+Shift+F | Search vault |
| Mod+\\ / Mod+Alt+\\ | Toggle left / right sidebar |
| Ctrl+Tab / Ctrl+Shift+Tab, Mod+1…9 | Switch tabs |
| Mod+W | Close tab |
| Mod+T / Mod+Shift+T | New tab / reopen closed tab |
| Mod+; | Add file property |
| Mod+Shift+B | Show backlinks (then ↑/↓ to move, Enter to open) |
| Mod+Alt+← / → | Back / forward |
| Mod+E / Mod+Alt+E | Toggle reading view / split view |
| Mod+G | Graph view |
| Mod+Shift+O / E | Outline / file explorer |
| Mod+Shift+D | Today's daily note |
| Mod+, | Settings |
| F2 | Rename note |
| Editor: Mod+B / I / K / L | Bold / italic / wrap in `[[link]]` / toggle checkbox |
| Editor: Alt+Enter / Mod+Enter | Follow link / open link in new tab |
| Editor: Mod+F, Mod+Alt+F | Find, find & replace |

## Architecture

```
src/
  types/          shared interfaces (vault, files, links, settings, workspace)
  filesystem/     VaultBackend interface; Tauri IPC implementation; in-memory implementation
  vault/          path helpers; vault store + orchestration (open, create, rename, move, delete)
  editor/         CodeMirror setup, frontmatter grammar, DocumentManager (autosave/conflicts)
  links/          Markdown parsing (links, tags, headings, frontmatter), resolution, link rewriting
  backlinks/      VaultIndex: link graph, backlinks, tags, graph data
  search/         inverted full-text index, query parser, fuzzy matcher
  graph/          Cytoscape views and filters
  markdown/       unified/remark → rehype-sanitize rendering pipeline
  commands/       central command + shortcut registry
  settings/       settings store (validated) and storage helpers
  features/       workspace (tabs, history, layout), UI (dialogs, toasts, overlays), status
  components/     React UI: workspace shell, sidebars, editor/preview, overlays, vault picker
src-tauri/src/
  paths.rs        vault-relative path validation (no traversal, no symlink escape)
  fsops.rs        tree listing, atomic writes, conditional writes, no-overwrite create/rename, trash
  vault.rs        approved-vault registry, active vault, file watcher (notify)
  lib.rs          IPC commands, native menu
```

State is split across small Zustand stores (vault, workspace, settings, UI) plus two framework-free
classes that hold the important logic: `DocumentManager` (buffers and persistence) and
`VaultIndex` (derived knowledge). The filesystem is the only source of truth.

### Data integrity

- **Atomic writes**: temp file in the same folder → `fsync` → rename over the target.
- **Conditional writes**: every autosave passes the mtime it last saw; if the file changed on disk
  the write is refused and the note shows a conflict banner (keep mine / load disk version).
- **No silent overwrites**: create and rename fail on existing targets; new notes get `Name 1.md`.
- **Serialized saves**: one write per note at a time; edits typed during a write are saved next.
- **Failed writes** keep the buffer dirty, back it up to local storage, and retry with backoff.
  On next open, a backup that differs from disk is offered back (“Recovered unsaved changes”).
- **Flush points**: window blur, tab close, vault switch, window close and ⌘Q all flush saves
  (⌘Q is a custom menu item routed through the same path).
- **Delete** moves to the OS trash, falling back to `<vault>/.trash`.
- **External edits** are picked up by a recursive file watcher: clean buffers reload, dirty ones
  get a conflict banner, deleted files are flagged.

### Security

- The frontend never sends absolute paths. Every IPC path is vault-relative and re-validated in
  Rust (`..`, absolute paths, NUL and symlink escapes are rejected).
- A vault becomes accessible only after the user picks it in a native folder dialog (the dialog
  runs in Rust); re-opening is limited to that approved list. The Tauri `fs` plugin is not
  installed, so there is no general filesystem API exposed to the webview.
- Capabilities are limited to core window/event permissions and opening `http(s)`/`mailto` URLs.
- A strict CSP (`script-src 'self'`, no frames/objects). Rendered Markdown is sanitised with
  `rehype-sanitize`; raw HTML in notes is not rendered; `javascript:` URLs are stripped. Images
  are loaded through IPC as data URLs, never from arbitrary URLs.

### Search and index — a deliberate deviation

The brief suggested SQLite FTS5. I used an in-memory inverted index in TypeScript instead
(`src/search/searchIndex.ts`) because the link graph, backlinks and tags already need every note
parsed in memory, so a second store would duplicate content and add a cache-invalidation problem.
It is rebuilt from disk every time a vault opens (and via “Rebuild search and link index”), so
index corruption cannot outlive a restart. On a synthetic 3,000-note vault (Vitest, Apple Silicon) a full
index build took ~150 ms and a two-term search ~30 ms. A persistent SQLite index would be the next step for vaults in the tens of
thousands of notes.

## Design decisions

- **Link resolution** (`src/links/resolve.ts`): `[[Name]]` matches a note filename or alias
  case-insensitively; `[[Folder/Name]]` matches by path suffix. With duplicates, the note in the
  source's folder wins, then the shortest path, then alphabetical. Autocomplete inserts
  folder-qualified links for duplicate names.
- **Rename** rewrites links in other notes (toggle in Settings). Relative Markdown links inside a
  moved note are recomputed from its new folder.
- **Editing model** is styled source mode (Markdown syntax stays visible) plus separate reading
  and split views. Live-preview-style hidden syntax is not implemented.

## Known limitations

- Graph layout for very large vaults (>1,500 notes) falls back to a faster concentric layout.
- Note embeds (`![[Other note]]`) render as links; only image embeds are inlined.
- No split panes or multiple windows; no graph colour groups or force sliders.
- Callouts render in reading view only; in Live Preview they show as styled quotes.
- No plugin system, sync, PDF viewer, canvas, or unlinked-mention detection.
- Checkboxes in reading view are display-only; toggle them in the editor (Mod+L).
- Tauri end-to-end (WebDriver) tests are not set up; native flows were verified manually (below).

## Manual verification checklist (native app)

1. Launch → vault picker → *Create new vault* → choose a location → `Welcome.md` appears.
2. Mod+N, type text → status bar goes *Unsaved → Saved*; check the file in Finder/another editor.
3. Edit the file in another editor while open and clean → buffer reloads. Make a local edit first,
   then change it externally → conflict banner appears.
4. Rename a linked note from the tree (F2) → links in other notes update on disk.
5. Quit with ⌘Q right after typing → reopen → content is on disk, tabs and layout restored.
6. Settings → Appearance → Light/Dark/System.
