import type { FileEntry, TextFile, VaultInfo } from "../types";
import { BackendError, type VaultBackend } from "./backend";
import { dirname, isMarkdown } from "../vault/paths";

/**
 * In-memory implementation of `VaultBackend` with the same semantics as the
 * Rust backend (no overwrite on create/rename, mtime conflict detection,
 * path validation). Used by the test-suite, and as a clearly-labelled sandbox
 * when the UI is opened in a plain browser instead of the desktop app.
 */
export class MemoryBackend implements VaultBackend {
  readonly native = false;
  files = new Map<string, { content: string; mtime: number }>();
  dirs = new Set<string>();
  private listeners = new Set<(paths: string[]) => void>();
  private clock = 1_000;
  /** Test hook: make the next N writes fail with this error. */
  failWrites: { kind: BackendError["kind"]; count: number } | null = null;
  vault: VaultInfo = { path: "/memory/Sandbox", name: "Sandbox", lastOpened: 0 };

  constructor(seed: Record<string, string> = {}) {
    for (const [p, c] of Object.entries(seed)) this.seed(p, c);
  }

  private tick() {
    return (this.clock += 10);
  }

  seed(path: string, content: string) {
    this.mkdirs(dirname(path));
    this.files.set(path, { content, mtime: this.tick() });
  }

  /** Simulate a change made by another application. */
  externalWrite(path: string, content: string) {
    this.seed(path, content);
    this.emit([path]);
  }

  externalDelete(path: string) {
    this.files.delete(path);
    this.emit([path]);
  }

  private emit(paths: string[]) {
    for (const l of this.listeners) l(paths);
  }

  private check(path: string) {
    if (!path || path.includes("\0")) throw new BackendError("invalidPath", `Invalid path: ${path}`);
    const parts = path.split("/");
    if (path.startsWith("/") || parts.includes("..")) throw new BackendError("outsideVault", `Path escapes the vault: ${path}`);
  }

  private mkdirs(dir: string) {
    if (!dir) return;
    const parts = dir.split("/");
    for (let i = 1; i <= parts.length; i++) this.dirs.add(parts.slice(0, i).join("/"));
  }

  private exists(path: string) {
    return this.files.has(path) || this.dirs.has(path);
  }

  async pickOpenVault() {
    return this.vault;
  }
  async pickCreateVault(name: string) {
    this.vault = { path: `/memory/${name}`, name, lastOpened: Date.now() };
    return this.vault;
  }
  async openKnownVault() {
    return this.vault;
  }
  async listKnownVaults() {
    return [this.vault];
  }
  async forgetVault() {}
  async closeVault() {}

  async list(): Promise<FileEntry[]> {
    const out: FileEntry[] = [];
    // Like the native backend, hidden entries (e.g. `.marginalia/`) are not listed.
    const hidden = (p: string) => p.split("/").some((part) => part.startsWith("."));
    for (const d of this.dirs) if (!hidden(d)) out.push({ path: d, kind: "dir", size: 0, mtime: 0 });
    for (const [p, f] of this.files) if (!hidden(p)) out.push({ path: p, kind: "file", size: f.content.length, mtime: f.mtime });
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async readText(path: string): Promise<TextFile> {
    this.check(path);
    const f = this.files.get(path);
    if (!f) throw new BackendError("notFound", `Not found: ${path}`);
    return { path, content: f.content, mtime: f.mtime };
  }

  async readAllMarkdown() {
    return [...this.files].filter(([p]) => isMarkdown(p) && !p.split("/").some((x) => x.startsWith("."))).map(([path, f]) => ({ path, content: f.content, mtime: f.mtime }));
  }

  async readBase64(path: string) {
    const bin = this.binaries.get(path);
    if (bin != null) return bin;
    const f = await this.readText(path);
    return btoa(unescape(encodeURIComponent(f.content)));
  }

  async writeText(path: string, content: string, expectedMtime?: number) {
    this.check(path);
    if (this.failWrites && this.failWrites.count > 0) {
      this.failWrites.count--;
      throw new BackendError(this.failWrites.kind, `Simulated ${this.failWrites.kind}: ${path}`);
    }
    const dir = dirname(path);
    if (dir && !this.dirs.has(dir)) throw new BackendError("notFound", `Not found: folder for ${path}`);
    const cur = this.files.get(path);
    if (expectedMtime !== undefined && cur && cur.mtime !== expectedMtime)
      throw new BackendError("conflict", `File changed on disk since it was loaded: ${path}`);
    const mtime = this.tick();
    this.files.set(path, { content, mtime });
    return mtime;
  }

  async createFile(path: string, content: string) {
    this.check(path);
    if (this.exists(path)) throw new BackendError("alreadyExists", `Already exists: ${path}`);
    this.mkdirs(dirname(path));
    const mtime = this.tick();
    this.files.set(path, { content, mtime });
    return mtime;
  }

  binaries = new Map<string, string>();

  async createBinary(path: string, base64: string) {
    this.check(path);
    if (this.exists(path)) throw new BackendError("alreadyExists", `Already exists: ${path}`);
    this.mkdirs(dirname(path));
    this.binaries.set(path, base64);
    // Track it as a file so listings and link resolution see it.
    this.files.set(path, { content: "", mtime: this.tick() });
  }

  async createFolder(path: string) {
    this.check(path);
    if (this.exists(path)) throw new BackendError("alreadyExists", `Already exists: ${path}`);
    this.mkdirs(path);
  }

  async rename(from: string, to: string) {
    this.check(from);
    this.check(to);
    if (!this.exists(from)) throw new BackendError("notFound", `Not found: ${from}`);
    const caseOnly = from.toLowerCase() === to.toLowerCase() && from !== to;
    if (this.exists(to) && !caseOnly) throw new BackendError("alreadyExists", `Already exists: ${to}`);
    if (to.startsWith(from + "/")) throw new BackendError("invalidPath", `cannot move ${from} into itself`);
    this.mkdirs(dirname(to));
    const f = this.files.get(from);
    if (f) {
      this.files.delete(from);
      this.files.set(to, f);
      return;
    }
    for (const d of [...this.dirs]) {
      if (d === from || d.startsWith(from + "/")) {
        this.dirs.delete(d);
        this.dirs.add(to + d.slice(from.length));
      }
    }
    for (const [p, file] of [...this.files]) {
      if (p.startsWith(from + "/")) {
        this.files.delete(p);
        this.files.set(to + p.slice(from.length), file);
      }
    }
  }

  async remove(path: string) {
    this.check(path);
    if (!this.exists(path)) throw new BackendError("notFound", `Not found: ${path}`);
    this.files.delete(path);
    for (const d of [...this.dirs]) if (d === path || d.startsWith(path + "/")) this.dirs.delete(d);
    for (const p of [...this.files.keys()]) if (p.startsWith(path + "/")) this.files.delete(p);
  }

  async onChange(cb: (paths: string[]) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}
