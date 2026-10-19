import { registerCommands, type Command } from "./registry";
import { useWorkspace } from "../features/workspace/store";
import { confirmDialog, pick, prompt, toast, useUi } from "../features/ui/store";
import {
  closeVault,
  createFolder,
  createNote,
  deletePath,
  duplicateNote,
  documents,
  expandTemplate,
  openDailyNote,
  openAdjacentDailyNote,
  refreshTree,
  renamePath,
  saveAll,
  templatePaths,
  useVault,
  vaultIndex,
} from "../vault/store";
import { useSettings } from "../settings/store";
import { getActiveEditor, insertAtCursor } from "../editor/activeEditor";
import { getBackend } from "../filesystem";
import { useBookmarks } from "../features/bookmarks/store";
import { formatDate } from "../vault/dates";
import { fileHistory } from "../features/history";
import { basename, dirname, joinPath, noteTitle, validateName } from "../vault/paths";

const ws = () => useWorkspace.getState();
const activeNote = () => {
  const t = ws().activeTab();
  return t?.kind === "note" ? t.path : undefined;
};
const hasVault = () => !!useVault.getState().info;
const hasNote = () => !!activeNote();

export async function promptNewFolder(parent = "") {
  const name = await prompt({ title: "New folder", label: parent ? `Inside ${parent}` : "In vault root", initial: "", confirmLabel: "Create", validate: validateName });
  if (name) await createFolder(parent, name.trim());
}

export async function promptRename(path: string) {
  const isDir = useVault.getState().entries.some((e) => e.path === path && e.kind === "dir");
  const name = basename(path);
  const next = await prompt({
    title: isDir ? "Rename folder" : "Rename file",
    initial: name,
    confirmLabel: "Rename",
    selectStem: !isDir,
    validate: validateName,
  });
  if (!next || next.trim() === name) return;
  let newName = next.trim();
  // Keep the extension when the user typed only a stem for a note.
  if (!isDir && /\.md$/i.test(name) && !/\.[a-z0-9]+$/i.test(newName)) newName += ".md";
  await renamePath(path, joinPath(dirname(path), newName));
}

export async function promptDelete(path: string) {
  if (!useSettings.getState().settings.confirmDelete) {
    await deletePath(path);
    return;
  }
  const isDir = useVault.getState().entries.some((e) => e.path === path && e.kind === "dir");
  const count = isDir ? useVault.getState().entries.filter((e) => e.path.startsWith(path + "/") && e.kind === "file").length : 0;
  const dirty = documents.isDirty(path);
  const ok = await confirmDialog({
    title: isDir ? "Delete folder?" : "Delete file?",
    message: isDir
      ? `"${basename(path)}" and its ${count} file${count === 1 ? "" : "s"} will be moved to the trash.`
      : `"${basename(path)}" will be moved to the trash.${dirty ? " Unsaved changes will be saved first." : ""}`,
    confirmLabel: "Move to trash",
    danger: true,
  });
  if (ok) await deletePath(path);
}

export async function promptMove(path: string) {
  const folders = ["", ...useVault.getState().entries.filter((e) => e.kind === "dir").map((e) => e.path)].filter(
    (f) => f !== dirname(path) && f !== path && !f.startsWith(path + "/"),
  );
  const target = await pick({
    title: `Move "${basename(path)}" to…`,
    placeholder: "Type a folder name",
    items: folders.map((f) => ({ id: f || "/", label: f || "/ (vault root)" })),
  });
  if (target == null) return;
  await renamePath(path, joinPath(target === "/" ? "" : target, basename(path)));
}

async function insertTemplate() {
  const note = activeNote();
  if (!note || !getActiveEditor()) {
    toast("Open a note in edit mode to insert a template.");
    return;
  }
  const list = templatePaths();
  if (!list.length) {
    toast(`No templates found in "${useSettings.getState().settings.templatesFolder || "(not set)"}".`);
    return;
  }
  const id = await pick({ title: "Insert template", placeholder: "Choose a template", items: list.map((p) => ({ id: p, label: noteTitle(p), detail: p })) });
  if (!id) return;
  try {
    const content = (await getBackend().readText(id)).content;
    insertAtCursor(expandTemplate(content, noteTitle(note)));
  } catch (e) {
    toast(`Could not read template: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

async function rebuildIndex() {
  const backend = getBackend();
  useVault.setState({ indexing: true });
  try {
    const [entries, notes] = await Promise.all([backend.list(), backend.readAllMarkdown()]);
    vaultIndex.load(entries.filter((e) => e.kind === "file").map((e) => e.path), notes);
    for (const p of documents.openPaths()) {
      const d = documents.get(p);
      if (d && documents.isDirty(p)) vaultIndex.upsert(p, d.content);
    }
    await refreshTree();
    toast(`Indexed ${notes.length} notes.`, "success");
  } catch (e) {
    toast(`Index rebuild failed: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    useVault.setState((s) => ({ indexing: false, indexVersion: s.indexVersion + 1 }));
  }
}

function cycleTheme() {
  const { settings, update } = useSettings.getState();
  update({ theme: settings.theme === "dark" ? "light" : settings.theme === "light" ? "system" : "dark" });
  toast(`Theme: ${useSettings.getState().settings.theme}`);
}

export function registerAppCommands() {
  const list: Command[] = [
    { id: "note.new", name: "Create new note", category: "File", shortcut: "Mod+N", enabled: hasVault, run: () => void createNote() },
    { id: "note.newTab", name: "Create new note in new tab", category: "File", shortcut: "Mod+Shift+M", enabled: hasVault, run: () => void createNote(undefined, "Untitled", "", { newTab: true }) },
    { id: "folder.new", name: "Create new folder", category: "File", shortcut: "Mod+Shift+N", enabled: hasVault, run: () => promptNewFolder(dirname(activeNote() ?? "")) },
    {
      id: "note.save",
      name: "Save current note",
      category: "File",
      shortcut: "Mod+S",
      enabled: hasVault,
      run: async () => {
        const p = activeNote();
        if (p) await documents.save(p);
        else await saveAll();
      },
    },
    { id: "note.saveAll", name: "Save all open notes", category: "File", enabled: hasVault, run: () => saveAll() },
    { id: "note.rename", name: "Rename current note", category: "File", shortcut: "F2", global: false, enabled: hasNote, run: () => promptRename(activeNote()!) },
    {
      id: "bookmark.toggleNote",
      name: "Bookmark / unbookmark current note",
      category: "File",
      enabled: hasNote,
      run: async () => {
        const path = activeNote()!;
        const was = useBookmarks.getState().has({ type: "file", path });
        await useBookmarks.getState().toggle({ type: "file", path });
        toast(was ? "Bookmark removed." : "Bookmarked.", "success");
      },
    },
    { id: "note.history", name: "Open local history for current note", category: "File", enabled: hasNote, run: () => useUi.setState({ historyPath: activeNote()! }) },
    {
      id: "note.recoverDeleted",
      name: "Recover a deleted note from local history…",
      category: "File",
      enabled: hasVault,
      run: async () => {
        const vault = useVault.getState().info!.path;
        const gone = (await fileHistory.storage.paths(vault)).filter((p) => !vaultIndex.hasFile(p));
        if (!gone.length) return toast("No deleted notes in local history.");
        const id = await pick({ title: "Recover deleted note", placeholder: "Choose a deleted note", items: gone.map((p) => ({ id: p, label: noteTitle(p), detail: p })) });
        if (id) useUi.setState({ historyPath: id });
      },
    },
    { id: "note.duplicate", name: "Make a copy of the current note", category: "File", enabled: hasNote, run: () => void duplicateNote(activeNote()!) },
    { id: "note.move", name: "Move current note to folder…", category: "File", enabled: hasNote, run: () => promptMove(activeNote()!) },
    { id: "note.delete", name: "Delete current note", category: "File", enabled: hasNote, run: () => promptDelete(activeNote()!) },
    { id: "daily.open", name: "Open today's daily note", category: "File", shortcut: "Mod+Shift+D", enabled: () => hasVault() && useSettings.getState().settings.dailyNotesEnabled, run: () => openDailyNote() },
    {
      id: "note.addProperty",
      name: "Add file property",
      category: "Editor",
      shortcut: "Mod+;",
      enabled: hasNote,
      run: () => {
        if (!useSettings.getState().settings.livePreview) useSettings.getState().update({ livePreview: true });
        window.dispatchEvent(new CustomEvent("marginalia:add-property", { detail: activeNote() }));
      },
    },
    { id: "daily.prev", name: "Open previous daily note", category: "File", enabled: () => hasVault() && useSettings.getState().settings.dailyNotesEnabled, run: () => openAdjacentDailyNote(-1) },
    { id: "daily.next", name: "Open next daily note", category: "File", enabled: () => hasVault() && useSettings.getState().settings.dailyNotesEnabled, run: () => openAdjacentDailyNote(1) },
    { id: "template.insertDate", name: "Insert current date", category: "Editor", enabled: hasNote, run: () => void insertAtCursor(formatDate(new Date(), "YYYY-MM-DD")) },
    { id: "template.insertTime", name: "Insert current time", category: "Editor", enabled: hasNote, run: () => void insertAtCursor(formatDate(new Date(), "HH:mm")) },
    { id: "template.insert", name: "Insert template", category: "Editor", enabled: hasNote, run: () => insertTemplate() },

    { id: "nav.switcher", name: "Open quick switcher", category: "Navigate", shortcut: "Mod+O", enabled: hasVault, run: () => useUi.getState().setOverlay("switcher") },
    { id: "nav.palette", name: "Open command palette", category: "Navigate", shortcut: "Mod+P", run: () => useUi.getState().setOverlay("palette") },
    {
      id: "nav.search",
      name: "Search vault",
      category: "Navigate",
      shortcut: "Mod+Shift+F",
      enabled: hasVault,
      run: () => {
        ws().setLeftView("search");
        useUi.getState().focusSearch();
      },
    },
    { id: "nav.back", name: "Navigate back", category: "Navigate", shortcut: "Mod+Alt+ArrowLeft", run: () => ws().back() },
    { id: "nav.forward", name: "Navigate forward", category: "Navigate", shortcut: "Mod+Alt+ArrowRight", run: () => ws().forward() },
    { id: "nav.graph", name: "Open graph view", category: "Navigate", shortcut: "Mod+G", enabled: hasVault, run: () => ws().openGraph() },
    {
      id: "nav.backlinks",
      name: "Show backlinks for current note",
      category: "Navigate",
      shortcut: "Mod+Shift+B",
      enabled: hasNote,
      run: () => {
        ws().setRightView("backlinks");
        setTimeout(() => (document.querySelector(".backlink-item") as HTMLElement | null)?.focus(), 30);
      },
    },
    { id: "nav.outline", name: "Show outline", category: "Navigate", shortcut: "Mod+Shift+O", enabled: hasNote, run: () => ws().setRightView("outline") },
    { id: "nav.files", name: "Show file explorer", category: "Navigate", shortcut: "Mod+Shift+E", enabled: hasVault, run: () => ws().setLeftView("files") },
    { id: "nav.tags", name: "Show tags", category: "Navigate", enabled: hasVault, run: () => ws().setLeftView("tags") },
    { id: "nav.bookmarks", name: "Show bookmarks", category: "Navigate", enabled: hasVault, run: () => ws().setLeftView("bookmarks") },
    { id: "nav.revealActive", name: "Reveal current file in file explorer", category: "Navigate", enabled: hasNote, run: () => {
      ws().setLeftView("files");
      ws().revealPath(activeNote()!);
      setTimeout(() => document.querySelector<HTMLElement>(".tree-row.active")?.scrollIntoView({ block: "center" }), 50);
    } },

    { id: "tab.new", name: "New tab", category: "Tabs", shortcut: "Mod+T", enabled: hasVault, run: () => ws().newTab() },
    { id: "tab.close", name: "Close current tab", category: "Tabs", shortcut: "Mod+W", run: () => closeActiveTab() },
    { id: "tab.reopen", name: "Reopen closed tab", category: "Tabs", shortcut: "Mod+Shift+T", enabled: () => ws().closedTabs.length > 0, run: () => ws().reopenClosedTab() },
    { id: "tab.closeOthers", name: "Close all other tabs", category: "Tabs", enabled: () => ws().tabs.length > 1, run: () => ws().closeOtherTabs(ws().activeTabId!) },
    { id: "tab.next", name: "Next tab", category: "Tabs", shortcut: "Ctrl+Tab", global: true, run: () => ws().cycleTab(1) },
    { id: "tab.prev", name: "Previous tab", category: "Tabs", shortcut: "Ctrl+Shift+Tab", global: true, run: () => ws().cycleTab(-1) },
    ...Array.from({ length: 9 }, (_, i): Command => ({
      id: `tab.goto${i + 1}`,
      name: i === 8 ? "Go to last tab" : `Go to tab ${i + 1}`,
      category: "Tabs",
      shortcut: `Mod+${i + 1}`,
      run: () => ws().activateIndex(i),
    })),

    { id: "view.left", name: "Toggle left sidebar", category: "View", shortcut: "Mod+\\", run: () => ws().toggleLeft() },
    { id: "view.right", name: "Toggle right sidebar", category: "View", shortcut: "Mod+Alt+\\", run: () => ws().toggleRight() },
    {
      id: "view.togglePreview",
      name: "Toggle edit / reading view",
      category: "View",
      shortcut: "Mod+E",
      enabled: hasNote,
      run: () => {
        const t = ws().activeTab()!;
        ws().setMode(t.id, t.mode === "preview" ? "edit" : "preview");
      },
    },
    {
      id: "view.split",
      name: "Toggle split editor / preview",
      category: "View",
      shortcut: "Mod+Alt+E",
      enabled: hasNote,
      run: () => {
        const t = ws().activeTab()!;
        ws().setMode(t.id, t.mode === "split" ? "edit" : "split");
      },
    },
    {
      id: "view.sourceMode",
      name: "Toggle Live Preview / Source mode",
      category: "View",
      run: () => {
        const s = useSettings.getState();
        s.update({ livePreview: !s.settings.livePreview });
        toast(useSettings.getState().settings.livePreview ? "Live Preview" : "Source mode");
      },
    },
    {
      id: "view.readableWidth",
      name: "Toggle readable line length",
      category: "View",
      run: () => {
        const s = useSettings.getState();
        s.update({ readableLineLength: !s.settings.readableLineLength });
      },
    },
    { id: "view.theme", name: "Cycle theme (dark / light / system)", category: "View", shortcut: "Mod+Alt+T", run: () => cycleTheme() },
    {
      id: "view.lineNumbers",
      name: "Toggle line numbers",
      category: "View",
      run: () => {
        const s = useSettings.getState();
        s.update({ lineNumbers: !s.settings.lineNumbers });
      },
    },
    {
      id: "view.wrap",
      name: "Toggle line wrapping",
      category: "View",
      run: () => {
        const s = useSettings.getState();
        s.update({ lineWrapping: !s.settings.lineWrapping });
      },
    },
    {
      id: "view.fontUp",
      name: "Increase editor font size",
      category: "View",
      shortcut: "Mod+=",
      run: () => {
        const s = useSettings.getState();
        s.update({ editorFontSize: Math.min(28, s.settings.editorFontSize + 1) });
      },
    },
    {
      id: "view.fontDown",
      name: "Decrease editor font size",
      category: "View",
      shortcut: "Mod+-",
      run: () => {
        const s = useSettings.getState();
        s.update({ editorFontSize: Math.max(10, s.settings.editorFontSize - 1) });
      },
    },

    { id: "app.settings", name: "Open settings", category: "App", shortcut: "Mod+,", run: () => useUi.getState().setOverlay("settings") },
    { id: "app.shortcuts", name: "Show keyboard shortcuts", category: "App", shortcut: "Mod+Shift+/", run: () => useUi.getState().setOverlay("shortcuts") },
    { id: "vault.rebuildIndex", name: "Rebuild search and link index", category: "Vault", enabled: hasVault, run: () => rebuildIndex() },
    { id: "vault.switch", name: "Switch or open another vault", category: "Vault", enabled: hasVault, run: () => closeVault() },
  ];
  registerCommands(list);
}

export async function closeActiveTab() {
  const t = ws().activeTab();
  if (!t) return;
  if (t.path) {
    await documents.flush(t.path);
    const d = documents.get(t.path);
    if (d && (d.status === "conflict" || d.status === "error") && documents.isDirty(t.path)) {
      const ok = await confirmDialog({
        title: "Close with unsaved changes?",
        message: `"${basename(t.path)}" could not be saved (${d.error ?? d.status}). Your changes stay backed up and are offered again when you reopen the note.`,
        confirmLabel: "Close tab",
        danger: true,
      });
      if (!ok) return;
    }
    const stillOpen = ws().tabs.some((x) => x.id !== t.id && x.path === t.path);
    if (!stillOpen) documents.close(t.path);
  }
  ws().closeTab(t.id);
}
