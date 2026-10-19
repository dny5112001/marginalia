import { describe, expect, it } from "vitest";
import { FileHistory, MemorySnapshotStorage } from "./snapshots";

function make() {
  let t = 1_000_000;
  const storage = new MemorySnapshotStorage();
  const h = new FileHistory(storage, { intervalMs: () => 5 * 60_000, keepDays: () => 7, enabled: () => true, now: () => t });
  return { h, storage, advance: (ms: number) => (t += ms) };
}

describe("file history", () => {
  it("keeps at most one snapshot per interval and skips duplicates", async () => {
    const { h, advance } = make();
    await h.recordBeforeSave("v", "a.md", "v1");
    advance(60_000);
    await h.recordBeforeSave("v", "a.md", "v2"); // within interval
    advance(5 * 60_000);
    await h.recordBeforeSave("v", "a.md", "v3");
    advance(10 * 60_000);
    await h.recordBeforeSave("v", "a.md", "v3"); // same as latest
    expect((await h.list("v", "a.md")).map((s) => s.content)).toEqual(["v3", "v1"]);
  });

  it("separates vaults and follows renames", async () => {
    const { h, storage } = make();
    await h.recordBeforeSave("v", "dir/a.md", "x");
    await h.recordBeforeSave("w", "dir/a.md", "y");
    await storage.rename("v", "dir", "moved");
    expect((await h.list("v", "moved/a.md")).map((s) => s.content)).toEqual(["x"]);
    expect((await h.list("w", "dir/a.md")).map((s) => s.content)).toEqual(["y"]);
    expect(await storage.paths("v")).toEqual(["moved/a.md"]);
  });

  it("records deletions and prunes old snapshots", async () => {
    const { h, advance } = make();
    await h.recordDeletion("v", "gone.md", "last words");
    expect((await h.list("v", "gone.md"))[0].content).toBe("last words");
    advance(8 * 86_400_000);
    expect(await h.prune()).toBe(1);
    expect(await h.list("v", "gone.md")).toEqual([]);
  });

  it("does nothing when disabled", async () => {
    const storage = new MemorySnapshotStorage();
    const h = new FileHistory(storage, { intervalMs: () => 0, keepDays: () => 7, enabled: () => false });
    await h.recordBeforeSave("v", "a.md", "x");
    expect(await h.list("v", "a.md")).toEqual([]);
  });
});
