import { beforeEach, describe, expect, it } from "vitest";
import { VaultIndex } from "./vaultIndex";

let idx: VaultIndex;

beforeEach(() => {
  idx = new VaultIndex();
  idx.load(["a.md", "b.md", "c.md", "img.png"], [
    { path: "a.md", content: "Links to [[b]] and [[c|see c]] and [[ghost]] #topic\n![[img.png]]" },
    { path: "b.md", content: "---\ntags: [topic/sub]\n---\nBack to [[a]]. Another [[a#Top]]." },
    { path: "c.md", content: "# Top\nNo links here." },
  ]);
});

describe("backlinks", () => {
  it("lists referring notes with context", () => {
    const back = idx.backlinks("a.md");
    expect(back.map((b) => b.source)).toEqual(["b.md", "b.md"]);
    expect(back[0].context).toBe("Back to [[a]]. Another [[a#Top]].");
    expect(idx.backlinks("c.md").map((b) => b.source)).toEqual(["a.md"]);
  });

  it("updates when a note is edited", () => {
    idx.upsert("c.md", "Now linking [[b]]");
    expect(idx.backlinks("b.md").map((b) => b.source).sort()).toEqual(["a.md", "c.md"]);
    idx.upsert("a.md", "no more links");
    expect(idx.backlinks("b.md").map((b) => b.source)).toEqual(["c.md"]);
  });

  it("resolves previously-unresolved links when the note is created", () => {
    expect(idx.unresolvedLinks("a.md")).toEqual(["ghost"]);
    idx.upsert("ghost.md", "");
    expect(idx.unresolvedLinks("a.md")).toEqual([]);
    expect(idx.backlinks("ghost.md").map((b) => b.source)).toEqual(["a.md"]);
  });

  it("drops backlinks when the source is removed and unresolves when the target is removed", () => {
    idx.remove("b.md");
    expect(idx.backlinks("a.md")).toEqual([]);
    idx.remove("c.md");
    expect(idx.unresolvedLinks("a.md").sort()).toEqual(["b", "c", "ghost"]);
  });

  it("handles a rename via remove + upsert", () => {
    const content = idx.content("c.md")!;
    idx.remove("c.md");
    idx.upsert("folder/c.md", content);
    // [[c]] still resolves by name after a move.
    expect(idx.backlinks("folder/c.md").map((b) => b.source)).toEqual(["a.md"]);
  });

  it("resolves aliases and re-links when aliases change", () => {
    idx.upsert("d.md", "[[Nickname]]");
    expect(idx.unresolvedLinks("d.md")).toEqual(["Nickname"]);
    idx.upsert("c.md", "---\naliases: [Nickname]\n---\n# Top");
    expect(idx.backlinks("c.md").map((b) => b.source).sort()).toEqual(["a.md", "d.md"]);
  });
});

describe("tags", () => {
  it("indexes inline and frontmatter tags with nested filtering", () => {
    expect([...idx.tags().keys()]).toEqual(["topic", "topic/sub"]);
    expect(idx.notesWithTag("topic")).toEqual(["a.md", "b.md"]);
    expect(idx.notesWithTag("#topic/sub")).toEqual(["b.md"]);
  });
});

describe("graph", () => {
  it("builds nodes and edges, including attachments that are linked", () => {
    const g = idx.graph();
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["a.md", "b.md", "c.md", "img.png"]);
    expect(g.edges).toContainEqual({ source: "a.md", target: "b.md" });
    expect(g.edges).toContainEqual({ source: "b.md", target: "a.md" });
    // a → b, c, img.png and b → a (repeated links collapse into one edge).
    expect(g.nodes.find((n) => n.id === "a.md")!.degree).toBe(4);
  });

  it("optionally includes unresolved nodes", () => {
    expect(idx.graph(true).nodes.some((n) => n.id === "unresolved:ghost")).toBe(true);
  });

  it("computes a local graph by depth", () => {
    idx.upsert("d.md", "[[c]]");
    expect(idx.localGraph("b.md", 1).nodes.map((n) => n.id).sort()).toEqual(["a.md", "b.md"]);
    expect(idx.localGraph("b.md", 2).nodes.map((n) => n.id).sort()).toEqual(["a.md", "b.md", "c.md", "img.png"]);
  });

  it("handles a larger vault without excessive time", () => {
    const big = new VaultIndex();
    const notes = Array.from({ length: 3000 }, (_, i) => ({ path: `n${i}.md`, content: `# N${i}\n[[n${(i + 1) % 3000}]] [[n${(i * 7) % 3000}]] #t${i % 10} lorem ipsum dolor ${i}` }));
    const t = performance.now();
    big.load(notes.map((n) => n.path), notes);
    big.upsert("n5.md", "changed [[n9]]");
    const g = big.graph();
    expect(g.nodes).toHaveLength(3000);
    expect(big.search.search("lorem n42").length).toBeGreaterThan(0);
    expect(performance.now() - t).toBeLessThan(4000);
  });
});

describe("empty vault", () => {
  it("works with no notes", () => {
    const e = new VaultIndex();
    e.load([], []);
    expect(e.graph()).toEqual({ nodes: [], edges: [] });
    expect(e.tags().size).toBe(0);
    expect(e.search.search("anything")).toEqual([]);
  });
});
