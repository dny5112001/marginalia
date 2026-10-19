import type { LinkRef } from "../types";
import { extractFrontmatter, maskNonProse } from "./parse";

export interface Mention {
  from: number;
  to: number;
  line: number;
  text: string;
  context: string;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find plain-text mentions of any of `names` (whole words, case-insensitive) in
 * `content`, skipping frontmatter, code, and text that is already inside a link.
 */
export function findMentions(content: string, names: string[], links: LinkRef[]): Mention[] {
  const usable = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  if (!usable.length) return [];
  const fmEnd = extractFrontmatter(content)?.end ?? 0;
  const chars = maskNonProse(content, fmEnd).split("");
  for (const l of links) for (let i = l.from; i < l.to; i++) if (chars[i] !== "\n") chars[i] = " ";
  // Mask URLs and existing tags so "#plan" or "example.com/plan" don't count.
  const masked = chars.join("").replace(/https?:\/\/\S+|#[\p{L}\p{N}_\-/]+/gu, (m) => " ".repeat(m.length));
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${usable.map(escapeRe).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
  const out: Mention[] = [];
  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") lineStarts.push(i + 1);
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) && out.length < 200) {
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= m.index) line++;
    const lineEnd = content.indexOf("\n", m.index);
    out.push({
      from: m.index,
      to: m.index + m[0].length,
      line,
      text: content.slice(m.index, m.index + m[0].length),
      context: content.slice(lineStarts[line], lineEnd === -1 ? content.length : lineEnd).trim(),
    });
  }
  return out;
}

/** Replace one mention with a wikilink, keeping the original wording as an alias when it differs. */
export function linkMention(content: string, mention: Pick<Mention, "from" | "to">, title: string): string {
  const text = content.slice(mention.from, mention.to);
  const link = text === title ? `[[${title}]]` : `[[${title}|${text}]]`;
  return content.slice(0, mention.from) + link + content.slice(mention.to);
}
