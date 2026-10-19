import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentManager, type BackupStore } from "./documents";
import { MemoryBackend } from "../filesystem/memoryBackend";

function memStore(): BackupStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
}

let backend: MemoryBackend;
let backups: ReturnType<typeof memStore>;
let mgr: DocumentManager;
const make = () => new DocumentManager({ backend: () => backend, delayMs: () => 500, backups, backupPrefix: () => "b:", retryDelaysMs: [1000, 2000] });

beforeEach(() => {
  vi.useFakeTimers();
  backend = new MemoryBackend({ "a.md": "hello", "dir/b.md": "bee" });
  backups = memStore();
  mgr = make();
});
afterEach(() => vi.useRealTimers());

describe("DocumentManager", () => {
  it("opens, edits and autosaves after the debounce", async () => {
    await mgr.open("a.md");
    mgr.edit("a.md", "hello world");
    expect(mgr.get("a.md")!.status).toBe("dirty");
    await vi.advanceTimersByTimeAsync(499);
    expect(backend.files.get("a.md")!.content).toBe("hello");
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.files.get("a.md")!.content).toBe("hello world");
    expect(mgr.get("a.md")!.status).toBe("clean");
  });

  it("debounces rapid edits into one write with the latest content", async () => {
    await mgr.open("a.md");
    const spy = vi.spyOn(backend, "writeText");
    for (let i = 0; i < 20; i++) {
      mgr.edit("a.md", "x".repeat(i + 1));
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(500);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(backend.files.get("a.md")!.content).toBe("x".repeat(20));
  });

  it("never loses edits made while a write is in flight", async () => {
    await mgr.open("a.md");
    let release!: () => void;
    const orig = backend.writeText.bind(backend);
    vi.spyOn(backend, "writeText").mockImplementationOnce(async (p, c, m) => {
      await new Promise<void>((r) => (release = r));
      return orig(p, c, m);
    });
    mgr.edit("a.md", "first");
    const saving = mgr.save("a.md");
    mgr.edit("a.md", "second");
    void mgr.save("a.md");
    release();
    await saving;
    await vi.runOnlyPendingTimersAsync();
    expect(backend.files.get("a.md")!.content).toBe("second");
    expect(mgr.get("a.md")!.status).toBe("clean");
  });

  it("explicit save writes immediately", async () => {
    await mgr.open("a.md");
    mgr.edit("a.md", "now");
    await mgr.save("a.md");
    expect(backend.files.get("a.md")!.content).toBe("now");
  });

  it("detects a conflicting external change instead of overwriting", async () => {
    await mgr.open("a.md");
    backend.seed("a.md", "changed elsewhere");
    mgr.edit("a.md", "mine");
    await mgr.save("a.md");
    const d = mgr.get("a.md")!;
    expect(d.status).toBe("conflict");
    expect(d.diskContent).toBe("changed elsewhere");
    expect(backend.files.get("a.md")!.content).toBe("changed elsewhere");
    // Autosave stays paused during a conflict.
    mgr.edit("a.md", "mine 2");
    await vi.advanceTimersByTimeAsync(2000);
    expect(backend.files.get("a.md")!.content).toBe("changed elsewhere");

    await mgr.resolveConflict("a.md", "keepMine");
    expect(backend.files.get("a.md")!.content).toBe("mine 2");
    expect(mgr.get("a.md")!.status).toBe("clean");
  });

  it("can resolve a conflict by loading the disk version", async () => {
    await mgr.open("a.md");
    backend.seed("a.md", "theirs");
    mgr.edit("a.md", "mine");
    await mgr.save("a.md");
    await mgr.resolveConflict("a.md", "useDisk");
    expect(mgr.get("a.md")!.content).toBe("theirs");
    expect(mgr.get("a.md")!.externalRev).toBeGreaterThan(1);
  });

  it("reloads a clean buffer on external change and flags a dirty one", async () => {
    await mgr.open("a.md");
    backend.externalWrite("a.md", "external");
    await mgr.handleExternalChange("a.md");
    expect(mgr.get("a.md")!.content).toBe("external");
    expect(mgr.get("a.md")!.status).toBe("clean");

    mgr.edit("a.md", "local edit");
    backend.externalWrite("a.md", "external 2");
    await mgr.handleExternalChange("a.md");
    expect(mgr.get("a.md")!.status).toBe("conflict");
    expect(mgr.get("a.md")!.content).toBe("local edit");
  });

  it("ignores the echo of its own write", async () => {
    await mgr.open("a.md");
    mgr.edit("a.md", "saved");
    await mgr.save("a.md");
    const rev = mgr.get("a.md")!.externalRev;
    await mgr.handleExternalChange("a.md");
    expect(mgr.get("a.md")!.status).toBe("clean");
    expect(mgr.get("a.md")!.externalRev).toBe(rev);
  });

  it("keeps edits, backs them up and retries after a failed write", async () => {
    await mgr.open("a.md");
    backend.failWrites = { kind: "permissionDenied", count: 2 };
    mgr.edit("a.md", "important");
    await mgr.save("a.md");
    expect(mgr.get("a.md")!.status).toBe("error");
    expect(mgr.get("a.md")!.content).toBe("important");
    expect(backups.data.get("b:a.md")).toBe("important");
    await vi.advanceTimersByTimeAsync(1000); // retry 1 fails
    expect(mgr.get("a.md")!.status).toBe("error");
    await vi.advanceTimersByTimeAsync(2000); // retry 2 succeeds
    expect(backend.files.get("a.md")!.content).toBe("important");
    expect(mgr.get("a.md")!.status).toBe("clean");
    expect(backups.data.has("b:a.md")).toBe(false);
  });

  it("recovers a backup after a restart (interrupted write)", async () => {
    await mgr.open("a.md");
    backend.failWrites = { kind: "io", count: 99 };
    mgr.edit("a.md", "unsaved work");
    await mgr.save("a.md");
    // Simulate the app quitting: a fresh manager on the same disk + backups.
    backend.failWrites = null;
    const fresh = make();
    const d = await fresh.open("a.md");
    expect(d.recovered).toBe(true);
    expect(d.content).toBe("unsaved work");
    expect(d.saved).toBe("hello");
    await fresh.discardRecovered("a.md");
    expect(fresh.get("a.md")!.content).toBe("hello");
    expect(backups.data.has("b:a.md")).toBe(false);
  });

  it("flushAll writes every dirty document", async () => {
    await mgr.open("a.md");
    await mgr.open("dir/b.md");
    mgr.edit("a.md", "A!");
    mgr.edit("dir/b.md", "B!");
    await mgr.flushAll();
    expect(backend.files.get("a.md")!.content).toBe("A!");
    expect(backend.files.get("dir/b.md")!.content).toBe("B!");
    expect(mgr.anyDirty()).toBe(false);
  });

  it("moves buffers on folder rename", async () => {
    await mgr.open("dir/b.md");
    mgr.edit("dir/b.md", "edited");
    await mgr.flush("dir/b.md");
    await backend.rename("dir", "moved");
    mgr.rename("dir", "moved");
    expect(mgr.get("dir/b.md")).toBeUndefined();
    expect(mgr.get("moved/b.md")!.content).toBe("edited");
    mgr.edit("moved/b.md", "after move");
    await mgr.save("moved/b.md");
    expect(backend.files.get("moved/b.md")!.content).toBe("after move");
    expect(backend.files.has("dir/b.md")).toBe(false);
  });

  it("reports a missing file on open", async () => {
    const d = await mgr.open("missing.md");
    expect(d.status).toBe("error");
  });

  it("marks a buffer when its file is deleted externally", async () => {
    await mgr.open("a.md");
    backend.externalDelete("a.md");
    await mgr.handleExternalChange("a.md");
    expect(mgr.get("a.md")!.deletedOnDisk).toBe(true);
  });
});
