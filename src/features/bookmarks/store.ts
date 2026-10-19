import { create } from "zustand";
import { getBackend, toBackendError } from "../../filesystem";
import { isAncestor, remapPath } from "../../vault/paths";
import { toast } from "../ui/store";

export type Bookmark =
  | { type: "file"; path: string; title?: string }
  | { type: "heading"; path: string; heading: string; title?: string }
  | { type: "search"; query: string; title?: string };

/** Stored inside the vault so bookmarks travel with the notes. Hidden from the file tree. */
export const BOOKMARKS_PATH = ".marginalia/bookmarks.json";

export function sanitizeBookmarks(raw: unknown): Bookmark[] {
  const items = raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const out: Bookmark[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const b = it as Record<string, unknown>;
    const title = typeof b.title === "string" ? b.title : undefined;
    if (b.type === "file" && typeof b.path === "string") out.push({ type: "file", path: b.path, title });
    else if (b.type === "heading" && typeof b.path === "string" && typeof b.heading === "string") out.push({ type: "heading", path: b.path, heading: b.heading, title });
    else if (b.type === "search" && typeof b.query === "string") out.push({ type: "search", query: b.query, title });
  }
  return out;
}

export const sameBookmark = (a: Bookmark, b: Bookmark) => JSON.stringify({ ...a, title: undefined }) === JSON.stringify({ ...b, title: undefined });

interface BookmarkStore {
  items: Bookmark[];
  loaded: boolean;
  error: string | null;
  load(): Promise<void>;
  reset(): void;
  toggle(b: Bookmark): Promise<void>;
  remove(b: Bookmark): Promise<void>;
  move(from: number, to: number): Promise<void>;
  rename(b: Bookmark, title: string): Promise<void>;
  remapPath(from: string, to: string): void;
  removePath(path: string): void;
  has(b: Bookmark): boolean;
}

let writeChain: Promise<unknown> = Promise.resolve();

async function persist(items: Bookmark[]) {
  const backend = getBackend();
  const body = JSON.stringify({ version: 1, items }, null, 2) + "\n";
  // Serialize writes so rapid toggles land in order.
  writeChain = writeChain.then(async () => {
    try {
      await backend.writeText(BOOKMARKS_PATH, body);
    } catch (e) {
      const err = toBackendError(e);
      if (err.kind !== "notFound") throw err;
      await backend.createFolder(".marginalia").catch(() => {});
      await backend.writeText(BOOKMARKS_PATH, body);
    }
  });
  try {
    await writeChain;
  } catch (e) {
    toast(`Could not save bookmarks: ${toBackendError(e).message}`, "error");
    writeChain = Promise.resolve();
  }
}

export const useBookmarks = create<BookmarkStore>((set, get) => {
  const commit = async (items: Bookmark[]) => {
    set({ items });
    await persist(items);
  };
  return {
    items: [],
    loaded: false,
    error: null,
    async load() {
      try {
        const file = await getBackend().readText(BOOKMARKS_PATH);
        set({ items: sanitizeBookmarks(JSON.parse(file.content)), loaded: true, error: null });
      } catch (e) {
        const err = e instanceof SyntaxError ? null : toBackendError(e);
        if (err?.kind === "notFound") set({ items: [], loaded: true, error: null });
        // A corrupt file is left untouched on disk; we start empty but do not overwrite it until the user acts.
        else set({ items: [], loaded: true, error: "The bookmarks file could not be read." });
      }
    },
    reset: () => set({ items: [], loaded: false, error: null }),
    has: (b) => get().items.some((x) => sameBookmark(x, b)),
    async toggle(b) {
      const items = get().items;
      await commit(items.some((x) => sameBookmark(x, b)) ? items.filter((x) => !sameBookmark(x, b)) : [...items, b]);
    },
    async remove(b) {
      await commit(get().items.filter((x) => !sameBookmark(x, b)));
    },
    async move(from, to) {
      const items = [...get().items];
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it);
      await commit(items);
    },
    async rename(b, title) {
      await commit(get().items.map((x) => (sameBookmark(x, b) ? { ...x, title: title.trim() || undefined } : x)));
    },
    remapPath(from, to) {
      let changed = false;
      const items = get().items.map((b) => {
        if (b.type === "search" || !isAncestor(from, b.path)) return b;
        changed = true;
        return { ...b, path: remapPath(b.path, from, to) };
      });
      if (changed) void commit(items);
    },
    removePath(path) {
      const items = get().items.filter((b) => b.type === "search" || !isAncestor(path, b.path));
      if (items.length !== get().items.length) void commit(items);
    },
  };
});
