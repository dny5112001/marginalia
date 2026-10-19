import { describe, expect, it } from "vitest";
import { extractFrontmatter, maskNonProse, parseNote, splitWikiTarget } from "./parse";

describe("splitWikiTarget", () => {
  it("splits target, heading and alias", () => {
    expect(splitWikiTarget("Note")).toEqual({ target: "Note", heading: undefined, alias: undefined });
    expect(splitWikiTarget("Folder/Note#Section|Shown")).toEqual({ target: "Folder/Note", heading: "Section", alias: "Shown" });
    expect(splitWikiTarget("#Local heading")).toEqual({ target: "", heading: "Local heading", alias: undefined });
    expect(splitWikiTarget("Note#^block-id")).toEqual({ target: "Note", heading: "block-id", alias: undefined });
  });
});

describe("parseNote links", () => {
  it("finds wikilinks, embeds and markdown links with positions", () => {
    const src = "See [[Alpha]] and [[Beta|b]].\n![[pic.png]] and [x](sub/Gamma.md#Top) and [web](https://x.dev)";
    const n = parseNote("a.md", src);
    expect(n.links.map((l) => [l.kind, l.target, l.alias, l.embed, l.heading])).toEqual([
      ["wiki", "Alpha", undefined, false, undefined],
      ["wiki", "Beta", "b", false, undefined],
      ["wiki", "pic.png", undefined, true, undefined],
      ["markdown", "sub/Gamma.md", "x", false, "Top"],
    ]);
    const alpha = n.links[0];
    expect(src.slice(alpha.from, alpha.to)).toBe("[[Alpha]]");
    expect(n.links[2].line).toBe(1);
  });

  it("ignores links inside code blocks and inline code", () => {
    const src = "```md\n[[Hidden]] #nottag\n```\n`[[Inline]]` real [[Shown]]\n~~~\n[[Tilde]]\n~~~";
    const n = parseNote("a.md", src);
    expect(n.links.map((l) => l.target)).toEqual(["Shown"]);
    expect(n.allTags).toEqual([]);
  });

  it("decodes percent-encoded markdown link targets", () => {
    const n = parseNote("a.md", "[x](My%20Note.md) [y](<Other Note.md>)");
    expect(n.links.map((l) => l.target)).toEqual(["My Note.md", "Other Note.md"]);
  });

  it("keeps offsets aligned with unicode content", () => {
    const src = "Ünïcödé 日本語 [[Zielnotiz]]";
    const n = parseNote("a.md", src);
    expect(src.slice(n.links[0].from, n.links[0].to)).toBe("[[Zielnotiz]]");
  });
});

describe("tags and headings", () => {
  it("parses inline tags, ignoring numbers, headings and URLs fragments", () => {
    const n = parseNote("a.md", "# Heading\n#research and #Project/Sub, issue #42, (#paren) url.com/#anchor");
    expect(n.allTags.sort()).toEqual(["paren", "project/sub", "research"]);
  });

  it("collects headings with level and line", () => {
    const n = parseNote("a.md", "# One\ntext\n## Two ##\n```\n# not a heading\n```\n### Three");
    expect(n.headings.map((h) => [h.level, h.text, h.line])).toEqual([
      [1, "One", 0],
      [2, "Two", 2],
      [3, "Three", 6],
    ]);
  });
});

describe("frontmatter", () => {
  it("parses YAML, tags and aliases", () => {
    const n = parseNote("a.md", "---\ntitle: Hello\ntags: [one, '#two']\naliases:\n  - Hi\n  - Hey\n---\n# Body #three\n");
    expect(n.frontmatter).toMatchObject({ title: "Hello" });
    expect(n.allTags.sort()).toEqual(["one", "three", "two"]);
    expect(n.aliases).toEqual(["Hi", "Hey"]);
    expect(n.headings[0].text).toBe("Body #three");
  });

  it("accepts string tags and a single alias", () => {
    const n = parseNote("a.md", "---\ntags: alpha beta\nalias: Solo\n---\n");
    expect(n.allTags).toEqual(["alpha", "beta"]);
    expect(n.aliases).toEqual(["Solo"]);
  });

  it("reports invalid YAML without throwing and does not index it as content", () => {
    const n = parseNote("a.md", "---\nkey: [unclosed\n---\n[[Real]]");
    expect(n.frontmatterError).toBeTruthy();
    expect(n.links.map((l) => l.target)).toEqual(["Real"]);
  });

  it("handles empty frontmatter and no frontmatter", () => {
    expect(extractFrontmatter("---\n---\nbody")?.data).toEqual({});
    expect(extractFrontmatter("no fm")).toBeNull();
    expect(extractFrontmatter("text\n---\nnot: fm\n---")).toBeNull();
  });

  it("masks frontmatter so its contents are not parsed as links", () => {
    const src = "---\nrelated: '[[NotALink]]'\n---\nbody";
    const fm = extractFrontmatter(src)!;
    expect(maskNonProse(src, fm.end)).not.toContain("NotALink");
  });
});

describe("word count", () => {
  it("excludes frontmatter", () => {
    expect(parseNote("a.md", "---\na: b c d\n---\none two three").wordCount).toBe(3);
  });
});

describe("large documents", () => {
  it("parses a large note quickly", () => {
    const big = Array.from({ length: 20000 }, (_, i) => `Line ${i} with [[Link ${i % 50}]] and #tag${i % 7}`).join("\n");
    const t = performance.now();
    const n = parseNote("big.md", big);
    expect(n.links.length).toBe(20000);
    expect(performance.now() - t).toBeLessThan(1500);
  });
});
