import type { Backlink, LinkRef, ParsedNote } from "../types";
import { headingSlug, parseNote } from "../links/parse";
import { LinkResolver } from "../links/resolve";
import { isMarkdown } from "../vault/paths";
import { SearchIndex } from "../search/searchIndex";
import { findMentions, type Mention } from "../links/mentions";

interface NoteRecord {
  content: string;
  parsed: ParsedNote;
}

export interface GraphData {
  nodes: { id: string; label: string; tags: string[]; folder: string; unresolved: boolean; degree: number }[];
  edges: { source: string; target: string }[];
}

/**
 * In-memory index derived entirely from vault files: parsed notes, resolved
 * link graph, backlinks, tags and full-text search. Always rebuildable from
 * disk — it is never a source of truth.
 */
export class VaultIndex {
  private notes = new Map<string, NoteRecord>();
  private files = new Set<string>();
  private resolver = new LinkResolver();
  /** source -> resolved target paths (with duplicates collapsed) */
  private outgoing = new Map<string, Set<string>>();
  /** target path -> sources */
  private incoming = new Map<string, Set<string>>();
  /** unresolved target (lowercase) -> sources */
  private unresolved = new Map<string, Set<string>>();
  readonly search = new SearchIndex();

  clear() {
    this.notes.clear();
    this.files.clear();
    this.outgoing.clear();
    this.incoming.clear();
    this.unresolved.clear();
    this.search.clear();
    this.resolver.rebuild([], new Map());
  }

  /** Replace the known file list (all files, not just notes). */
  setFiles(paths: Iterable<string>) {
    this.files = new Set(paths);
    for (const p of [...this.notes.keys()]) if (!this.files.has(p)) this.removeNote(p, false);
    this.relinkAll();
  }

  upsert(path: string, content: string) {
    if (!isMarkdown(path)) return;
    const prev = this.notes.get(path);
    if (prev && prev.content === content) return;
    const parsed = parseNote(path, content);
    const newFile = !this.files.has(path);
    this.files.add(path);
    this.notes.set(path, { content, parsed });
    this.search.add(path, parsed.title, content, parsed.allTags, parsed.frontmatter);
    const aliasesChanged = (prev?.parsed.aliases.join("\0") ?? "") !== parsed.aliases.join("\0");
    if (newFile || aliasesChanged) this.relinkAll();
    else this.relink(path);
  }

  /** Bulk load without relinking after each note. */
  load(files: Iterable<string>, notes: { path: string; content: string }[]) {
    this.clear();
    this.files = new Set(files);
    for (const n of notes) {
      if (!isMarkdown(n.path)) continue;
      const parsed = parseNote(n.path, n.content);
      this.files.add(n.path);
      this.notes.set(n.path, { content: n.content, parsed });
      this.search.add(n.path, parsed.title, n.content, parsed.allTags, parsed.frontmatter);
    }
    this.relinkAll();
  }

  remove(path: string) {
    this.files.delete(path);
    this.removeNote(path, true);
  }

  private removeNote(path: string, relink: boolean) {
    this.notes.delete(path);
    this.search.remove(path);
    this.clearEdges(path);
    if (relink) this.relinkAll();
  }

  private aliasMap(): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const [p, r] of this.notes) if (r.parsed.aliases.length) m.set(p, r.parsed.aliases);
    return m;
  }

  private relinkAll() {
    this.resolver.rebuild(this.files, this.aliasMap());
    this.outgoing.clear();
    this.incoming.clear();
    this.unresolved.clear();
    for (const p of this.notes.keys()) this.relink(p);
  }

  private clearEdges(path: string) {
    for (const t of this.outgoing.get(path) ?? []) this.incoming.get(t)?.delete(path);
    this.outgoing.delete(path);
    for (const set of this.unresolved.values()) set.delete(path);
  }

  private relink(path: string) {
    this.clearEdges(path);
    const rec = this.notes.get(path);
    if (!rec) return;
    const out = new Set<string>();
    for (const link of rec.parsed.links) {
      const target = this.resolveLink(link, path);
      if (target) {
        if (target === path) continue;
        out.add(target);
        let inc = this.incoming.get(target);
        if (!inc) this.incoming.set(target, (inc = new Set()));
        inc.add(path);
      } else if (link.target) {
        const key = link.target.toLowerCase();
        let s = this.unresolved.get(key);
        if (!s) this.unresolved.set(key, (s = new Set()));
        s.add(path);
      }
    }
    this.outgoing.set(path, out);
  }

  resolveLink(link: Pick<LinkRef, "target" | "kind">, source: string): string | null {
    return this.resolver.resolve(link.target, source, link.kind);
  }

  resolveTarget(target: string, source: string): string | null {
    return this.resolver.resolve(target, source, "wiki");
  }

  newNotePath(target: string, folder: string) {
    return this.resolver.newNotePath(target, folder);
  }

  get(path: string): ParsedNote | undefined {
    return this.notes.get(path)?.parsed;
  }

  content(path: string): string | undefined {
    return this.notes.get(path)?.content;
  }

  notePaths(): string[] {
    return [...this.notes.keys()].sort((a, b) => a.localeCompare(b));
  }

  allFiles(): string[] {
    return [...this.files];
  }

  hasFile(path: string) {
    return this.files.has(path);
  }

  backlinks(path: string): Backlink[] {
    const out: Backlink[] = [];
    for (const src of this.incoming.get(path) ?? []) {
      const rec = this.notes.get(src);
      if (!rec) continue;
      const lines = rec.content.split("\n");
      for (const link of rec.parsed.links) {
        if (this.resolveLink(link, src) !== path) continue;
        out.push({ source: src, link, context: lines[link.line]?.trim() ?? "" });
      }
    }
    return out.sort((a, b) => a.source.localeCompare(b.source) || a.link.from - b.link.from);
  }

  /** Plain-text mentions of this note's title or aliases in other notes that don't link to it there. */
  unlinkedMentions(path: string): (Mention & { source: string })[] {
    const rec = this.notes.get(path);
    if (!rec) return [];
    const names = [rec.parsed.title, ...rec.parsed.aliases];
    const candidates = new Set<string>();
    for (const n of names) if (n.trim().length >= 2) for (const h of this.search.search(`"${n.replace(/"/g, "")}"`, { limit: 2000 })) candidates.add(h.path);
    const out: (Mention & { source: string })[] = [];
    for (const source of [...candidates].sort()) {
      if (source === path) continue;
      const other = this.notes.get(source);
      if (!other) continue;
      for (const m of findMentions(other.content, names, other.parsed.links)) out.push({ ...m, source });
    }
    return out;
  }

  outgoingLinks(path: string): string[] {
    return [...(this.outgoing.get(path) ?? [])];
  }

  unresolvedLinks(path: string): string[] {
    const rec = this.notes.get(path);
    if (!rec) return [];
    return [...new Set(rec.parsed.links.filter((l) => l.target && !this.resolveLink(l, path)).map((l) => l.target))];
  }

  /** Map of lowercase tag -> note paths, with nested tags (`a/b`) also counted under `a`. */
  tags(): Map<string, string[]> {
    const m = new Map<string, Set<string>>();
    for (const [p, r] of this.notes) {
      for (const t of r.parsed.allTags) {
        let s = m.get(t);
        if (!s) m.set(t, (s = new Set()));
        s.add(p);
      }
    }
    return new Map([...m].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, [...v].sort()]));
  }

  notesWithTag(tag: string): string[] {
    const t = tag.toLowerCase().replace(/^#/, "");
    return this.notePaths().filter((p) =>
      this.notes.get(p)!.parsed.allTags.some((x) => x === t || x.startsWith(t + "/")),
    );
  }

  headingExists(path: string, heading: string): boolean {
    const slug = headingSlug(heading);
    return !!this.notes.get(path)?.parsed.headings.some((h) => headingSlug(h.text) === slug);
  }

  graph(includeUnresolved = false): GraphData {
    const degree = new Map<string, number>();
    const edges: GraphData["edges"] = [];
    for (const [src, targets] of this.outgoing) {
      for (const t of targets) {
        if (!this.notes.has(t) && !this.files.has(t)) continue;
        edges.push({ source: src, target: t });
        degree.set(src, (degree.get(src) ?? 0) + 1);
        degree.set(t, (degree.get(t) ?? 0) + 1);
      }
    }
    const nodes: GraphData["nodes"] = this.notePaths().map((p) => {
      const parsed = this.notes.get(p)!.parsed;
      return {
        id: p,
        label: parsed.title,
        tags: parsed.allTags,
        folder: p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "",
        unresolved: false,
        degree: degree.get(p) ?? 0,
      };
    });
    const known = new Set(nodes.map((n) => n.id));
    for (const e of edges) {
      if (!known.has(e.target)) {
        known.add(e.target);
        nodes.push({ id: e.target, label: e.target.split("/").pop()!, tags: [], folder: "", unresolved: false, degree: degree.get(e.target) ?? 0 });
      }
    }
    if (includeUnresolved) {
      for (const [target, sources] of this.unresolved) {
        if (!sources.size) continue;
        const id = `unresolved:${target}`;
        nodes.push({ id, label: target, tags: [], folder: "", unresolved: true, degree: sources.size });
        for (const s of sources) edges.push({ source: s, target: id });
      }
    }
    return { nodes, edges };
  }

  /** Neighbourhood of `path` up to `depth` hops, following links in both directions. */
  localGraph(path: string, depth = 1): GraphData {
    const full = this.graph(false);
    const keep = new Set([path]);
    let frontier = new Set([path]);
    for (let d = 0; d < depth; d++) {
      const next = new Set<string>();
      for (const e of full.edges) {
        if (frontier.has(e.source) && !keep.has(e.target)) next.add(e.target);
        if (frontier.has(e.target) && !keep.has(e.source)) next.add(e.source);
      }
      next.forEach((n) => keep.add(n));
      frontier = next;
    }
    return {
      nodes: full.nodes.filter((n) => keep.has(n.id)),
      edges: full.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    };
  }
}
