import { basename, dirname, isMarkdown, joinPath, resolveRelative, stripExt } from "../vault/paths";

/**
 * Resolves link targets to vault paths. Rules (documented in README):
 * 1. `[[Folder/Note]]` matches the file whose path ends with `Folder/Note.md`.
 * 2. `[[Note]]` matches any note named `Note.md` (case-insensitive), or a
 *    frontmatter alias, or an attachment whose full filename is `Note`.
 * 3. With several candidates: same folder as the source wins, then the
 *    shortest path, then alphabetical order — deterministic for duplicates.
 * 4. Markdown links `[x](rel/path.md)` resolve relative to the source note,
 *    falling back to vault-root-relative.
 */
export class LinkResolver {
  private byName = new Map<string, string[]>();
  private byAlias = new Map<string, string[]>();
  private all = new Set<string>();
  private lowerAll = new Map<string, string>();

  constructor(files: Iterable<string> = [], aliases: Map<string, string[]> = new Map()) {
    this.rebuild(files, aliases);
  }

  rebuild(files: Iterable<string>, aliases: Map<string, string[]>) {
    this.byName.clear();
    this.byAlias.clear();
    this.all.clear();
    this.lowerAll.clear();
    for (const f of files) this.addFile(f);
    for (const [path, list] of aliases) for (const a of list) push(this.byAlias, a.toLowerCase(), path);
  }

  private addFile(path: string) {
    this.all.add(path);
    this.lowerAll.set(path.toLowerCase(), path);
    const name = basename(path).toLowerCase();
    push(this.byName, name, path);
    if (isMarkdown(path)) push(this.byName, stripExt(name), path);
  }

  resolve(target: string, source: string, kind: "wiki" | "markdown" = "wiki"): string | null {
    if (!target) return source;
    const t = target.trim();
    if (kind === "markdown") {
      const rel = resolveRelative(dirname(source), t);
      for (const cand of [rel, resolveRelative("", t)]) {
        if (!cand) continue;
        const exact = this.lowerAll.get(cand.toLowerCase()) ?? this.lowerAll.get(cand.toLowerCase() + ".md");
        if (exact) return exact;
      }
      return null;
    }
    const lower = t.toLowerCase().replace(/^\/+/, "");
    if (lower.includes("/")) {
      const exact = this.lowerAll.get(lower) ?? this.lowerAll.get(lower + ".md");
      if (exact) return exact;
      const tail = lower.endsWith(".md") ? lower : lower + ".md";
      const candidates = [...this.all].filter((p) => {
        const pl = p.toLowerCase();
        return pl.endsWith("/" + tail) || pl.endsWith("/" + lower);
      });
      return pick(candidates, source);
    }
    const byName = this.byName.get(lower);
    if (byName?.length) return pick(byName, source);
    const byAlias = this.byAlias.get(lower);
    if (byAlias?.length) return pick(byAlias, source);
    return null;
  }

  /** Where a note should be created when following an unresolved `[[target]]`. */
  newNotePath(target: string, defaultFolder: string): string {
    const clean = target.replace(/^\/+/, "");
    const withExt = isMarkdown(clean) ? clean : clean + ".md";
    return clean.includes("/") ? joinPath(withExt) : joinPath(defaultFolder, withExt);
  }

  /** All note paths, for autocompletion. */
  files(): string[] {
    return [...this.all];
  }
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (list) {
    if (!list.includes(value)) list.push(value);
  } else map.set(key, [value]);
}

function pick(candidates: string[], source: string): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const srcDir = dirname(source);
  return [...candidates].sort((a, b) => {
    const sa = dirname(a) === srcDir ? 0 : 1;
    const sb = dirname(b) === srcDir ? 0 : 1;
    if (sa !== sb) return sa - sb;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  })[0];
}
