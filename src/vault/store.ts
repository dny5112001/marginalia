import { create } from "zustand";
import type { FileEntry, VaultInfo } from "../types";
import { getBackend, toBackendError } from "../filesystem";
import { VaultIndex } from "../backlinks/vaultIndex";
import { DocumentManager } from "../editor/documents";
import { getSettings } from "../settings/store";
import { flushWorkspacePersist, useWorkspace } from "../features/workspace/store";
import { toast } from "../features/ui/store";
import { rewriteLinks } from "../links/rewrite";
import { basename, dirname, isAncestor, isMarkdown, joinPath, noteTitle, remapPath, uniquePath } from "./paths";
import { readJson, writeJson } from "../settings/storage";
import { useBookmarks } from "../features/bookmarks/store";
import { expandTemplateVars, formatDate, parseDate } from "./dates";
import { fileHistory } from "../features/history";

interface VaultStore {
  info: VaultInfo | null;
  known: VaultInfo[];
  entries: FileEntry[];
  status: "idle" | "opening" | "ready" | "error";
  error: string | null;
  indexing: boolean;
  /** Bumps whenever the index changes so views re-derive. */
  indexVersion: number;
}

export const useVault = create<VaultStore>(() => ({
  info: null,
  known: [],
  entries: [],
  status: "idle",
  error: null,
  indexing: false,
  indexVersion: 0,
}));

/** Derived knowledge index (links, tags, headings, search). Rebuildable from disk. */
export const vaultIndex = new VaultIndex();

const vaultKey = () => useVault.getState().info?.path ?? "none";

export const documents = new DocumentManager({
  backend: getBackend,
  delayMs: () => getSettings().autosaveDelayMs,
  backupPrefix: () => `marginalia:backup:${vaultKey()}:`,
  beforeWrite: (path, previous) => void fileHistory.recordBeforeSave(vaultKey(), path, previous).catch(() => {}),
});

const bumpIndex = () => useVault.setState((s) => ({ indexVersion: s.indexVersion + 1 }));

// Keep the index in sync with live buffers (debounced per note) so backlinks,
// outline and search reflect unsaved edits too.
const indexTimers = new Map<string, ReturnType<typeof setTimeout>>();
documents.subscribe((path) => {
  const d = documents.get(path);
  if (!d || d.status === "loading" || !isMarkdown(path)) return;
  if (vaultIndex.content(path) === d.content) return;
  clearTimeout(indexTimers.get(path));
  indexTimers.set(
    path,
    setTimeout(() => {
      indexTimers.delete(path);
      const cur = documents.get(path);
      if (cur && useVault.getState().info) {
        vaultIndex.upsert(path, cur.content);
        bumpIndex();
      }
    }, 250),
  );
});

let unwatch: (() => void) | null = null;
const LAST_VAULT_KEY = "marginalia:lastVault";

export async function loadKnownVaults() {
  try {
    useVault.setState({ known: await getBackend().listKnownVaults() });
  } catch {
    useVault.setState({ known: [] });
  }
}

async function activate(info: VaultInfo) {
  useVault.setState({ info, status: "opening", error: null, indexing: true });
  writeJson(LAST_VAULT_KEY, info.path);
  const backend = getBackend();
  const [entries, notes] = await Promise.all([backend.list(), backend.readAllMarkdown()]);
  vaultIndex.load(
    entries.filter((e) => e.kind === "file").map((e) => e.path),
    notes,
  );
  const exists = new Set(entries.map((e) => e.path));
  useWorkspace.getState().load(info.path, (p) => exists.has(p));
  useVault.setState({ entries, status: "ready", indexing: false });
  bumpIndex();
  void useBookmarks.getState().load();
  void fileHistory.prune().catch(() => {});
  unwatch?.();
  unwatch = await backend.onChange((paths) => void handleExternalChanges(paths));
  void loadKnownVaults();
}

async function closeCurrent() {
  if (!useVault.getState().info) return;
  await documents.flushAll();
  flushWorkspacePersist();
  documents.closeAll();
  unwatch?.();
  unwatch = null;
  vaultIndex.clear();
  useWorkspace.getState().reset();
  useBookmarks.getState().reset();
  await getBackend().closeVault().catch(() => {});
  useVault.setState({ info: null, entries: [], status: "idle" });
}

/** Run an operation that returns nothing; reports failure as a toast and returns whether it succeeded. */
async function attempt(what: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    toast(`${what}: ${toBackendError(e).message}`, "error");
    return false;
  }
}

async function guard<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    const err = toBackendError(e);
    toast(`${what}: ${err.message}`, "error");
    return undefined;
  }
}

export async function openVaultViaDialog() {
  const info = await guard("Could not open vault", () => getBackend().pickOpenVault());
  if (!info) return;
  await closeCurrent();
  if (!(await attempt("Could not open vault", () => activate(info)))) failOpen();
}

export async function createVaultViaDialog(name: string) {
  const info = await guard("Could not create vault", () => getBackend().pickCreateVault(name));
  if (!info) return;
  await closeCurrent();
  if (!(await attempt("Could not open vault", () => activate(info)))) failOpen();
}

export async function openKnownVault(path: string) {
  await closeCurrent();
  const ok = await attempt("Could not open vault", async () => activate(await getBackend().openKnownVault(path)));
  if (!ok) failOpen();
}

function failOpen() {
  if (useVault.getState().status !== "ready") useVault.setState({ info: null, status: "idle", indexing: false });
}

export async function forgetVault(path: string) {
  await attempt("Could not remove vault from list", () => getBackend().forgetVault(path));
  await loadKnownVaults();
}

export async function closeVault() {
  writeJson(LAST_VAULT_KEY, null);
  await closeCurrent();
  await loadKnownVaults();
}

let restoring: Promise<void> | null = null;

/** On startup: reopen the last vault if it is still approved and present. Idempotent. */
export function restoreLastVault() {
  return (restoring ??= doRestoreLastVault());
}

async function doRestoreLastVault() {
  await loadKnownVaults();
  const last = readJson(LAST_VAULT_KEY);
  const backend = getBackend();
  if (!backend.native) {
    // Browser sandbox: open the in-memory vault directly.
    return activate(await backend.openKnownVault(""));
  }
  if (typeof last !== "string") return;
  try {
    await activate(await backend.openKnownVault(last));
  } catch (e) {
    useVault.setState({ status: "idle", info: null, indexing: false });
    toast(`Could not reopen last vault: ${toBackendError(e).message}`, "error");
  }
}

export async function refreshTree() {
  const entries = await getBackend().list();
  useVault.setState({ entries });
  vaultIndex.setFiles(entries.filter((e) => e.kind === "file").map((e) => e.path));
  bumpIndex();
  return entries;
}

/** Apply watcher events: refresh the tree, re-index changed notes, reconcile open buffers. */
export async function handleExternalChanges(paths: string[]) {
  if (!useVault.getState().info) return;
  let entries: FileEntry[];
  try {
    entries = await refreshTree();
  } catch {
    return;
  }
  const files = new Set(entries.filter((e) => e.kind === "file").map((e) => e.path));
  const backend = getBackend();
  for (const p of paths) {
    if (files.has(p)) {
      if (isMarkdown(p)) {
        try {
          const f = await backend.readText(p);
          const open = documents.get(p);
          // For a dirty buffer the index keeps tracking the buffer.
          if (!open || !documents.isDirty(p)) vaultIndex.upsert(p, f.content);
        } catch {
          /* transient read failure: next event will retry */
        }
      }
      await documents.handleExternalChange(p);
    } else {
      for (const open of documents.openPaths()) {
        if (!isAncestor(p, open) || files.has(open)) continue;
        if (documents.isDirty(open)) documents.handleExternalDelete(open);
        else {
          documents.close(open);
          useWorkspace.getState().removePath(open);
        }
      }
    }
  }
  bumpIndex();
}

const takenPaths = () => useVault.getState().entries.map((e) => e.path);

/** Folder for a new note when none is given, per the "Default location for new notes" setting. */
export function defaultNoteFolder(): string {
  const s = getSettings();
  if (s.newNoteLocation === "root") return "";
  if (s.newNoteLocation === "current") {
    const t = useWorkspace.getState().activeTab();
    return t?.kind === "note" && t.path ? dirname(t.path) : "";
  }
  return s.newNoteFolder;
}

export async function createNote(folder?: string, name = "Untitled", content = "", opts: { newTab?: boolean } = {}) {
  const dir = folder ?? defaultNoteFolder();
  const path = uniquePath(joinPath(dir, `${name}.md`), takenPaths());
  const ok = await attempt("Could not create note", () => getBackend().createFile(path, content));
  if (!ok) return null;
  vaultIndex.upsert(path, content);
  await refreshTree();
  useWorkspace.getState().openNote(path, { newTab: opts.newTab, mode: "edit" });
  return path;
}

/** Folder for new attachments: "" = vault root, "./" = next to the note, "./sub" = subfolder of the note's folder. */
export function attachmentFolderFor(notePath: string, setting = getSettings().attachmentFolder): string {
  const s = setting.trim();
  if (s === "." || s === "./") return dirname(notePath);
  if (s.startsWith("./")) return joinPath(dirname(notePath), s.slice(2));
  return joinPath(s);
}

function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Save a pasted/dropped file into the vault next to `notePath` (per settings) and
 * return the Markdown to insert, or null on failure. Never overwrites existing files.
 */
export async function saveAttachment(notePath: string, file: { name: string; type: string; base64: string }): Promise<string | null> {
  const isImg = file.type.startsWith("image/");
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : isImg ? "." + (file.type.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg") : "";
  const generic = !file.name || /^image\.(png|jpe?g|gif|webp)$/i.test(file.name);
  const base = generic ? `Pasted image ${stamp()}${ext}` : file.name.replace(/[\\/:*?"<>|#^[\]]/g, "-");
  const path = uniquePath(joinPath(attachmentFolderFor(notePath), base), takenPaths());
  const ok = await attempt("Could not save attachment", () => getBackend().createBinary(path, file.base64));
  if (!ok) return null;
  await refreshTree();
  // Use the shortest link that still resolves unambiguously.
  const name = basename(path);
  const target = vaultIndex.resolveTarget(name, notePath) === path ? name : path;
  return isImg ? `![[${target}]]` : `[[${target}]]`;
}

/** "Make a copy": duplicate a note next to the original as "Name 1.md". */
export async function duplicateNote(path: string) {
  const content = documents.get(path)?.content ?? (await getBackend().readText(path).catch(() => null))?.content;
  if (content == null) return null;
  return createNote(dirname(path), noteTitle(uniquePath(path, takenPaths())), content);
}

export async function createFolder(parent: string, name: string) {
  const path = joinPath(parent, name);
  const ok = await attempt("Could not create folder", () => getBackend().createFolder(path));
  if (!ok) return null;
  await refreshTree();
  useWorkspace.getState().toggleFolder(path, true);
  useWorkspace.getState().revealPath(path);
  return path;
}

export async function renamePath(from: string, to: string): Promise<boolean> {
  if (from === to) return true;
  const entries = useVault.getState().entries;
  const isDir = entries.some((e) => e.path === from && e.kind === "dir");
  const taken = entries.some((e) => e.path.toLowerCase() === to.toLowerCase() && e.path.toLowerCase() !== from.toLowerCase());
  if (taken) {
    toast(`"${to}" already exists.`, "error");
    return false;
  }
  // Notes whose links must be rewritten, computed while the index still knows `from`.
  const moved = isDir ? vaultIndex.notePaths().filter((p) => isAncestor(from, p)) : [from];
  const sources = new Map<string, string[]>();
  if (getSettings().updateLinksOnRename) {
    for (const oldPath of moved) {
      for (const b of vaultIndex.backlinks(oldPath)) {
        const list = sources.get(b.source) ?? [];
        if (!list.includes(oldPath)) list.push(oldPath);
        sources.set(b.source, list);
      }
    }
  }
  // Resolve against the pre-rename index before touching anything.
  const planMap = new Map<string, string>();
  const current = (p: string) => planMap.get(p) ?? documents.get(p)?.content ?? vaultIndex.content(p);
  for (const [source, targets] of sources) {
    let content = current(source);
    if (content == null) continue;
    // A moved note linking to another moved note is handled below with its new location.
    const newSource = remapPath(source, from, to);
    for (const oldPath of targets) {
      const newPath = remapPath(oldPath, from, to);
      const next = rewriteLinks(content, newSource, newPath, (l) => vaultIndex.resolveLink(l, source) === oldPath);
      if (next != null) content = next;
    }
    planMap.set(source, content);
  }
  // Relative markdown links inside moved notes must be recomputed from their new folder.
  if (getSettings().updateLinksOnRename && dirname(from) !== dirname(to)) {
    for (const oldPath of moved) {
      let content = current(oldPath);
      const parsed = vaultIndex.get(oldPath);
      if (content == null || !parsed) continue;
      const targets = new Set(
        parsed.links
          .filter((l) => l.kind === "markdown")
          .map((l) => vaultIndex.resolveLink(l, oldPath))
          .filter((t): t is string => !!t && !moved.includes(t)),
      );
      for (const t of targets) {
        const next = rewriteLinks(content, remapPath(oldPath, from, to), t, (l) => l.kind === "markdown" && vaultIndex.resolveLink(l, oldPath) === t);
        if (next != null) content = next;
      }
      if (content !== (documents.get(oldPath)?.content ?? vaultIndex.content(oldPath))) planMap.set(oldPath, content);
    }
  }
  const plans = [...planMap].map(([source, content]) => ({ source, content }));

  for (const p of documents.openPaths()) if (isAncestor(from, p)) await documents.flush(p);
  const ok = await attempt("Could not rename", () => getBackend().rename(from, to));
  if (!ok) return false;

  documents.rename(from, to);
  useWorkspace.getState().renamePath(from, to);
  useBookmarks.getState().remapPath(from, to);
  void fileHistory.storage.rename(vaultKey(), from, to).catch(() => {});
  for (const oldPath of moved) {
    const content = vaultIndex.content(oldPath);
    vaultIndex.remove(oldPath);
    if (content != null) vaultIndex.upsert(remapPath(oldPath, from, to), content);
  }
  await refreshTree();

  let rewritten = 0;
  for (const plan of plans) {
    const source = remapPath(plan.source, from, to);
    if (documents.get(source)) {
      documents.replaceContent(source, plan.content);
      rewritten++;
    } else {
      const done = await attempt(`Could not update links in ${basename(source)}`, async () => {
        const disk = await getBackend().readText(source);
        // Only write if the file is unchanged since we planned the edit.
        if (disk.content !== vaultIndex.content(source)) throw new Error("file changed during rename");
        await getBackend().writeText(source, plan.content, disk.mtime);
      });
      if (done) rewritten++;
    }
    vaultIndex.upsert(source, plan.content);
  }
  if (rewritten) toast(`Updated links in ${rewritten} note${rewritten === 1 ? "" : "s"}.`, "success");
  bumpIndex();
  return true;
}

export async function movePath(path: string, targetFolder: string) {
  if (dirname(path) === targetFolder) return;
  if (isAncestor(path, targetFolder)) {
    toast("Cannot move a folder into itself.", "error");
    return;
  }
  return renamePath(path, joinPath(targetFolder, basename(path)));
}

export async function deletePath(path: string) {
  for (const p of documents.openPaths()) if (isAncestor(path, p)) await documents.flush(p);
  // Keep the final text of deleted notes in local history (in addition to the OS trash).
  for (const p of vaultIndex.notePaths()) {
    const content = isAncestor(path, p) ? vaultIndex.content(p) : undefined;
    if (content != null) await fileHistory.recordDeletion(vaultKey(), p, content).catch(() => {});
  }
  const ok = await attempt("Could not delete", () => getBackend().remove(path));
  if (!ok) return false;
  for (const p of documents.openPaths()) if (isAncestor(path, p)) documents.close(p);
  for (const p of vaultIndex.notePaths()) if (isAncestor(path, p)) vaultIndex.remove(p);
  useWorkspace.getState().removePath(path);
  useBookmarks.getState().removePath(path);
  await refreshTree();
  toast(`Moved "${basename(path)}" to trash.`);
  return true;
}

/** Follow a wikilink: open the target, or create it if it does not exist. */
export async function followLink(target: string, source: string, opts: { newTab?: boolean; heading?: string } = {}) {
  if (!target) {
    if (opts.heading) scrollToHeadingLater(source, opts.heading);
    return;
  }
  const resolved = vaultIndex.resolveTarget(target, source);
  if (resolved) {
    if (isMarkdown(resolved)) {
      useWorkspace.getState().openNote(resolved, { newTab: opts.newTab });
      if (opts.heading) scrollToHeadingLater(resolved, opts.heading);
    } else toast(`"${basename(resolved)}" is an attachment and cannot be opened as a note.`);
    return;
  }
  const path = uniquePath(vaultIndex.newNotePath(target, defaultNoteFolder()), takenPaths());
  const folder = dirname(path);
  if (folder && !useVault.getState().entries.some((e) => e.path === folder)) {
    await attempt("Could not create folder", () => getBackend().createFolder(folder));
  }
  await createNote(folder, noteTitle(path), "", { newTab: opts.newTab });
}

export const pendingHeading: { path: string; heading: string } | { path: null; heading: null } = { path: null, heading: null };
function scrollToHeadingLater(path: string, heading: string) {
  Object.assign(pendingHeading, { path, heading });
  window.dispatchEvent(new CustomEvent("marginalia:goto-heading", { detail: { path, heading } }));
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function todayName(d = new Date()) {
  return formatDate(d, getSettings().dailyNoteFormat);
}

async function dailyNoteContent(title: string) {
  const tpl = getSettings().dailyNoteTemplate;
  if (!tpl) return `# ${title}\n\n`;
  const path = vaultIndex.resolveTarget(tpl, "") ?? (vaultIndex.hasFile(tpl) ? tpl : null);
  if (!path) {
    toast(`Daily note template "${tpl}" not found; created an empty note.`, "error");
    return "";
  }
  try {
    return expandTemplateVars((await getBackend().readText(path)).content, title);
  } catch {
    return "";
  }
}

export async function openDailyNote(date = new Date()) {
  const s = getSettings();
  const name = todayName(date);
  const path = joinPath(s.dailyNoteFolder, `${name}.md`);
  if (vaultIndex.hasFile(path)) {
    useWorkspace.getState().openNote(path);
    return;
  }
  const folder = s.dailyNoteFolder;
  if (folder && !useVault.getState().entries.some((e) => e.path === folder)) {
    await attempt("Could not create daily notes folder", () => getBackend().createFolder(folder));
  }
  await createNote(folder, name, await dailyNoteContent(name));
}

/** Existing daily notes sorted by date (names that parse with the configured format). */
export function dailyNotes(): { path: string; date: Date }[] {
  const s = getSettings();
  return vaultIndex
    .notePaths()
    .filter((p) => dirname(p) === s.dailyNoteFolder)
    .map((p) => ({ path: p, date: parseDate(noteTitle(p), s.dailyNoteFormat) }))
    .filter((x): x is { path: string; date: Date } => !!x.date)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Open the daily note before/after the current one (or today, when none is open). */
export function openAdjacentDailyNote(dir: -1 | 1) {
  const notes = dailyNotes();
  const t = useWorkspace.getState().activeTab();
  const cur = t?.path ? parseDate(noteTitle(t.path), getSettings().dailyNoteFormat) : null;
  const pivot = (cur ?? new Date()).getTime();
  const target = dir < 0 ? [...notes].reverse().find((n) => n.date.getTime() < pivot) : notes.find((n) => n.date.getTime() > pivot);
  if (!target) return toast(dir < 0 ? "There's no daily note before this one." : "There's no daily note after this one.");
  useWorkspace.getState().openNote(target.path);
}

export function templatePaths(): string[] {
  const folder = getSettings().templatesFolder;
  if (!folder) return [];
  return vaultIndex.notePaths().filter((p) => isAncestor(folder, p) && p !== folder);
}

/** Expand `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}`, `{{time:FORMAT}}` in a template. */
export function expandTemplate(template: string, title: string, now = new Date()) {
  return expandTemplateVars(template, title, now);
}

/**
 * Transform a note's content. Open notes are edited in their buffer (autosaved as usual);
 * closed notes are rewritten on disk only if unchanged since they were read.
 */
export async function editNote(path: string, fn: (content: string) => string): Promise<boolean> {
  if (documents.get(path)) {
    const d = documents.get(path)!;
    documents.replaceContent(path, fn(d.content));
    return true;
  }
  return attempt(`Could not update ${basename(path)}`, async () => {
    const disk = await getBackend().readText(path);
    const next = fn(disk.content);
    if (next === disk.content) return;
    await getBackend().writeText(path, next, disk.mtime);
    vaultIndex.upsert(path, next);
    bumpIndex();
  });
}

export async function saveAll() {
  await documents.flushAll();
}

/** Called before the window closes. */
export async function shutdown() {
  await documents.flushAll();
  flushWorkspacePersist();
}
