import { parse as parseYaml } from "yaml";
import type { Heading, LinkRef, ParsedNote, TagRef } from "../types";
import { noteTitle } from "../vault/paths";

export interface FrontmatterBlock {
  /** Raw YAML between the fences. */
  raw: string;
  /** Offset where the body after the closing fence begins. */
  end: number;
  data: Record<string, unknown> | null;
  error: string | null;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function extractFrontmatter(content: string): FrontmatterBlock | null {
  const m = FM_RE.exec(content);
  if (!m) {
    // Empty frontmatter: "---\n---"
    const empty = /^---\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(content);
    return empty ? { raw: "", end: empty[0].length, data: {}, error: null } : null;
  }
  let data: Record<string, unknown> | null = null;
  let error: string | null = null;
  try {
    const parsed: unknown = parseYaml(m[1]);
    if (parsed == null) data = {};
    else if (typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    else error = "Frontmatter must be a key/value mapping.";
  } catch (e) {
    error = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }
  return { raw: m[1], end: m[0].length, data, error };
}

/**
 * Replace code (fenced blocks, inline code) and frontmatter with spaces so that
 * regex scanners skip them while character offsets stay aligned with the source.
 */
export function maskNonProse(content: string, frontmatterEnd = 0): string {
  const chars = content.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (chars[i] !== "\n") chars[i] = " ";
  };
  blank(0, frontmatterEnd);

  const fence = /^([ \t]{0,3})(`{3,}|~{3,})[^\n]*$/gm;
  fence.lastIndex = frontmatterEnd;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(content))) {
    const marker = m[2];
    const start = m.index;
    const closeRe = new RegExp(`^[ \\t]{0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`, "gm");
    closeRe.lastIndex = m.index + m[0].length + 1;
    const close = closeRe.exec(content);
    const end = close ? close.index + close[0].length : content.length;
    blank(start, end);
    fence.lastIndex = end;
  }

  const masked = chars.join("");
  // Inline code spans (single line, matching backtick runs).
  return masked.replace(/(`+)([^`\n]|[^`\n][\s\S]*?[^`\n])\1(?!`)/g, (s) =>
    s.includes("\n") ? s : " ".repeat(s.length),
  );
}

function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") starts.push(i + 1);
  return starts;
}

export function lineAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const WIKILINK_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const MDLINK_RE = /(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g;
const TAG_RE = /(^|[\s(,;])#([\p{L}\p{N}_\-/]+)/gu;
const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;

export function splitWikiTarget(inner: string): { target: string; heading?: string; alias?: string } {
  let rest = inner;
  let alias: string | undefined;
  const pipe = rest.indexOf("|");
  if (pipe !== -1) {
    alias = rest.slice(pipe + 1).trim() || undefined;
    rest = rest.slice(0, pipe);
  }
  let heading: string | undefined;
  const hash = rest.indexOf("#");
  if (hash !== -1) {
    heading = rest.slice(hash + 1).replace(/^\^/, "").trim() || undefined;
    rest = rest.slice(0, hash);
  }
  return { target: rest.trim(), heading, alias };
}

export function parseLinks(content: string, masked: string, starts: number[]): LinkRef[] {
  const links: LinkRef[] = [];
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(masked))) {
    const raw = content.slice(m.index, m.index + m[0].length);
    const inner = raw.slice(m[1].length + 2, -2);
    const { target, heading, alias } = splitWikiTarget(inner);
    if (!target && !heading) continue;
    links.push({
      target,
      heading,
      alias,
      embed: m[1] === "!",
      kind: "wiki",
      from: m.index,
      to: m.index + m[0].length,
      line: lineAt(starts, m.index),
    });
  }
  MDLINK_RE.lastIndex = 0;
  while ((m = MDLINK_RE.exec(masked))) {
    let url = content.slice(m.index, m.index + m[0].length).match(/\]\(\s*(<[^>\n]+>|[^)\s]+)/)?.[1] ?? "";
    if (url.startsWith("<")) url = url.slice(1, -1);
    // External links and in-page anchors are not vault links.
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("#") || url.startsWith("//")) continue;
    let decoded = url;
    try {
      decoded = decodeURI(url);
    } catch {
      /* keep raw */
    }
    const hash = decoded.indexOf("#");
    const target = hash === -1 ? decoded : decoded.slice(0, hash);
    const heading = hash === -1 ? undefined : decoded.slice(hash + 1) || undefined;
    if (!target) continue;
    links.push({
      target,
      heading,
      alias: m[2] || undefined,
      embed: m[1] === "!",
      kind: "markdown",
      from: m.index,
      to: m.index + m[0].length,
      line: lineAt(starts, m.index),
    });
  }
  return links.sort((a, b) => a.from - b.from);
}

export function parseTags(masked: string, starts: number[]): TagRef[] {
  const tags: TagRef[] = [];
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(masked))) {
    const tag = m[2].replace(/\/+$/, "");
    // Pure numbers (#123) are not tags, matching common Markdown PKM conventions.
    if (!tag || /^[\d/]+$/.test(tag)) continue;
    const offset = m.index + m[1].length;
    tags.push({ tag, offset, line: lineAt(starts, offset) });
  }
  return tags;
}

export function parseHeadings(masked: string, content: string, starts: number[]): Heading[] {
  const out: Heading[] = [];
  let m: RegExpExecArray | null;
  HEADING_RE.lastIndex = 0;
  while ((m = HEADING_RE.exec(masked))) {
    const raw = content.slice(m.index, m.index + m[0].length);
    const text = raw.replace(/^#{1,6}[ \t]+/, "").replace(/[ \t]+#+[ \t]*$/, "").trim();
    out.push({ level: m[1].length, text, line: lineAt(starts, m.index), offset: m.index });
  }
  return out;
}

function toStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(toStringList);
  if (typeof value === "string") return value.split(/[,\s]+/).filter(Boolean);
  if (typeof value === "number") return [String(value)];
  return [];
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
  return m ? m.length : 0;
}

export function parseNote(path: string, content: string): ParsedNote {
  const fm = extractFrontmatter(content);
  const fmEnd = fm?.end ?? 0;
  const masked = maskNonProse(content, fmEnd);
  const starts = lineStarts(content);
  const tags = parseTags(masked, starts);
  const fmTags = fm?.data ? toStringList(fm.data.tags ?? fm.data.tag).map((t) => t.replace(/^#/, "")) : [];
  const rawAliases = fm?.data ? (fm.data.aliases ?? fm.data.alias) : undefined;
  const aliases = Array.isArray(rawAliases)
    ? rawAliases.filter((a): a is string => typeof a === "string")
    : typeof rawAliases === "string"
      ? [rawAliases]
      : [];
  const allTags = [...new Set([...fmTags, ...tags.map((t) => t.tag)].map((t) => t.toLowerCase()))];
  return {
    path,
    title: noteTitle(path),
    frontmatter: fm?.data ?? null,
    frontmatterError: fm?.error ?? null,
    links: parseLinks(content, masked, starts),
    tags,
    allTags,
    aliases,
    headings: parseHeadings(masked, content, starts),
    wordCount: countWords(content.slice(fmEnd)),
  };
}

/** Slug used to match `[[Note#Heading]]` against headings (case/space/punct-insensitive). */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
