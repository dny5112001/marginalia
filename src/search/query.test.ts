import { describe, expect, it } from "vitest";
import { explainQuery, parseSearch } from "./query";
import { SearchIndex } from "./searchIndex";

function build() {
  const s = new SearchIndex();
  s.add("Projects/Launch.md", "Launch", "# Plan\n- [ ] write docs\n- [x] ship beta\n\n# Risks\nbudget overrun\n", ["work"], { status: "active", owner: "Ana" });
  s.add("Journal/2024-01-02.md", "2024-01-02", "Met Ana about the budget.\nPlanning tomorrow.\n", ["journal"], null);
  s.add("Recipes/Soup.md", "Soup", "Boil Water.\nAdd salt.\n", ["food"], { status: "done" });
  return s;
}
const paths = (s: SearchIndex, q: string, matchCase = false) => s.search(q, { matchCase, sort: "path" }).map((h) => h.path);

describe("query parser", () => {
  it("parses groups, OR, negation, fields, scopes, regex and properties", () => {
    const q = parseSearch('a -b OR "c d" tag:#x line:(e f) [status:active] /g+/ (h OR i)');
    expect(q).toHaveLength(2);
    expect(q[0].map((c) => c.kind)).toEqual(["term", "term"]);
    expect(q[0][1].neg).toBe(true);
    expect(q[1].map((c) => c.kind)).toEqual(["phrase", "field", "scope", "prop", "regex", "group"]);
  });

  it("explains a query in plain language", () => {
    expect(explainQuery(parseSearch("budget -tag:food"))).toEqual(['Match all of:', '  Matches text: "budget"', '  Excluding: Has tag: "food"']);
  });

  it("does not treat a lone dash or unknown key as an operator", () => {
    expect(parseSearch("- foo:bar")[0].map((c) => c.kind)).toEqual(["term", "term"]);
  });
});

describe("search operators", () => {
  const s = build();
  it("AND, OR and exclusion", () => {
    expect(paths(s, "budget ana")).toEqual(["Journal/2024-01-02.md"]);
    expect(paths(s, "salt OR docs")).toEqual(["Projects/Launch.md", "Recipes/Soup.md"]);
    expect(paths(s, "budget -journal")).toEqual(["Projects/Launch.md"]);
    expect(paths(s, "budget -path:Journal")).toEqual(["Projects/Launch.md"]);
  });

  it("line, section and task scopes", () => {
    expect(paths(s, "line:(ana budget)")).toEqual(["Journal/2024-01-02.md"]);
    expect(paths(s, "section:(docs budget)")).toEqual([]);
    expect(paths(s, "section:(risks budget)")).toEqual(["Projects/Launch.md"]);
    expect(paths(s, "task:docs")).toEqual(["Projects/Launch.md"]);
    expect(paths(s, "task-todo:ship")).toEqual([]);
    expect(paths(s, "task-done:ship")).toEqual(["Projects/Launch.md"]);
  });

  it("properties, content, regex and match case", () => {
    expect(paths(s, "[status]")).toEqual(["Projects/Launch.md", "Recipes/Soup.md"]);
    expect(paths(s, "[status:done]")).toEqual(["Recipes/Soup.md"]);
    expect(paths(s, "[owner:ana]")).toEqual(["Projects/Launch.md"]);
    expect(paths(s, "content:soup")).toEqual([]);
    expect(paths(s, "/\\d{4}-\\d{2}/")).toEqual([]);
    expect(paths(s, "/boil \\w+/")).toEqual(["Recipes/Soup.md"]);
    expect(paths(s, "Water", true)).toEqual(["Recipes/Soup.md"]);
    expect(paths(s, "water", true)).toEqual([]);
    expect(paths(s, "/(unclosed/")).toEqual([]);
  });

  it("highlights regex matches in snippets", () => {
    const hit = s.search("/boil \\w+/")[0];
    const sn = hit.snippets[0];
    expect(sn.text.slice(...sn.ranges[0])).toBe("Boil Water");
  });

  it("sorts by name", () => {
    expect(s.search("[status]", { sort: "name-desc" }).map((h) => h.title)).toEqual(["Soup", "Launch"]);
  });
});
