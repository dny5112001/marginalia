import { describe, expect, it } from "vitest";
import { LinkResolver } from "./resolve";
import { relativePath, rewriteLinks } from "./rewrite";
import { parseNote } from "./parse";

const files = ["Home.md", "Projects/Plan.md", "Archive/Plan.md", "Archive/Old/Plan.md", "img/cat.png", "Ünïcode Note.md", "Projects/Spec.md"];

describe("LinkResolver", () => {
  const r = new LinkResolver(files, new Map([["Home.md", ["Start"]]]));

  it("resolves by name case-insensitively", () => {
    expect(r.resolve("home", "x.md")).toBe("Home.md");
    expect(r.resolve("ünïcode note", "x.md")).toBe("Ünïcode Note.md");
  });

  it("resolves by alias", () => {
    expect(r.resolve("Start", "x.md")).toBe("Home.md");
  });

  it("resolves path-qualified links", () => {
    expect(r.resolve("Archive/Plan", "x.md")).toBe("Archive/Plan.md");
    expect(r.resolve("Old/Plan", "x.md")).toBe("Archive/Old/Plan.md");
    expect(r.resolve("Archive/Old/Plan.md", "x.md")).toBe("Archive/Old/Plan.md");
  });

  it("breaks duplicate-name ties predictably", () => {
    // Same folder as the source wins…
    expect(r.resolve("Plan", "Archive/Note.md")).toBe("Archive/Plan.md");
    expect(r.resolve("Plan", "Projects/Spec.md")).toBe("Projects/Plan.md");
    // …otherwise the shortest path, then alphabetical.
    expect(r.resolve("Plan", "Home.md")).toBe("Archive/Plan.md");
  });

  it("resolves attachments by full filename", () => {
    expect(r.resolve("cat.png", "Home.md")).toBe("img/cat.png");
    expect(r.resolve("cat", "Home.md")).toBeNull();
  });

  it("resolves markdown links relative to the source", () => {
    expect(r.resolve("Plan.md", "Projects/Spec.md", "markdown")).toBe("Projects/Plan.md");
    expect(r.resolve("../Home.md", "Projects/Spec.md", "markdown")).toBe("Home.md");
    expect(r.resolve("../../etc/passwd", "Projects/Spec.md", "markdown")).toBeNull();
  });

  it("returns null for missing notes and suggests a creation path", () => {
    expect(r.resolve("Nope", "Home.md")).toBeNull();
    expect(r.newNotePath("Nope", "Inbox")).toBe("Inbox/Nope.md");
    expect(r.newNotePath("Deep/Nope", "Inbox")).toBe("Deep/Nope.md");
  });
});

describe("rewriteLinks", () => {
  it("computes relative paths", () => {
    expect(relativePath("a/b", "a/c/d.md")).toBe("../c/d.md");
    expect(relativePath("", "x/y.md")).toBe("x/y.md");
    expect(relativePath("x", "x/y.md")).toBe("y.md");
  });

  it("rewrites wiki and markdown links, preserving alias, heading and embed", () => {
    const src = "[[Old]] [[Old#Sec|Alias]] ![[Old]] [[Other]] [md](Old.md#Sec) [[folder/Old]]";
    const r = new LinkResolver(["Old.md", "Other.md"], new Map());
    const out = rewriteLinks(src, "Index.md", "New Name.md", (l) => r.resolve(l.target, "Index.md", l.kind) === "Old.md");
    expect(out).toBe("[[New Name]] [[New Name#Sec|Alias]] ![[New Name]] [[Other]] [md](New%20Name.md#Sec) [[folder/Old]]");
  });

  it("keeps folder-qualified links folder-qualified", () => {
    const r = new LinkResolver(["a/Old.md"], new Map());
    const out = rewriteLinks("[[a/Old]]", "x.md", "b/New.md", (l) => r.resolve(l.target, "x.md") === "a/Old.md");
    expect(out).toBe("[[b/New]]");
  });

  it("returns null when nothing changes and never touches code", () => {
    const src = "```\n[[Old]]\n```";
    expect(rewriteLinks(src, "x.md", "New.md", () => true)).toBeNull();
    expect(parseNote("x.md", src).links).toHaveLength(0);
  });
});
