import { toBackendError, type VaultBackend } from "../filesystem/backend";

export type DocStatus = "loading" | "clean" | "dirty" | "saving" | "error" | "conflict";

export interface DocState {
  path: string;
  /** Current buffer. */
  content: string;
  /** Content known to be on disk. */
  saved: string;
  mtime: number | undefined;
  status: DocStatus;
  error?: string;
  /** Disk content when a conflict was detected. */
  diskContent?: string;
  /** Buffer was restored from a crash/failed-save backup. */
  recovered?: boolean;
  deletedOnDisk?: boolean;
  /** Increments when content is replaced from outside the editor (reload, conflict resolution). */
  externalRev: number;
}

interface Internal {
  timer?: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
  inflight?: Promise<void>;
  queued?: boolean;
  retries: number;
}

export interface BackupStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const localBackupStore: BackupStore = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage full or unavailable: nothing more we can do */
    }
  },
  remove: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export interface DocumentManagerOptions {
  backend: () => VaultBackend;
  delayMs: () => number;
  backups?: BackupStore;
  backupPrefix?: () => string;
  onSaved?: (path: string, content: string) => void;
  retryDelaysMs?: number[];
}

/**
 * Owns open note buffers and their persistence. Guarantees:
 * - edits are kept in memory synchronously, so rapid typing never loses input;
 * - writes per document are serialized, and the newest buffer is always saved last;
 * - writes are conditional on the mtime last seen, so external edits produce a
 *   conflict instead of being overwritten;
 * - failed writes keep the buffer dirty, back it up locally, and retry with backoff.
 */
export class DocumentManager {
  private docs = new Map<string, DocState>();
  private internal = new Map<string, Internal>();
  private listeners = new Set<(path: string) => void>();
  private opening = new Map<string, Promise<DocState>>();
  private opts: Required<Omit<DocumentManagerOptions, "onSaved">> & Pick<DocumentManagerOptions, "onSaved">;

  constructor(opts: DocumentManagerOptions) {
    this.opts = {
      backups: localBackupStore,
      backupPrefix: () => "marginalia:backup:",
      retryDelaysMs: [1000, 3000, 10000, 30000],
      ...opts,
    };
  }

  subscribe(fn: (path: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(path: string): DocState | undefined {
    return this.docs.get(path);
  }

  openPaths(): string[] {
    return [...this.docs.keys()];
  }

  isDirty(path: string): boolean {
    const d = this.docs.get(path);
    return !!d && d.content !== d.saved;
  }

  anyDirty(): boolean {
    return [...this.docs.values()].some((d) => d.content !== d.saved);
  }

  private set(path: string, patch: Partial<DocState>) {
    const prev = this.docs.get(path);
    if (!prev) return;
    this.docs.set(path, { ...prev, ...patch });
    for (const l of this.listeners) l(path);
  }

  private int(path: string): Internal {
    let i = this.internal.get(path);
    if (!i) this.internal.set(path, (i = { retries: 0 }));
    return i;
  }

  private backupKey(path: string) {
    return this.opts.backupPrefix() + path;
  }

  async open(path: string): Promise<DocState> {
    const existing = this.docs.get(path);
    const failedLoad = existing?.status === "error" && existing.mtime === undefined;
    if (existing && existing.status !== "loading" && !failedLoad) return existing;
    const pending = this.opening.get(path);
    if (pending) return pending;
    const p = (async () => {
      this.docs.set(path, { path, content: "", saved: "", mtime: undefined, status: "loading", externalRev: 0 });
      try {
        const file = await this.opts.backend().readText(path);
        const backup = this.opts.backups.get(this.backupKey(path));
        const recovered = backup != null && backup !== file.content;
        if (backup != null && !recovered) this.opts.backups.remove(this.backupKey(path));
        this.set(path, {
          content: recovered ? backup! : file.content,
          saved: file.content,
          mtime: file.mtime,
          status: recovered ? "dirty" : "clean",
          recovered,
          externalRev: 1,
        });
      } catch (e) {
        this.set(path, { status: "error", error: toBackendError(e).message });
      }
      return this.docs.get(path)!;
    })();
    this.opening.set(path, p);
    try {
      return await p;
    } finally {
      this.opening.delete(path);
    }
  }

  edit(path: string, content: string) {
    const d = this.docs.get(path);
    if (!d || d.status === "loading") return;
    if (d.content === content) return;
    const dirty = content !== d.saved;
    const status: DocStatus =
      d.status === "conflict" ? "conflict" : d.status === "saving" ? "saving" : dirty ? "dirty" : "clean";
    this.set(path, { content, status, recovered: false });
    if (status !== "conflict") this.schedule(path);
  }

  private schedule(path: string) {
    const i = this.int(path);
    if (i.timer) clearTimeout(i.timer);
    i.timer = setTimeout(() => {
      i.timer = undefined;
      void this.save(path);
    }, this.opts.delayMs());
  }

  /** Save now. With `force`, ignores an mtime conflict (used for "keep my version"). */
  save(path: string, force = false): Promise<void> {
    const d = this.docs.get(path);
    if (!d || d.status === "loading") return Promise.resolve();
    const i = this.int(path);
    if (i.timer) {
      clearTimeout(i.timer);
      i.timer = undefined;
    }
    if (i.inflight) {
      i.queued = true;
      return i.inflight;
    }
    i.inflight = this.runSave(path, force).finally(() => {
      i.inflight = undefined;
    });
    return i.inflight;
  }

  private async runSave(path: string, force: boolean) {
    const i = this.int(path);
    for (;;) {
      i.queued = false;
      const d = this.docs.get(path);
      if (!d) return;
      if (d.status === "conflict" && !force) return;
      if (d.content === d.saved && !force) {
        if (d.status !== "clean") this.set(path, { status: "clean", error: undefined });
        return;
      }
      const snapshot = d.content;
      this.set(path, { status: "saving" });
      try {
        const mtime = await this.opts.backend().writeText(path, snapshot, force ? undefined : d.mtime);
        force = false;
        i.retries = 0;
        if (i.retryTimer) clearTimeout(i.retryTimer);
        this.opts.backups.remove(this.backupKey(path));
        const cur = this.docs.get(path);
        if (!cur) return;
        this.set(path, {
          saved: snapshot,
          mtime,
          error: undefined,
          diskContent: undefined,
          deletedOnDisk: false,
          status: cur.content === snapshot ? "clean" : "dirty",
        });
        this.opts.onSaved?.(path, snapshot);
      } catch (e) {
        const err = toBackendError(e);
        const cur = this.docs.get(path);
        if (!cur) return;
        this.opts.backups.set(this.backupKey(path), cur.content);
        if (err.kind === "conflict") {
          let diskContent: string | undefined;
          try {
            diskContent = (await this.opts.backend().readText(path)).content;
          } catch {
            /* unreadable: still a conflict */
          }
          this.set(path, { status: "conflict", diskContent, error: "The file was changed by another application." });
          return;
        }
        this.set(path, { status: "error", error: err.message });
        this.scheduleRetry(path);
        return;
      }
      const after = this.docs.get(path);
      if (!after || after.content === after.saved) return;
      // Newer edits arrived during the write — loop and save them too.
    }
  }

  private scheduleRetry(path: string) {
    const i = this.int(path);
    const delays = this.opts.retryDelaysMs;
    const delay = delays[Math.min(i.retries, delays.length - 1)];
    i.retries++;
    if (i.retryTimer) clearTimeout(i.retryTimer);
    i.retryTimer = setTimeout(() => void this.save(path), delay);
  }

  /** Wait for any in-flight write of `path` and write pending edits now. */
  async flush(path: string) {
    const d = this.docs.get(path);
    if (!d) return;
    const i = this.int(path);
    if (i.inflight) await i.inflight;
    if (this.isDirty(path) && d.status !== "conflict") await this.save(path);
  }

  async flushAll() {
    await Promise.all(this.openPaths().map((p) => this.flush(p)));
  }

  /** React to a change event from the watcher. */
  async handleExternalChange(path: string) {
    const d = this.docs.get(path);
    if (!d || d.status === "loading") return;
    const i = this.int(path);
    if (i.inflight) await i.inflight;
    let file;
    try {
      file = await this.opts.backend().readText(path);
    } catch (e) {
      if (toBackendError(e).kind === "notFound") this.handleExternalDelete(path);
      return;
    }
    const cur = this.docs.get(path)!;
    if (file.content === cur.saved) {
      // Our own write echoing back, or a touch: just refresh mtime.
      if (file.mtime !== cur.mtime) this.set(path, { mtime: file.mtime, deletedOnDisk: false });
      return;
    }
    if (cur.content === cur.saved) {
      this.set(path, {
        content: file.content,
        saved: file.content,
        mtime: file.mtime,
        status: "clean",
        deletedOnDisk: false,
        externalRev: cur.externalRev + 1,
      });
    } else {
      this.set(path, {
        status: "conflict",
        diskContent: file.content,
        mtime: cur.mtime,
        error: "The file was changed by another application.",
      });
    }
  }

  handleExternalDelete(path: string) {
    if (!this.docs.has(path)) return;
    this.set(path, { deletedOnDisk: true });
  }

  async resolveConflict(path: string, choice: "keepMine" | "useDisk") {
    const d = this.docs.get(path);
    if (!d) return;
    if (choice === "keepMine") {
      this.set(path, { status: "dirty", diskContent: undefined, error: undefined });
      await this.save(path, true);
      return;
    }
    const file = await this.opts.backend().readText(path);
    this.opts.backups.remove(this.backupKey(path));
    this.set(path, {
      content: file.content,
      saved: file.content,
      mtime: file.mtime,
      status: "clean",
      diskContent: undefined,
      error: undefined,
      recovered: false,
      externalRev: d.externalRev + 1,
    });
  }

  /** Discard a recovered backup and return to disk content. */
  async discardRecovered(path: string) {
    await this.resolveConflict(path, "useDisk");
  }

  /** Replace the buffer programmatically (e.g. link rewrite on rename), treating it as an edit. */
  replaceContent(path: string, content: string) {
    const d = this.docs.get(path);
    if (!d) return;
    this.set(path, { externalRev: d.externalRev + 1 });
    this.edit(path, content);
  }

  /** Move buffers after a rename/move on disk. `from` may be a folder. */
  rename(from: string, to: string) {
    for (const p of [...this.docs.keys()]) {
      if (p !== from && !p.startsWith(from + "/")) continue;
      const np = to + p.slice(from.length);
      const d = this.docs.get(p)!;
      this.docs.delete(p);
      this.docs.set(np, { ...d, path: np });
      const i = this.internal.get(p);
      if (i) {
        this.internal.delete(p);
        this.internal.set(np, i);
      }
      const b = this.opts.backups.get(this.backupKey(p));
      if (b != null) {
        this.opts.backups.remove(this.backupKey(p));
        this.opts.backups.set(this.backupKey(np), b);
      }
      for (const l of this.listeners) {
        l(p);
        l(np);
      }
    }
  }

  /** Forget a buffer. Callers flush first; unsaved content is kept as a backup. */
  close(path: string) {
    const d = this.docs.get(path);
    if (!d) return;
    if (d.content !== d.saved) this.opts.backups.set(this.backupKey(path), d.content);
    const i = this.internal.get(path);
    if (i?.timer) clearTimeout(i.timer);
    if (i?.retryTimer) clearTimeout(i.retryTimer);
    this.internal.delete(path);
    this.docs.delete(path);
    for (const l of this.listeners) l(path);
  }

  closeAll() {
    for (const p of this.openPaths()) this.close(p);
  }
}
