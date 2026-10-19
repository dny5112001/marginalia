import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown/render";
import { eventToShortcut, findConflicts, formatShortcut, normalizeShortcut, allCommands } from "./commands/registry";
import { registerAppCommands } from "./commands/appCommands";
import { sanitizeSettings, DEFAULT_SETTINGS } from "./settings/store";
import { resolveRelative, uniquePath, validateName, remapPath } from "./vault/paths";
import { filterGraph } from "./graph/filter";

describe("markdown rendering", () => {
  it("renders GFM features", () => {
    const html = renderMarkdown("# T\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~ **b** *i* `c`\n\n```js\nconst x = 1;\n```");
    expect(html).toContain("<h1");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<table>");
    expect(html).toContain("<del>gone</del>");
    expect(html).toMatch(/class="[^"]*hljs/);
  });

  it("renders wikilinks, aliases, tags and image embeds", () => {
    const html = renderMarkdown("[[Note|Shown]] [[Other#Sec]] #tag ![[pic.png]]");
    expect(html).toContain('href="wikilink:Note" class="wikilink" data-target="Note"');
    expect(html).toContain(">Shown</a>");
    expect(html).toContain('href="wikilink:Other#Sec"');
    expect(html).toContain('href="tag:tag" class="tag"');
    expect(html).toContain('data-src="wikilink:pic.png"');
  });

  it("hides frontmatter", () => {
    expect(renderMarkdown("---\nsecret: yes\n---\nBody")).not.toContain("secret");
  });

  it("sanitizes raw HTML and dangerous URLs", () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror="alert(1)">\n\n[x](javascript:alert(1)) <iframe src="https://e.vil"></iframe>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<iframe");
  });

  it("does not turn wikilinks inside code into links", () => {
    expect(renderMarkdown("`[[NotLink]]`")).not.toContain("wikilink:");
  });
});

describe("shortcut registry", () => {
  registerAppCommands();

  it("has no conflicting shortcuts", () => {
    expect(findConflicts()).toEqual([]);
    expect(allCommands().length).toBeGreaterThan(30);
  });

  it("covers the required shortcuts", () => {
    const ids = new Set(allCommands().filter((c) => c.shortcut).map((c) => c.id));
    for (const id of ["note.new", "note.save", "nav.search", "nav.switcher", "nav.palette", "view.left", "view.right", "tab.next", "nav.backlinks", "folder.new", "tab.close"])
      expect(ids).toContain(id);
  });

  it("normalizes keyboard events", () => {
    const e = { key: "F", code: "KeyF", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true };
    expect(eventToShortcut(e, true)).toBe("Mod+Shift+F");
    expect(eventToShortcut({ ...e, metaKey: false, ctrlKey: true }, false)).toBe("Mod+Shift+F");
    expect(eventToShortcut({ key: "|", code: "Backslash", metaKey: true, ctrlKey: false, altKey: true, shiftKey: false }, true)).toBe("Mod+Alt+\\");
    expect(normalizeShortcut("Shift+Mod+f")).toBe("Mod+Shift+F");
    expect(normalizeShortcut("Ctrl+Tab", false)).toBe("Mod+Tab");
    expect(formatShortcut("Mod+Shift+F", true)).toBe("⌘⇧F");
    expect(formatShortcut("Mod+Shift+F", false)).toBe("Ctrl+Shift+F");
  });
});

describe("settings", () => {
  it("falls back to defaults for invalid stored values", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ theme: "neon", editorFontSize: 99, lineNumbers: true, newNoteFolder: "../escape", dailyNoteFolder: "/Daily/" });
    expect(s.theme).toBe("dark");
    expect(s.editorFontSize).toBe(DEFAULT_SETTINGS.editorFontSize);
    expect(s.lineNumbers).toBe(true);
    expect(s.newNoteFolder).toBe("");
    expect(s.dailyNoteFolder).toBe("Daily");
  });
});

describe("path helpers", () => {
  it("validates names", () => {
    expect(validateName("Good name")).toBeNull();
    expect(validateName("")).not.toBeNull();
    expect(validateName("a/b")).not.toBeNull();
    expect(validateName(".hidden")).not.toBeNull();
    expect(validateName("日本語のノート")).toBeNull();
  });

  it("generates unique paths", () => {
    expect(uniquePath("a/Untitled.md", ["a/untitled.md", "a/Untitled 1.md"])).toBe("a/Untitled 2.md");
    expect(uniquePath("New.md", [])).toBe("New.md");
  });

  it("resolves relative paths without escaping the vault", () => {
    expect(resolveRelative("a/b", "../c.md")).toBe("a/c.md");
    expect(resolveRelative("", "../c.md")).toBeNull();
  });

  it("remaps descendants only", () => {
    expect(remapPath("ab/x.md", "a", "z")).toBe("ab/x.md");
    expect(remapPath("a/x.md", "a", "z")).toBe("z/x.md");
  });
});

describe("graph filter", () => {
  const data = {
    nodes: [
      { id: "a.md", label: "a", tags: ["x"], folder: "", unresolved: false, degree: 1 },
      { id: "f/b.md", label: "b", tags: ["y/z"], folder: "f", unresolved: false, degree: 1 },
      { id: "c.md", label: "c", tags: [], folder: "", unresolved: false, degree: 0 },
    ],
    edges: [{ source: "a.md", target: "f/b.md" }],
  };
  it("filters by tag, folder and orphans", () => {
    const base = { query: "", tag: "", folder: "", showOrphans: true, showUnresolved: false };
    expect(filterGraph(data, { ...base, tag: "y" }).nodes.map((n) => n.id)).toEqual(["f/b.md"]);
    expect(filterGraph(data, { ...base, folder: "f" }).nodes.map((n) => n.id)).toEqual(["f/b.md"]);
    expect(filterGraph(data, { ...base, showOrphans: false }).nodes.map((n) => n.id)).toEqual(["a.md", "f/b.md"]);
  });
});
