import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBackend } from "../filesystem/memoryBackend";
import { setBackend } from "../filesystem";
import {
  createFolder,
  createNote,
  deletePath,
  documents,
  followLink,
  handleExternalChanges,
  movePath,
  openKnownVault,
  renamePath,
  useVault,
  vaultIndex,
  expandTemplate,
  closeVault,
} from "./store";
import { useWorkspace } from "../features/workspace/store";
import { useSettings } from "../settings/store";

let backend: MemoryBackend;

async function openVault(seed: Record<string, string>) {
  backend = new MemoryBackend(seed);
  setBackend(backend);
  await openKnownVault("/memory/Sandbox");
}

beforeEach(async () => {
  await closeVault();
  localStorage.clear();
  useSettings.getState().reset();
  await openVault({
    "Home.md": "Welcome. See [[Ideas]] and [[Projects/Plan|the plan]].",
    "Ideas.md": "# Ideas\nBack [[Home]]",
    "Projects/Plan.md": "Plan with [x](../Ideas.md)",
  });
});

describe("vault flows", () => {
  it("indexes the vault on open", () => {
    expect(useVault.getState().status).toBe("ready");
    expect(vaultIndex.notePaths()).toEqual(["Home.md", "Ideas.md", "Projects/Plan.md"]);
    expect(vaultIndex.backlinks("Ideas.md").map((b) => b.source).sort()).toEqual(["Home.md", "Projects/Plan.md"]);
  });

  it("creates, edits, saves and reopens a note", async () => {
    const path = await createNote("", "Fresh");
    expect(path).toBe("Fresh.md");
    expect(backend.files.has("Fresh.md")).toBe(true);
    await documents.open(path!);
    documents.edit(path!, "Linking [[Home]]");
    await documents.save(path!);
    expect(backend.files.get("Fresh.md")!.content).toBe("Linking [[Home]]");
    // "Restart": close and reopen the vault, then read it back from disk.
    await closeVault();
    await openKnownVault("/memory/Sandbox");
    const d = await documents.open("Fresh.md");
    expect(d.content).toBe("Linking [[Home]]");
    expect(vaultIndex.backlinks("Home.md").map((b) => b.source).sort()).toEqual(["Fresh.md", "Ideas.md"]);
  });

  it("does not overwrite on name conflicts when creating notes", async () => {
    const a = await createNote("", "Ideas");
    expect(a).toBe("Ideas 1.md");
    expect(backend.files.get("Ideas.md")!.content).toContain("# Ideas");
  });

  it("renames a note and rewrites links in other notes", async () => {
    await renamePath("Ideas.md", "Concepts.md");
    expect(backend.files.has("Ideas.md")).toBe(false);
    expect(backend.files.get("Home.md")!.content).toBe("Welcome. See [[Concepts]] and [[Projects/Plan|the plan]].");
    expect(backend.files.get("Projects/Plan.md")!.content).toBe("Plan with [x](../Concepts.md)");
    expect(vaultIndex.backlinks("Concepts.md")).toHaveLength(2);
  });

  it("rewrites links inside open, unsaved buffers without losing edits", async () => {
    await documents.open("Home.md");
    documents.edit("Home.md", "Edited. [[Ideas]]");
    await renamePath("Ideas.md", "Thoughts.md");
    expect(documents.get("Home.md")!.content).toBe("Edited. [[Thoughts]]");
    await documents.flush("Home.md");
    expect(backend.files.get("Home.md")!.content).toBe("Edited. [[Thoughts]]");
  });

  it("refuses to rename onto an existing file", async () => {
    expect(await renamePath("Ideas.md", "Home.md")).toBe(false);
    expect(backend.files.get("Home.md")!.content).toContain("Welcome");
    expect(backend.files.has("Ideas.md")).toBe(true);
  });

  it("moves notes and folders, updating tabs and path links", async () => {
    useWorkspace.getState().openNote("Projects/Plan.md");
    await createFolder("", "Archive");
    await movePath("Projects", "Archive");
    expect(backend.files.has("Archive/Projects/Plan.md")).toBe(true);
    expect(useWorkspace.getState().activeTab()!.path).toBe("Archive/Projects/Plan.md");
    expect(backend.files.get("Home.md")!.content).toContain("[[Archive/Projects/Plan|the plan]]");
    // Relative links inside the moved note are recomputed from its new folder.
    expect(backend.files.get("Archive/Projects/Plan.md")!.content).toBe("Plan with [x](../../Ideas.md)");
    expect(vaultIndex.backlinks("Ideas.md").map((b) => b.source).sort()).toEqual(["Archive/Projects/Plan.md", "Home.md"]);
  });

  it("deletes notes, closing their tabs", async () => {
    useWorkspace.getState().openNote("Ideas.md");
    await deletePath("Ideas.md");
    expect(backend.files.has("Ideas.md")).toBe(false);
    expect(useWorkspace.getState().tabs).toHaveLength(0);
    expect(vaultIndex.unresolvedLinks("Home.md")).toEqual(["Ideas"]);
  });

  it("creates a note when following an unresolved link", async () => {
    await followLink("Brand New", "Home.md");
    expect(backend.files.has("Brand New.md")).toBe(true);
    expect(useWorkspace.getState().activeTab()!.path).toBe("Brand New.md");
    await followLink("Ideas", "Home.md");
    expect(useWorkspace.getState().activeTab()!.path).toBe("Ideas.md");
  });

  it("creates nested notes for folder-qualified links", async () => {
    await followLink("Inbox/Later", "Home.md");
    expect(backend.files.has("Inbox/Later.md")).toBe(true);
  });

  it("applies external changes from the watcher", async () => {
    await documents.open("Ideas.md");
    backend.externalWrite("Ideas.md", "# Ideas\nNow links [[Projects/Plan]]");
    backend.externalWrite("New.md", "From another app [[Home]]");
    await handleExternalChanges(["Ideas.md", "New.md"]);
    expect(documents.get("Ideas.md")!.content).toContain("Now links");
    expect(vaultIndex.notePaths()).toContain("New.md");
    expect(vaultIndex.backlinks("Home.md").map((b) => b.source)).toContain("New.md");
    expect(useVault.getState().entries.some((e) => e.path === "New.md")).toBe(true);

    backend.externalDelete("Ideas.md");
    await handleExternalChanges(["Ideas.md"]);
    expect(documents.get("Ideas.md")).toBeUndefined();
    expect(vaultIndex.notePaths()).not.toContain("Ideas.md");
  });

  it("reports filesystem errors without crashing", async () => {
    backend.failWrites = { kind: "permissionDenied", count: 1 };
    await documents.open("Ideas.md");
    documents.edit("Ideas.md", "x");
    await documents.save("Ideas.md");
    expect(documents.get("Ideas.md")!.status).toBe("error");
    expect(documents.get("Ideas.md")!.error).toMatch(/permissionDenied/);
  });

  it("works with an empty vault", async () => {
    await closeVault();
    await openVault({});
    expect(vaultIndex.notePaths()).toEqual([]);
    expect(await createNote()).toBe("Untitled.md");
  });

  it("expands templates", () => {
    const out = expandTemplate("# {{title}} — {{date}} {{time}}", "Note", new Date(2024, 0, 5, 9, 7));
    expect(out).toBe("# Note — 2024-01-05 09:07");
  });

  it("indexes unsaved buffer edits for backlinks", async () => {
    vi.useFakeTimers();
    await documents.open("Ideas.md");
    documents.edit("Ideas.md", "# Ideas\nNow [[Projects/Plan]]");
    await vi.advanceTimersByTimeAsync(300);
    expect(vaultIndex.backlinks("Projects/Plan.md").map((b) => b.source)).toContain("Ideas.md");
    vi.useRealTimers();
  });
});
