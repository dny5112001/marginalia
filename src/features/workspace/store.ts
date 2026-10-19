import { create } from "zustand";
import type { FileSort, LeftView, RightView, Tab, ViewMode, WorkspaceLayout } from "../../types";
import { readJson, writeJson } from "../../settings/storage";
import { dirname, isAncestor, remapPath } from "../../vault/paths";
import { getSettings } from "../../settings/store";

const HISTORY_CAP = 50;
const RECENT_CAP = 30;

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  tabs: [],
  activeTabId: null,
  leftOpen: true,
  rightOpen: true,
  leftWidth: 260,
  rightWidth: 280,
  leftView: "files",
  rightView: "backlinks",
  expandedFolders: [],
  recentFiles: [],
  fileSort: "name-asc",
};

let tabSeq = 0;
const newId = () => `t${Date.now().toString(36)}${(tabSeq++).toString(36)}`;

export function makeTab(path: string | undefined, mode: ViewMode, kind: Tab["kind"] = "note"): Tab {
  return { id: newId(), kind, path, mode, history: path ? [path] : [], historyIndex: path ? 0 : -1 };
}

/** Validate a stored layout against the files that currently exist. */
export function sanitizeLayout(raw: unknown, exists: (p: string) => boolean): WorkspaceLayout {
  const l: WorkspaceLayout = { ...DEFAULT_LAYOUT, tabs: [], expandedFolders: [], recentFiles: [] };
  if (!raw || typeof raw !== "object") return l;
  const r = raw as Partial<WorkspaceLayout>;
  if (typeof r.leftOpen === "boolean") l.leftOpen = r.leftOpen;
  if (typeof r.rightOpen === "boolean") l.rightOpen = r.rightOpen;
  if (typeof r.leftWidth === "number") l.leftWidth = clamp(r.leftWidth, 180, 600);
  if (typeof r.rightWidth === "number") l.rightWidth = clamp(r.rightWidth, 200, 600);
  if (r.leftView && ["files", "search", "tags", "bookmarks"].includes(r.leftView)) l.leftView = r.leftView;
  if (r.fileSort && ["name-asc", "name-desc", "modified-new", "modified-old"].includes(r.fileSort)) l.fileSort = r.fileSort;
  if (r.rightView && ["backlinks", "outline", "properties", "localGraph"].includes(r.rightView)) l.rightView = r.rightView;
  if (Array.isArray(r.expandedFolders)) l.expandedFolders = r.expandedFolders.filter((p) => typeof p === "string");
  if (Array.isArray(r.recentFiles)) l.recentFiles = r.recentFiles.filter((p) => typeof p === "string" && exists(p)).slice(0, RECENT_CAP);
  if (Array.isArray(r.tabs)) {
    for (const t of r.tabs) {
      if (!t || typeof t !== "object") continue;
      const mode: ViewMode = t.mode === "preview" || t.mode === "split" ? t.mode : "edit";
      if (t.kind === "graph" || t.kind === "empty") {
        l.tabs.push({ ...makeTab(undefined, mode, t.kind), id: typeof t.id === "string" ? t.id : newId() });
        continue;
      }
      if (typeof t.path !== "string" || !exists(t.path)) continue;
      const history = Array.isArray(t.history) ? t.history.filter((p) => typeof p === "string" && exists(p)) : [];
      if (!history.includes(t.path)) history.push(t.path);
      l.tabs.push({
        id: typeof t.id === "string" ? t.id : newId(),
        kind: "note",
        path: t.path,
        mode,
        history,
        historyIndex: history.lastIndexOf(t.path),
      });
    }
  }
  l.activeTabId = l.tabs.some((t) => t.id === r.activeTabId) ? r.activeTabId! : (l.tabs[0]?.id ?? null);
  return l;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

interface WorkspaceStore extends WorkspaceLayout {
  vaultKey: string | null;
  /** Recently closed tabs, most recent last (not persisted). */
  closedTabs: Tab[];
  newTab(): void;
  reopenClosedTab(): void;
  closeOtherTabs(id: string): void;
  setFileSort(sort: FileSort): void;
  load(vaultKey: string, exists: (p: string) => boolean): void;
  reset(): void;
  openNote(path: string, opts?: { newTab?: boolean; mode?: ViewMode }): void;
  openGraph(): void;
  closeTab(id: string): void;
  activateTab(id: string): void;
  cycleTab(delta: number): void;
  activateIndex(i: number): void;
  back(): void;
  forward(): void;
  setMode(id: string, mode: ViewMode): void;
  toggleLeft(): void;
  toggleRight(): void;
  setLeftWidth(w: number): void;
  setRightWidth(w: number): void;
  setLeftView(v: LeftView): void;
  setRightView(v: RightView): void;
  toggleFolder(path: string, open?: boolean): void;
  revealPath(path: string): void;
  renamePath(from: string, to: string): void;
  removePath(path: string): void;
  activeTab(): Tab | undefined;
}

const storageKey = (vault: string) => `marginalia:workspace:${vault}`;

export function layoutOf(s: WorkspaceLayout): WorkspaceLayout {
  const { tabs, activeTabId, leftOpen, rightOpen, leftWidth, rightWidth, leftView, rightView, expandedFolders, recentFiles, fileSort } = s;
  return { tabs, activeTabId, leftOpen, rightOpen, leftWidth, rightWidth, leftView, rightView, expandedFolders, recentFiles, fileSort };
}

export const useWorkspace = create<WorkspaceStore>((set, get) => {
  const patchTab = (id: string, fn: (t: Tab) => Tab) => set({ tabs: get().tabs.map((t) => (t.id === id ? fn(t) : t)) });
  const touchRecent = (path: string) => {
    set({ recentFiles: [path, ...get().recentFiles.filter((p) => p !== path)].slice(0, RECENT_CAP) });
  };

  return {
    ...DEFAULT_LAYOUT,
    vaultKey: null,
    closedTabs: [],

    load(vaultKey, exists) {
      set({ ...sanitizeLayout(readJson(storageKey(vaultKey)), exists), vaultKey, closedTabs: [] });
    },
    reset() {
      set({ ...DEFAULT_LAYOUT, vaultKey: null, closedTabs: [] });
    },

    newTab() {
      const s = get();
      const tab = makeTab(undefined, "edit", "empty");
      const idx = s.tabs.findIndex((t) => t.id === s.activeTabId);
      const tabs = [...s.tabs];
      tabs.splice(idx + 1, 0, tab);
      set({ tabs, activeTabId: tab.id });
    },

    reopenClosedTab() {
      const s = get();
      const tab = s.closedTabs[s.closedTabs.length - 1];
      if (!tab) return;
      set({ tabs: [...s.tabs, tab], activeTabId: tab.id, closedTabs: s.closedTabs.slice(0, -1) });
    },

    closeOtherTabs(id) {
      const s = get();
      const closed = s.tabs.filter((t) => t.id !== id && t.kind === "note");
      set({ tabs: s.tabs.filter((t) => t.id === id), activeTabId: id, closedTabs: [...s.closedTabs, ...closed].slice(-20) });
    },

    setFileSort: (fileSort) => set({ fileSort }),

    activeTab() {
      const s = get();
      return s.tabs.find((t) => t.id === s.activeTabId);
    },

    openNote(path, opts = {}) {
      const s = get();
      const mode = opts.mode;
      touchRecent(path);
      get().revealPath(path);
      if (!opts.newTab) {
        const showing = s.tabs.find((t) => t.kind === "note" && t.path === path);
        if (showing) {
          set({ activeTabId: showing.id });
          if (mode) patchTab(showing.id, (t) => ({ ...t, mode }));
          return;
        }
        const active = s.activeTab();
        if (active && (active.kind === "note" || active.kind === "empty")) {
          patchTab(active.id, (t) => {
            const history = [...t.history.slice(0, t.historyIndex + 1), path].slice(-HISTORY_CAP);
            return { ...t, kind: "note", path, history, historyIndex: history.length - 1, mode: mode ?? (t.kind === "empty" ? getSettings().defaultViewMode : t.mode) };
          });
          return;
        }
      }
      const tab = makeTab(path, mode ?? getSettings().defaultViewMode);
      const idx = s.tabs.findIndex((t) => t.id === s.activeTabId);
      const tabs = [...s.tabs];
      tabs.splice(idx + 1, 0, tab);
      set({ tabs, activeTabId: tab.id });
    },

    openGraph() {
      const s = get();
      const existing = s.tabs.find((t) => t.kind === "graph");
      if (existing) return set({ activeTabId: existing.id });
      const tab = makeTab(undefined, "edit", "graph");
      set({ tabs: [...s.tabs, tab], activeTabId: tab.id });
    },

    closeTab(id) {
      const s = get();
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const closing = s.tabs[idx];
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeTabId = s.activeTabId === id ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : s.activeTabId;
      const closedTabs = closing.kind === "note" ? [...s.closedTabs, closing].slice(-20) : s.closedTabs;
      set({ tabs, activeTabId, closedTabs });
    },

    activateTab(id) {
      const t = get().tabs.find((x) => x.id === id);
      if (!t) return;
      set({ activeTabId: id });
      if (t.path) touchRecent(t.path);
    },

    cycleTab(delta) {
      const s = get();
      if (!s.tabs.length) return;
      const idx = s.tabs.findIndex((t) => t.id === s.activeTabId);
      const next = (idx + delta + s.tabs.length) % s.tabs.length;
      get().activateTab(s.tabs[next].id);
    },

    activateIndex(i) {
      const tabs = get().tabs;
      const t = i === 8 ? tabs[tabs.length - 1] : tabs[i];
      if (t) get().activateTab(t.id);
    },

    back() {
      const t = get().activeTab();
      if (!t || t.historyIndex <= 0) return;
      const path = t.history[t.historyIndex - 1];
      patchTab(t.id, (x) => ({ ...x, path, historyIndex: x.historyIndex - 1 }));
      touchRecent(path);
    },

    forward() {
      const t = get().activeTab();
      if (!t || t.historyIndex >= t.history.length - 1) return;
      const path = t.history[t.historyIndex + 1];
      patchTab(t.id, (x) => ({ ...x, path, historyIndex: x.historyIndex + 1 }));
      touchRecent(path);
    },

    setMode(id, mode) {
      patchTab(id, (t) => ({ ...t, mode }));
    },

    toggleLeft: () => set({ leftOpen: !get().leftOpen }),
    toggleRight: () => set({ rightOpen: !get().rightOpen }),
    setLeftWidth: (w) => set({ leftWidth: clamp(w, 180, 600) }),
    setRightWidth: (w) => set({ rightWidth: clamp(w, 200, 600) }),
    setLeftView: (v) => set({ leftView: v, leftOpen: true }),
    setRightView: (v) => set({ rightView: v, rightOpen: true }),

    toggleFolder(path, open) {
      const cur = new Set(get().expandedFolders);
      const shouldOpen = open ?? !cur.has(path);
      if (shouldOpen) cur.add(path);
      else cur.delete(path);
      set({ expandedFolders: [...cur] });
    },

    revealPath(path) {
      const cur = new Set(get().expandedFolders);
      let d = dirname(path);
      let changed = false;
      while (d) {
        if (!cur.has(d)) {
          cur.add(d);
          changed = true;
        }
        d = dirname(d);
      }
      if (changed) set({ expandedFolders: [...cur] });
    },

    renamePath(from, to) {
      const s = get();
      const remap = (p: string) => remapPath(p, from, to);
      set({
        tabs: s.tabs.map((t) => ({ ...t, path: t.path && remap(t.path), history: t.history.map(remap) })),
        closedTabs: s.closedTabs.map((t) => ({ ...t, path: t.path && remap(t.path), history: t.history.map(remap) })),
        recentFiles: s.recentFiles.map(remap),
        expandedFolders: s.expandedFolders.map(remap),
      });
    },

    removePath(path) {
      const s = get();
      const gone = (p?: string) => !!p && isAncestor(path, p);
      for (const t of s.tabs) if (t.kind === "note" && gone(t.path)) {
        const history = t.history.filter((p) => !gone(p));
        if (history.length) {
          const path2 = history[Math.min(t.historyIndex, history.length - 1)];
          patchTab(t.id, (x) => ({ ...x, history, path: path2, historyIndex: history.indexOf(path2) }));
        } else get().closeTab(t.id);
      } else if (t.history.some(gone)) {
        patchTab(t.id, (x) => {
          const history = x.history.filter((p) => !gone(p));
          return { ...x, history, historyIndex: Math.max(0, history.indexOf(x.path!)) };
        });
      }
      set({
        closedTabs: get().closedTabs.filter((t) => !gone(t.path)),
        recentFiles: get().recentFiles.filter((p) => !gone(p)),
        expandedFolders: get().expandedFolders.filter((p) => !gone(p)),
      });
    },
  };
});

// Persist layout per vault (debounced).
let persistTimer: ReturnType<typeof setTimeout> | undefined;
useWorkspace.subscribe((s) => {
  if (!s.vaultKey) return;
  const key = storageKey(s.vaultKey);
  const layout = layoutOf(s);
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => writeJson(key, layout), 200);
});

export function flushWorkspacePersist() {
  const s = useWorkspace.getState();
  clearTimeout(persistTimer);
  if (s.vaultKey) writeJson(storageKey(s.vaultKey), layoutOf(s));
}
