import { describe, expect, it } from "vitest";
import { findMentions, linkMention } from "./mentions";
import { parseNote } from "./parse";

const find = (content: string, names: string[]) => findMentions(content, names, parseNote("x.md", content).links).map((m) => m.text);

describe("unlinked mentions", () => {
  it("finds whole-word, case-insensitive mentions", () => {
    expect(find("The project plan. Planning is not it. PLAN b.", ["Plan"])).toEqual(["plan", "PLAN"]);
  });

  it("skips existing links, code, frontmatter, tags and URLs", () => {
    const src = "---\ntitle: Plan\n---\n[[Plan]] [x](Plan.md) `plan` #plan https://x.dev/plan\n```\nplan\n```\nreal plan";
    expect(find(src, ["Plan"])).toEqual(["plan"]);
  });

  it("matches aliases and multi-word titles, longest first", () => {
    expect(find("Read Project Plan and the PP doc", ["Project Plan", "PP", "Plan"])).toEqual(["Project Plan", "PP"]);
  });

  it("ignores names too short to be meaningful", () => {
    expect(find("a b c", ["a"])).toEqual([]);
  });

  it("links a mention, keeping wording as an alias", () => {
    const src = "see the plan now";
    const [m] = findMentions(src, ["Plan"], []);
    expect(linkMention(src, m, "Plan")).toBe("see the [[Plan|plan]] now");
    expect(linkMention("Plan!", { from: 0, to: 4 }, "Plan")).toBe("[[Plan]]!");
  });
});
