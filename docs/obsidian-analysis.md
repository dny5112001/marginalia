# Obsidian 1.14.4 — observed behaviour and gap analysis

Purpose: inform Marginalia's feature set by studying what Obsidian visibly does. No Obsidian
code, styles, icons or text were copied into Marginalia; only behaviours and feature lists.

## Method and authority

| Step | Tool | Evidence | Authority |
| --- | --- | --- | --- |
| Electron fuse state | REA `inspect_electron_fuses` | `ev_60f8315a…` | shipped artifact, observed |
| Main-process IPC surface | REA `analyze_javascript_application` (`main.js`, `package.json`, `index.html`) | `ev_688445b6…` | static, derived |
| Bundle inventory (partial; timed out on bundled PDF.js) | REA `analyze_javascript_application` | `ev_5d5d53c5…` | static, partial |
| Archive extraction | REA `open_binary` + `extract_artifact` | `ev_f635ae92…` | shipped artifact |
| UI string table (2,692 entries) | Static TypeScript-AST walk of `i18n.js` (not executed) | local file | static |
| Layout, views, link cache, hotkeys | Runtime: Obsidian launched on a scratch vault with Chromium remote debugging on 127.0.0.1; screenshots + read-only queries over CDP | screenshots `obs-1..4` | runtime, observed |

Limits: Obsidian disables `EnableNodeCliInspectArguments`, so REA's active Electron capture and
main-process inspection were unavailable; I did not work around that fuse. Observations cover one
macOS build and one small vault. Sync, Publish, Canvas and Bases were out of scope.

## Findings

**Architecture (static + runtime)**
- Main process registers 47 literal IPC handlers: vault registry (`vault-list`, `vault-open`,
  `vault-move`, `vault-remove`), `trash`, `print-to-pdf`, `context-menu`, `open-url`, `cli`,
  update and icon management, a "sandbox" demo vault. No preload/contextBridge was found, which
  indicates the renderer has direct Node access (Marginalia deliberately does the opposite).
- Per-vault config lives in `<vault>/.obsidian/` as JSON (`app.json`, `appearance.json`,
  `core-plugins.json`, `workspace.json`). Global vault registry lives in the app's user-data dir.
- `workspace.json` is a tree: `split` → `tabs` → `leaf`, each leaf holding a view `type`
  (`file-explorer`, `markdown`, `graph`, …) and per-view state; separate trees for main/left/right.
- The link cache keeps `resolvedLinks[source][target] = count` and
  `unresolvedLinks[source][linktext] = count`; per-file cache has links, embeds, tags, headings,
  sections, listItems, frontmatter and frontmatter links.

**Editor (runtime)**
- Default mode is Live Preview: Markdown syntax is hidden except near the cursor; headings,
  links, tags, task checkboxes, callouts and code blocks render inline.
- Frontmatter is shown as an editable Properties table (typed rows, tag chips, "Add property").
- Inline title above the body; status bar shows backlinks, property count, words, characters.

**Panels (runtime + strings)**
- Backlinks: "Linked mentions" and "Unlinked mentions" (plain-text mentions of the title, with a
  one-click "Link" action); also optionally at the bottom of the note.
- Outgoing links panel also lists unlinked mentions of other notes.
- Search supports operators `path:`, `file:`, `tag:`, `line:`, `section:`, `block:`, `task:`,
  `task-todo:`, `task-done:`, `content:`, `[property:value]`, `-exclusion`, `OR`, quoted phrases,
  `/regex/`, a match-case toggle, sort orders, and "copy results".
- Graph view: unresolved links and orphans shown by default, attachments hidden; settings overlay
  with Filters / Groups (colour by query) / Display / Forces; local graph with depth and
  incoming/outgoing/neighbour toggles.
- File explorer: sort by name/modified/created, expand/collapse all, auto-reveal, duplicate,
  move-to dialog, multi-select.

**Default hotkeys (runtime)** — Mod+O switcher, Mod+P palette, Mod+Shift+F search, Mod+G graph,
Mod+N new note, Mod+T new tab, Mod+Shift+T reopen closed tab, Mod+W close, Mod+E toggle reading,
Alt+Enter follow link, Mod+Enter open link in new tab, Mod+K insert link, Mod+L toggle checkbox,
Mod+D delete paragraph, Mod+; add property, Mod+Alt+←/→ back/forward, F2 rename, Mod+1…9 tabs.

**Core plugin inventory (strings)** — file explorer, search, quick switcher, graph, backlinks,
outgoing links, tags, properties, page preview, daily notes (prev/next), templates
(`{{date:FORMAT}}`), note composer (merge/extract), command palette, word count, bookmarks,
outline (follow cursor), file recovery (local snapshots), workspaces, random note, unique note,
slash commands, audio recorder, canvas, bases, slides, sync, publish, web viewer.

## Gap matrix and status

| Area | Obsidian (observed) | Marginalia now |
| --- | --- | --- |
| Live Preview | default editing mode | **Done** — syntax hidden off the cursor line; links, tags, tasks, bullets, rules, quotes, images render; toggle to source mode |
| Unlinked mentions | backlinks + outgoing panes | **Done** in backlinks pane with one-click "Link" (outgoing-pane variant not built) |
| Search operators | ~15 operators, exclusion, OR, regex, case | **Done** — `OR`, `-`, `( )`, phrases, `/regex/`, `tag:` `path:` `file:` `content:` `line:` `section:` `block:` `task:` `task-todo:` `task-done:` `[prop]` `[prop:value]`, match case, sort, explain, copy results |
| Properties editor | visual table | **Done** — typed rows, list/tag chips, rename/remove/add, Mod+; ; comment-preserving YAML edits |
| Callouts | rendered | **Done** in reading view (not inside Live Preview) |
| Bookmarks | files/searches/headings, groups | **Done** for files, headings, searches (stored in `.marginalia/bookmarks.json`); no groups |
| Explorer sort / duplicate / expand all | yes | **Done** (sort by name/modified; created-time sort not available from the backend) |
| Tabs: new tab, reopen closed, close others | yes | **Done** |
| Hotkeys | see list above | **Aligned**: Mod+G, Mod+T, Mod+Shift+T, Alt+Enter, Mod+Enter, Mod+; |
| Paste/drop attachments | yes | **Done** — configurable folder (root, `./`, `./sub`, fixed), never overwrites |
| File recovery | snapshots + settings | **Done** — snapshots before each save (interval/retention settings), deleted-note recovery, restore with confirmation |
| Settings parity | many | **Extended** — new-note location, attachment folder, confirm delete, readable line length, spellcheck, Live Preview, history, daily-note format/template |
| Page preview on hover | yes | **Done** — hover in reading view, Mod+hover in editor |
| Daily notes prev/next, `{{date:FMT}}` | yes | **Done** |
| Graph groups/forces/tags-as-nodes | yes | not yet |
| Split panes / multiple windows | yes | not yet |
| Note composer, slash commands, vim mode, PDF export | yes | not yet |
| Canvas, Bases, Sync, Publish, plugins | yes | out of scope |
