import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushWorkspacePersist, sanitizeLayout, useWorkspace } from "./store";

const exists = (p: string) => ["a.md", "b.md", "c.md", "f/d.md"].includes(p);

beforeEach(() => {
  localStorage.clear();
  useWorkspace.getState().reset();
  useWorkspace.getState().load("vault1", exists);
});

describe("workspace", () => {
  it("navigates within a tab with back/forward history", () => {
    const ws = useWorkspace.getState();
    ws.openNote("a.md");
    ws.openNote("b.md");
    ws.openNote("c.md");
    expect(useWorkspace.getState().tabs).toHaveLength(1);
    ws.back();
    expect(useWorkspace.getState().activeTab()!.path).toBe("b.md");
    ws.back();
    ws.back();
    expect(useWorkspace.getState().activeTab()!.path).toBe("a.md");
    ws.forward();
    expect(useWorkspace.getState().activeTab()!.path).toBe("b.md");
    ws.openNote("f/d.md");
    ws.forward();
    expect(useWorkspace.getState().activeTab()!.path).toBe("f/d.md");
    expect(useWorkspace.getState().expandedFolders).toContain("f");
    expect(useWorkspace.getState().recentFiles.slice(0, 2)).toEqual(["f/d.md", "b.md"]);
  });

  it("opens new tabs, switches and closes them", () => {
    const ws = useWorkspace.getState();
    ws.openNote("a.md");
    ws.openNote("b.md", { newTab: true });
    ws.openNote("c.md", { newTab: true });
    expect(useWorkspace.getState().tabs.map((t) => t.path)).toEqual(["a.md", "b.md", "c.md"]);
    ws.cycleTab(1);
    expect(useWorkspace.getState().activeTab()!.path).toBe("a.md");
    ws.activateIndex(8);
    expect(useWorkspace.getState().activeTab()!.path).toBe("c.md");
    ws.closeTab(useWorkspace.getState().activeTabId!);
    expect(useWorkspace.getState().activeTab()!.path).toBe("b.md");
    // Opening a note already shown in a tab focuses that tab.
    ws.openNote("a.md");
    expect(useWorkspace.getState().tabs).toHaveLength(2);
    expect(useWorkspace.getState().activeTab()!.path).toBe("a.md");
  });

  it("remaps paths on rename and prunes them on delete", () => {
    const ws = useWorkspace.getState();
    ws.openNote("f/d.md");
    ws.renamePath("f", "g");
    expect(useWorkspace.getState().activeTab()!.path).toBe("g/d.md");
    expect(useWorkspace.getState().expandedFolders).toContain("g");
    ws.openNote("a.md");
    ws.removePath("a.md");
    expect(useWorkspace.getState().activeTab()!.path).toBe("g/d.md");
    ws.removePath("g");
    expect(useWorkspace.getState().tabs).toHaveLength(0);
  });

  it("persists the layout per vault and restores it, dropping missing files", () => {
    vi.useFakeTimers();
    const ws = useWorkspace.getState();
    ws.openNote("a.md");
    ws.openNote("b.md", { newTab: true });
    ws.setLeftWidth(333);
    ws.toggleRight();
    ws.setLeftView("tags");
    flushWorkspacePersist();
    vi.useRealTimers();

    useWorkspace.getState().reset();
    useWorkspace.getState().load("vault1", (p) => p === "b.md");
    const s = useWorkspace.getState();
    expect(s.tabs.map((t) => t.path)).toEqual(["b.md"]);
    expect(s.leftWidth).toBe(333);
    expect(s.rightOpen).toBe(false);
    expect(s.leftView).toBe("tags");

    useWorkspace.getState().load("other-vault", exists);
    expect(useWorkspace.getState().tabs).toHaveLength(0);
  });

  it("sanitizes corrupt stored layouts", () => {
    expect(sanitizeLayout("garbage", exists).tabs).toEqual([]);
    const l = sanitizeLayout({ tabs: [{ path: 5 }, { kind: "note", path: "a.md", mode: "weird" }], leftWidth: 99999, leftView: "nope" }, exists);
    expect(l.tabs).toHaveLength(1);
    expect(l.tabs[0].mode).toBe("edit");
    expect(l.leftWidth).toBe(600);
    expect(l.leftView).toBe("files");
  });
});
