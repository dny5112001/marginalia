import { describe, expect, it } from "vitest";
import { coerceValue, propertyType, removeProperty, renameProperty, setProperty } from "./properties";

const note = "---\n# keep me\ntitle: Hello\ntags: [a, b]\n---\n# Body\ntext\n";

describe("frontmatter property editing", () => {
  it("updates a value while keeping comments, order and body", () => {
    const out = setProperty(note, "title", "World");
    expect(out).toContain("# keep me");
    expect(out.indexOf("title")).toBeLessThan(out.indexOf("tags"));
    expect(out).toContain("title: World");
    expect(out.endsWith("---\n# Body\ntext\n")).toBe(true);
  });

  it("adds a property to a note without frontmatter", () => {
    expect(setProperty("# Body\n", "status", "draft")).toBe("---\nstatus: draft\n---\n\n# Body\n");
  });

  it("writes lists, booleans and numbers as YAML types", () => {
    let out = setProperty(note, "tags", ["x", "y z"]);
    out = setProperty(out, "done", true);
    out = setProperty(out, "rating", 4);
    expect(out).toMatch(/tags:\s*\[\s*x, y z\s*\]|tags:\n\s+- x\n\s+- y z/);
    expect(out).toContain("done: true");
    expect(out).toContain("rating: 4");
  });

  it("removes properties and drops an empty block entirely", () => {
    let out = removeProperty(note, "title");
    expect(out).not.toContain("title");
    out = removeProperty(out, "tags");
    expect(out).toBe("# Body\ntext\n");
  });

  it("renames a key in place and refuses duplicates", () => {
    const out = renameProperty(note, "title", "name");
    expect(out).toContain("name: Hello");
    expect(out.indexOf("name")).toBeLessThan(out.indexOf("tags"));
    expect(() => renameProperty(note, "title", "tags")).toThrow(/already exists/);
  });

  it("refuses to edit invalid YAML instead of destroying it", () => {
    expect(() => setProperty("---\na: [oops\n---\nbody", "b", "c")).toThrow(/not valid YAML/);
  });

  it("detects property types and coerces input", () => {
    expect(propertyType(["a"])).toBe("list");
    expect(propertyType(true)).toBe("checkbox");
    expect(propertyType(3)).toBe("number");
    expect(propertyType("2024-01-02")).toBe("date");
    expect(propertyType("hi")).toBe("text");
    expect(coerceValue("list", "a, b,, c")).toEqual(["a", "b", "c"]);
    expect(coerceValue("number", "x")).toBeNull();
  });
});
