import { describe, expect, it } from "vitest";
import { makeSnippets, parseQuery, SearchIndex, tokenize } from "./searchIndex";
import { fuzzyFilter, fuzzyMatch } from "./fuzzy";

function build() {
  const s = new SearchIndex();
  s.add("Recipes/Pasta.md", "Pasta", "Boil water. Add salt and spaghetti. Serve with parmesan.", ["food"]);
  s.add("Notes/Café.md", "Café", "Meeting at the café about the résumé review.", ["work"]);
  s.add("Notes/Water.md", "Water", "Water cycle notes. Evaporation and condensation.", ["science", "science/earth"]);
  return s;
}

describe("tokenize", () => {
  it("lowercases and strips diacritics", () => {
    expect(tokenize("Café RÉSUMÉ naïve")).toEqual(["cafe", "resume", "naive"]);
  });
});

describe("parseQuery", () => {
  it("separates filters, phrases and terms", () => {
    expect(parseQuery('tag:#food path:Recipes "boil water" salt file:pas #extra')).toEqual({
      terms: ["salt"],
      phrases: ["boil water"],
      tags: ["food", "extra"],
      paths: ["recipes"],
      files: ["pas"],
    });
  });
});

describe("SearchIndex", () => {
  it("finds notes by content with all terms required", () => {
    const s = build();
    expect(s.search("salt spaghetti").map((h) => h.path)).toEqual(["Recipes/Pasta.md"]);
    expect(s.search("salt evaporation")).toEqual([]);
  });

  it("supports prefix matching and accents-insensitive search", () => {
    const s = build();
    expect(s.search("spag").map((h) => h.path)).toEqual(["Recipes/Pasta.md"]);
    expect(s.search("cafe").map((h) => h.path)).toEqual(["Notes/Café.md"]);
  });

  it("ranks title matches above body matches", () => {
    const s = build();
    expect(s.search("water").map((h) => h.path)).toEqual(["Notes/Water.md", "Recipes/Pasta.md"]);
  });

  it("matches by filename", () => {
    expect(build().search("pasta")[0].path).toBe("Recipes/Pasta.md");
  });

  it("filters by tag (including nested), path, file and phrase", () => {
    const s = build();
    expect(s.search("tag:science").map((h) => h.path)).toEqual(["Notes/Water.md"]);
    expect(s.search("tag:science/earth").map((h) => h.path)).toEqual(["Notes/Water.md"]);
    expect(s.search("path:notes").map((h) => h.path).sort()).toEqual(["Notes/Café.md", "Notes/Water.md"]);
    expect(s.search('"add salt"').map((h) => h.path)).toEqual(["Recipes/Pasta.md"]);
    expect(s.search('"salt add"')).toEqual([]);
    expect(s.search("file:caf").map((h) => h.path)).toEqual(["Notes/Café.md"]);
  });

  it("produces highlighted snippets mapped to the original text", () => {
    const hit = build().search("resume")[0];
    const sn = hit.snippets[0];
    const [a, b] = sn.ranges[0];
    expect(sn.text.slice(a, b)).toBe("résumé");
  });

  it("removes and updates documents", () => {
    const s = build();
    s.remove("Recipes/Pasta.md");
    expect(s.search("spaghetti")).toEqual([]);
    s.add("Notes/Water.md", "Water", "Now about rivers", []);
    expect(s.search("evaporation")).toEqual([]);
    expect(s.search("rivers").length).toBe(1);
    expect(s.size).toBe(2);
  });

  it("returns empty for empty queries", () => {
    expect(build().search("   ")).toEqual([]);
  });
});

describe("makeSnippets", () => {
  it("returns the start of the note when there are no needles", () => {
    expect(makeSnippets("---\na: 1\n---\nHello there", [])[0].text).toBe("Hello there");
  });
});

describe("fuzzy", () => {
  it("matches subsequences and ranks boundaries/prefixes higher", () => {
    expect(fuzzyMatch("qs", "Quick Switcher")).not.toBeNull();
    expect(fuzzyMatch("xyz", "Quick Switcher")).toBeNull();
    const ranked = fuzzyFilter("plan", ["Archive/Old plans", "Plan", "Explanation"], (x) => x).map((r) => r.item);
    expect(ranked[0]).toBe("Plan");
  });
});
