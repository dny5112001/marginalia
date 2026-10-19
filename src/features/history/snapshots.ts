/**
 * Local file history: snapshots of note content kept outside the vault (in the
 * webview's IndexedDB), so accidental edits or deletions can be undone even
 * after the app restarts. Snapshots never sync and never touch vault files.
 */

export interface Snapshot {
  id?: number;
  vault: string;
  path: string;
  time: number;
  content: string;
}

export interface SnapshotStorage {
  add(s: Snapshot): Promise<void>;
  /** Newest first. */
  list(vault: string, path: string): Promise<Snapshot[]>;
  update(s: Snapshot): Promise<void>;
  deleteOlderThan(time: number): Promise<number>;
  rename(vault: string, from: string, to: string): Promise<void>;
  clear(vault: string): Promise<void>;
  paths(vault: string): Promise<string[]>;
}

export class MemorySnapshotStorage implements SnapshotStorage {
  private rows: Snapshot[] = [];
  private seq = 0;
  async add(s: Snapshot) {
    this.rows.push({ ...s, id: ++this.seq });
  }
  async list(vault: string, path: string) {
    return this.rows.filter((r) => r.vault === vault && r.path === path).sort((a, b) => b.time - a.time);
  }
  async update(s: Snapshot) {
    const i = this.rows.findIndex((r) => r.id === s.id);
    if (i !== -1) this.rows[i] = { ...s };
  }
  async deleteOlderThan(time: number) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.time >= time);
    return before - this.rows.length;
  }
  async rename(vault: string, from: string, to: string) {
    for (const r of this.rows) if (r.vault === vault && (r.path === from || r.path.startsWith(from + "/"))) r.path = to + r.path.slice(from.length);
  }
  async clear(vault: string) {
    this.rows = this.rows.filter((r) => r.vault !== vault);
  }
  async paths(vault: string) {
    return [...new Set(this.rows.filter((r) => r.vault === vault).map((r) => r.path))].sort();
  }
}

const DB = "marginalia-history";
const STORE = "snapshots";

export class IndexedDbSnapshotStorage implements SnapshotStorage {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.db)
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          store.createIndex("vaultPath", ["vault", "path"]);
          store.createIndex("vault", "vault");
          store.createIndex("time", "time");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? (req as IDBRequest<T>).result : undefined);
      t.onerror = () => reject(t.error);
    });
  }

  async add(s: Snapshot) {
    const { id: _ignored, ...row } = s;
    void _ignored;
    await this.tx("readwrite", (st) => st.add(row));
  }
  async list(vault: string, path: string) {
    const rows = (await this.tx<Snapshot[]>("readonly", (st) => st.index("vaultPath").getAll([vault, path]))) ?? [];
    return rows.sort((a, b) => b.time - a.time);
  }
  async update(s: Snapshot) {
    await this.tx("readwrite", (st) => st.put(s));
  }
  async deleteOlderThan(time: number) {
    let n = 0;
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, "readwrite");
      const req = t.objectStore(STORE).index("time").openCursor(IDBKeyRange.upperBound(time, true));
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        c.delete();
        n++;
        c.continue();
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
    return n;
  }
  async rename(vault: string, from: string, to: string) {
    const rows = (await this.tx<Snapshot[]>("readonly", (st) => st.index("vault").getAll(vault))) ?? [];
    const moved = rows.filter((r) => r.path === from || r.path.startsWith(from + "/"));
    for (const r of moved) await this.update({ ...r, path: to + r.path.slice(from.length) });
  }
  async clear(vault: string) {
    const rows = (await this.tx<Snapshot[]>("readonly", (st) => st.index("vault").getAll(vault))) ?? [];
    for (const r of rows) await this.tx("readwrite", (st) => st.delete(r.id!));
  }
  async paths(vault: string) {
    const rows = (await this.tx<Snapshot[]>("readonly", (st) => st.index("vault").getAll(vault))) ?? [];
    return [...new Set(rows.map((r) => r.path))].sort();
  }
}

export interface HistoryOptions {
  intervalMs: () => number;
  keepDays: () => number;
  enabled: () => boolean;
  now?: () => number;
}

export class FileHistory {
  constructor(
    readonly storage: SnapshotStorage,
    private opts: HistoryOptions,
  ) {}

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  /**
   * Called before content on disk is replaced: keeps `previous` as a restore point,
   * at most one per interval per file (newer pre-save states within the interval are
   * not needed because the oldest state in the window is the one worth restoring).
   */
  async recordBeforeSave(vault: string, path: string, previous: string) {
    if (!this.opts.enabled()) return;
    const [latest] = await this.storage.list(vault, path);
    const now = this.now();
    if (latest && (latest.content === previous || now - latest.time < this.opts.intervalMs())) return;
    await this.storage.add({ vault, path, time: now, content: previous });
  }

  /** Keep the final content of a note that is being deleted. */
  async recordDeletion(vault: string, path: string, content: string) {
    if (!this.opts.enabled()) return;
    const [latest] = await this.storage.list(vault, path);
    if (latest?.content === content) return;
    await this.storage.add({ vault, path, time: this.now(), content });
  }

  list(vault: string, path: string) {
    return this.storage.list(vault, path);
  }

  prune() {
    return this.storage.deleteOlderThan(this.now() - this.opts.keepDays() * 86_400_000);
  }
}
