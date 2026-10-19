import type { LinkRef } from "../types";
import { parseNote } from "./parse";
import { basename, dirname, isMarkdown, noteTitle } from "../vault/paths";

/** Relative path from folder `fromDir` to file `to`, both vault-relative. */
export function relativePath(fromDir: string, to: string): string {
  const a = fromDir ? fromDir.split("/") : [];
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

function formatWiki(link: LinkRef, newPath: string, keepFolder: boolean): string {
  let target = keepFolder ? newPath : isMarkdown(newPath) ? noteTitle(newPath) : basename(newPath);
  if (keepFolder && isMarkdown(newPath)) target = newPath.replace(/\.(md|markdown)$/i, "");
  return `${link.embed ? "!" : ""}[[${target}${link.heading ? "#" + link.heading : ""}${link.alias ? "|" + link.alias : ""}]]`;
}

function formatMarkdown(link: LinkRef, original: string, sourcePath: string, newPath: string): string {
  const rel = relativePath(dirname(sourcePath), newPath)
    .split("/")
    .map((s) => encodeURIComponent(s).replace(/%2F/g, "/"))
    .join("/");
  const url = rel + (link.heading ? "#" + encodeURIComponent(link.heading) : "");
  // Replace only the URL part, keeping the label and optional title as written.
  return original.replace(/\]\(\s*(<[^>\n]+>|[^)\s]+)/, `](${url}`);
}

/**
 * Rewrite every link in `content` that `resolvesToOld` says points at the
 * renamed file so it points at `newPath`. Returns null when nothing changed.
 */
export function rewriteLinks(
  content: string,
  sourcePath: string,
  newPath: string,
  resolvesToOld: (link: LinkRef) => boolean,
): string | null {
  const parsed = parseNote(sourcePath, content);
  const edits: { from: number; to: number; text: string }[] = [];
  for (const link of parsed.links) {
    if (!resolvesToOld(link)) continue;
    const original = content.slice(link.from, link.to);
    const text =
      link.kind === "wiki"
        ? formatWiki(link, newPath, link.target.includes("/"))
        : formatMarkdown(link, original, sourcePath, newPath);
    if (text !== original) edits.push({ from: link.from, to: link.to, text });
  }
  if (!edits.length) return null;
  let out = content;
  for (const e of edits.sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return out;
}
