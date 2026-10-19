import type { SearchHit } from "../types";

/**
 * Local full-text search: an inverted index over note titles and bodies.
 * Supports multiple terms (AND), prefix matching on every term, quoted
 * phrases, and the filters `tag:foo`, `path:folder`, `file:name`.
 */

export function tokenize(text: string): string[] {
  return normalize(text).match(/[\p{L}\p{N}_]+/gu) ?? [];
}

export function normalize(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}

interface DocEntry {
  title: string;
  content: string;
  tags: string[];
  termCount: number;
  terms: string[];
}

export interface ParsedQuery {
  terms: string[];
  phrases: string[];
  tags: string[];
  paths: string[];
  files: string[];
}

export function parseQuery(query: string): ParsedQuery {
  const q: ParsedQuery = { terms: [], phrases: [], tags: [], paths: [], files: [] };
  const re = /(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]+)"|(#[\p{L}\p{N}_\-/]+)|(\S+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    const key = (m[1] ?? m[3])?.toLowerCase();
    const val = m[2] ?? m[4];
    if (key === "tag") q.tags.push(val.replace(/^#/, "").toLowerCase());
    else if (key === "path") q.paths.push(normalize(val));
    else if (key === "file") q.files.push(normalize(val));
    else if (m[5]) q.phrases.push(normalize(m[5]));
    else if (m[6]) q.tags.push(m[6].slice(1).toLowerCase());
    else {
      const raw = key ? `${key}:${val}` : m[7];
      q.terms.push(...tokenize(raw));
    }
  }
  return q;
}

export class SearchIndex {
  private docs = new Map<string, DocEntry>();
  private postings = new Map<string, Map<string, number>>();
  private titleTokens = new Map<string, Set<string>>();
  private sortedTerms: string[] | null = null;

  get size() {
    return this.docs.size;
  }

  clear() {
    this.docs.clear();
    this.postings.clear();
    this.titleTokens.clear();
    this.sortedTerms = null;
  }

  add(path: string, title: string, content: string, tags: string[] = []) {
    this.remove(path);
    const tokens = tokenize(content);
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    const titleToks = new Set([...tokenize(title), ...tokenize(path)]);
    for (const t of titleToks) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const [t, c] of counts) {
      let p = this.postings.get(t);
      if (!p) {
        this.postings.set(t, (p = new Map()));
        this.sortedTerms = null;
      }
      p.set(path, c);
    }
    this.titleTokens.set(path, titleToks);
    this.docs.set(path, { title, content, tags, termCount: tokens.length, terms: [...counts.keys()] });
  }

  remove(path: string) {
    const doc = this.docs.get(path);
    if (!doc) return;
    for (const t of doc.terms) {
      const p = this.postings.get(t);
      if (p && p.delete(path) && p.size === 0) {
        this.postings.delete(t);
        this.sortedTerms = null;
      }
    }
    this.titleTokens.delete(path);
    this.docs.delete(path);
  }

  private expand(term: string): string[] {
    if (!this.sortedTerms) this.sortedTerms = [...this.postings.keys()].sort();
    const arr = this.sortedTerms;
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < term) lo = mid + 1;
      else hi = mid;
    }
    const out: string[] = [];
    for (let i = lo; i < arr.length && arr[i].startsWith(term); i++) out.push(arr[i]);
    return out;
  }

  search(query: string, limit = 100): SearchHit[] {
    const q = parseQuery(query);
    if (!q.terms.length && !q.phrases.length && !q.tags.length && !q.paths.length && !q.files.length) return [];

    let candidates: Map<string, number> | null = null;
    const matchedTerms: string[] = [];
    for (const term of q.terms) {
      const scores = new Map<string, number>();
      for (const full of this.expand(term)) {
        matchedTerms.push(full);
        const exact = full === term ? 1 : 0.6;
        for (const [path, count] of this.postings.get(full)!) {
          const titleBoost = this.titleTokens.get(path)?.has(full) ? 4 : 1;
          const doc = this.docs.get(path)!;
          const tf = count / Math.sqrt(doc.termCount + 1);
          scores.set(path, (scores.get(path) ?? 0) + (tf * 10 + 1) * exact * titleBoost);
        }
      }
      if (!candidates) candidates = scores;
      else {
        const next = new Map<string, number>();
        for (const [p, s] of candidates) {
          const add = scores.get(p);
          if (add !== undefined) next.set(p, s + add);
        }
        candidates = next;
      }
      if (candidates.size === 0) return [];
    }
    if (!candidates) candidates = new Map([...this.docs.keys()].map((p) => [p, 1]));

    const ranked: { path: string; score: number }[] = [];
    for (const [path, score] of candidates) {
      const doc = this.docs.get(path)!;
      const lowerPath = normalize(path);
      if (q.paths.length && !q.paths.every((p) => lowerPath.includes(p))) continue;
      if (q.files.length && !q.files.every((f) => normalize(doc.title).includes(f))) continue;
      if (q.tags.length && !q.tags.every((t) => doc.tags.some((x) => x === t || x.startsWith(t + "/")))) continue;
      if (q.phrases.length) {
        const normContent = normalize(doc.content);
        if (!q.phrases.every((ph) => normContent.includes(ph) || normalize(doc.title).includes(ph))) continue;
      }
      ranked.push({ path, score: score + (q.phrases.length ? 5 : 0) });
    }
    ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    // Snippets are comparatively expensive, so only build them for returned hits.
    const needles = [...q.phrases, ...new Set(matchedTerms)];
    return ranked.slice(0, limit).map(({ path, score }) => {
      const doc = this.docs.get(path)!;
      return { path, title: doc.title, score, snippets: makeSnippets(doc.content, needles) };
    });
  }
}

/**
 * Build up to 3 snippets around matches. Matching runs on a normalized copy;
 * because NFKD can change lengths, we map offsets via a per-char index.
 */
export function makeSnippets(content: string, needles: string[], max = 3, radius = 60) {
  const out: { text: string; ranges: [number, number][] }[] = [];
  if (!needles.length) {
    const text = content.replace(/^---[\s\S]*?\n---\s*/, "").slice(0, radius * 2).trim();
    return text ? [{ text, ranges: [] }] : [];
  }
  const { norm, map } = normalizeWithMap(content);
  const uniq = [...new Set(needles.filter(Boolean))].sort((a, b) => b.length - a.length);
  const positions: [number, number][] = [];
  for (const n of uniq) {
    let i = norm.indexOf(n);
    let guard = 0;
    while (i !== -1 && guard++ < 50) {
      // Only whole-word starts for single tokens.
      const prev = norm[i - 1];
      if (!prev || !/[\p{L}\p{N}_]/u.test(prev)) positions.push([map[i], map[i + n.length - 1] + 1]);
      i = norm.indexOf(n, i + n.length);
    }
  }
  positions.sort((a, b) => a[0] - b[0]);
  let lastEnd = -1;
  for (const [s] of positions) {
    if (out.length >= max) break;
    if (s < lastEnd) continue;
    let start = Math.max(0, s - radius);
    let end = Math.min(content.length, s + radius * 2);
    const lineStart = content.lastIndexOf("\n", s - 1) + 1;
    const lineEnd = content.indexOf("\n", s);
    start = Math.max(start, lineStart);
    if (lineEnd !== -1) end = Math.min(end, lineEnd);
    const text = content.slice(start, end);
    const ranges: [number, number][] = positions
      .filter(([a, b]) => a >= start && b <= end)
      .map(([a, b]) => [a - start, b - start]);
    out.push({ text: (start > lineStart ? "…" : "") + text, ranges: start > lineStart ? ranges.map(([a, b]) => [a + 1, b + 1]) : ranges });
    lastEnd = end;
  }
  return out;
}

function normalizeWithMap(content: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < content.length; i++) {
    const n = normalize(content[i]);
    for (let k = 0; k < n.length; k++) map.push(i);
    norm += n;
  }
  return { norm, map };
}
