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
  duplicateNote,
  attachmentFolderFor,
  saveAttachment,
  editNote,
  dailyNotes,
  openDailyNote,
} from "./store";
import { fileHistory } from "../features/history";
import { lineDiffStats } from "../components/overlays/HistoryModal";
import { useWorkspace } from "../features/workspace/store";
import { useSettings } from "../settings/store";
import { BOOKMARKS_PATH, useBookmarks } from "../features/bookmarks/store";

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

  it("persists bookmarks in the vault and keeps them in sync with renames and deletes", async () => {
    const b = useBookmarks.getState();
    await b.toggle({ type: "file", path: "Ideas.md" });
    await b.toggle({ type: "search", query: "tag:x" });
    await b.toggle({ type: "heading", path: "Projects/Plan.md", heading: "Top" });
    expect(JSON.parse(backend.files.get(BOOKMARKS_PATH)!.content).items).toHaveLength(3);
    // Hidden config does not appear in the file tree or index.
    expect(useVault.getState().entries.some((e) => e.path.startsWith(".marginalia"))).toBe(false);
    await renamePath("Projects", "Work");
    await new Promise((r) => setTimeout(r, 0));
    expect(useBookmarks.getState().items.find((x) => x.type === "heading")).toMatchObject({ path: "Work/Plan.md" });
    await deletePath("Ideas.md");
    await new Promise((r) => setTimeout(r, 0));
    expect(useBookmarks.getState().items.map((x) => x.type)).toEqual(["search", "heading"]);
    // Reload from disk.
    useBookmarks.getState().reset();
    await useBookmarks.getState().load();
    expect(useBookmarks.getState().items).toHaveLength(2);
  });

  it("tolerates a corrupt bookmarks file without overwriting it", async () => {
    backend.seed(BOOKMARKS_PATH, "{ not json");
    await useBookmarks.getState().load();
    expect(useBookmarks.getState().error).toBeTruthy();
    expect(backend.files.get(BOOKMARKS_PATH)!.content).toBe("{ not json");
  });

  it("duplicates a note without overwriting", async () => {
    expect(await duplicateNote("Ideas.md")).toBe("Ideas 1.md");
    expect(backend.files.get("Ideas 1.md")!.content).toBe(backend.files.get("Ideas.md")!.content);
  });

  it("saves pasted attachments without overwriting and returns an embed", async () => {
    expect(attachmentFolderFor("a/b/Note.md", "")).toBe("");
    expect(attachmentFolderFor("a/b/Note.md", "./")).toBe("a/b");
    expect(attachmentFolderFor("a/b/Note.md", "./assets")).toBe("a/b/assets");
    expect(attachmentFolderFor("a/b/Note.md", "Attachments")).toBe("Attachments");
    useSettings.getState().update({ attachmentFolder: "Attachments" });
    const md1 = await saveAttachment("Home.md", { name: "image.png", type: "image/png", base64: "AAAA" });
    expect(md1).toMatch(/^!\[\[Pasted image \d{14}\.png\]\]$/);
    const md2 = await saveAttachment("Home.md", { name: "report.pdf", type: "application/pdf", base64: "AAAA" });
    const md3 = await saveAttachment("Home.md", { name: "report.pdf", type: "application/pdf", base64: "BBBB" });
    expect(md2).toBe("[[report.pdf]]");
    expect(md3).toBe("[[report 1.pdf]]");
    expect(backend.binaries.get("Attachments/report.pdf")).toBe("AAAA");
  });

  it("keeps earlier versions and deleted notes in local history", async () => {
    const vault = useVault.getState().info!.path;
    await documents.open("Ideas.md");
    documents.edit("Ideas.md", "new text");
    await documents.save("Ideas.md");
    await new Promise((r) => setTimeout(r, 0));
    const snaps = await fileHistory.list(vault, "Ideas.md");
    expect(snaps[0].content).toBe("# Ideas\nBack [[Home]]");
    await deletePath("Projects/Plan.md");
    expect((await fileHistory.list(vault, "Projects/Plan.md"))[0].content).toContain("Plan with");
    expect(lineDiffStats("a\nb\nc", "a\nc\nd")).toEqual({ added: 1, removed: 1 });
  });

  it("edits closed notes safely on disk", async () => {
    expect(await editNote("Ideas.md", (c) => c + "\nmore")).toBe(true);
    expect(backend.files.get("Ideas.md")!.content.endsWith("more")).toBe(true);
    expect(vaultIndex.content("Ideas.md")!.endsWith("more")).toBe(true);
  });

  it("names daily notes by format and finds them again", async () => {
    useSettings.getState().update({ dailyNoteFormat: "YYYY-MM-DD", dailyNoteFolder: "Daily" });
    await openDailyNote(new Date(2024, 0, 5));
    await openDailyNote(new Date(2024, 0, 7));
    expect(backend.files.has("Daily/2024-01-05.md")).toBe(true);
    expect(dailyNotes().map((d) => d.path)).toEqual(["Daily/2024-01-05.md", "Daily/2024-01-07.md"]);
  });

  it("respects the new-note location setting", async () => {
    useWorkspace.getState().openNote("Projects/Plan.md");
    useSettings.getState().update({ newNoteLocation: "current" });
    expect(await createNote()).toBe("Projects/Untitled.md");
    useSettings.getState().update({ newNoteLocation: "root" });
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
