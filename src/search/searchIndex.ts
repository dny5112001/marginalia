import type { SearchHit } from "../types";
import { candidateTerms, highlightNeedles, matchQuery, normalize, parseSearch, regexSources } from "./query";

export { normalize };

/**
 * Local full-text search: an inverted index over note titles and bodies picks
 * candidates, then the query language in `query.ts` verifies each one.
 */

export function tokenize(text: string): string[] {
  return normalize(text).match(/[\p{L}\p{N}_]+/gu) ?? [];
}


interface DocEntry {
  title: string;
  content: string;
  tags: string[];
  props: Record<string, unknown> | null;
  termCount: number;
  terms: string[];
}

export interface SearchOptions {
  limit?: number;
  matchCase?: boolean;
  sort?: "relevance" | "name-asc" | "name-desc" | "path";
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

  add(path: string, title: string, content: string, tags: string[] = [], props: Record<string, unknown> | null = null) {
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
    this.docs.set(path, { title, content, tags, props, termCount: tokens.length, terms: [...counts.keys()] });
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

  /** Score of `term` (a raw query word) for each document containing all of its tokens as prefixes. */
  private termScores(term: string): Map<string, number> {
    let result: Map<string, number> | null = null;
    for (const tok of tokenize(term)) {
      const scores = new Map<string, number>();
      for (const full of this.expand(tok)) {
        const exact = full === tok ? 1 : 0.6;
        for (const [path, count] of this.postings.get(full)!) {
          const titleBoost = this.titleTokens.get(path)?.has(full) ? 4 : 1;
          const doc = this.docs.get(path)!;
          const tf = count / Math.sqrt(doc.termCount + 1);
          scores.set(path, (scores.get(path) ?? 0) + (tf * 10 + 1) * exact * titleBoost);
        }
      }
      if (!result) result = scores;
      else {
        const next = new Map<string, number>();
        for (const [p, s] of result) if (scores.has(p)) next.set(p, s + scores.get(p)!);
        result = next;
      }
    }
    return result ?? new Map();
  }

  search(query: string, opts: SearchOptions | number = {}): SearchHit[] {
    const { limit = 100, matchCase = false, sort = "relevance" } = typeof opts === "number" ? { limit: opts } : opts;
    const q = parseSearch(query);
    if (q.length === 0) return [];

    // 1. Candidates: union over OR-groups; groups with positive words use the inverted index.
    const scored = new Map<string, number>();
    for (const words of candidateTerms(q)) {
      if (!words) {
        for (const p of this.docs.keys()) if (!scored.has(p)) scored.set(p, 1);
        continue;
      }
      let group: Map<string, number> | null = null;
      for (const w of words) {
        const s = this.termScores(w);
        if (!group) group = s;
        else {
          const next = new Map<string, number>();
          for (const [p, v] of group) if (s.has(p)) next.set(p, v + s.get(p)!);
          group = next;
        }
        if (group.size === 0) break;
      }
      for (const [p, v] of group ?? []) scored.set(p, Math.max(scored.get(p) ?? 0, v));
    }

    // 2. Verify every candidate against the full query (phrases, scopes, exclusions, regex…).
    const ranked: { path: string; score: number }[] = [];
    for (const [path, score] of scored) {
      const doc = this.docs.get(path)!;
      if (matchQuery(q, { title: doc.title, path, content: doc.content, tags: doc.tags, props: doc.props, matchCase })) ranked.push({ path, score });
    }
    ranked.sort((a, b) => {
      const byName = this.docs.get(a.path)!.title.localeCompare(this.docs.get(b.path)!.title, undefined, { numeric: true, sensitivity: "base" });
      if (sort === "name-asc") return byName || a.path.localeCompare(b.path);
      if (sort === "name-desc") return -byName || b.path.localeCompare(a.path);
      if (sort === "path") return a.path.localeCompare(b.path);
      return b.score - a.score || a.path.localeCompare(b.path);
    });

    // 3. Snippets only for returned hits; they are comparatively expensive.
    const needles = highlightNeedles(q).map((n) => (matchCase ? n : normalize(n)));
    const regexes = regexSources(q);
    return ranked.slice(0, limit).map(({ path, score }) => {
      const doc = this.docs.get(path)!;
      return { path, title: doc.title, score, snippets: makeSnippets(doc.content, needles, 3, 60, regexes, matchCase) };
    });
  }
}

/**
 * Build up to 3 snippets around matches. Matching runs on a normalized copy;
 * because NFKD can change lengths, we map offsets via a per-char index.
 */
export function makeSnippets(content: string, needles: string[], max = 3, radius = 60, regexes: string[] = [], matchCase = false) {
  const out: { text: string; ranges: [number, number][] }[] = [];
  if (!needles.length && !regexes.length) {
    const text = content.replace(/^---[\s\S]*?\n---\s*/, "").slice(0, radius * 2).trim();
    return text ? [{ text, ranges: [] }] : [];
  }
  const { norm, map } = matchCase ? { norm: content, map: [...content].map((_, i) => i).concat(content.length) } : normalizeWithMap(content);
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
  for (const src of regexes) {
    let re: RegExp;
    try {
      re = new RegExp(src, matchCase ? "gmu" : "gimu");
    } catch {
      continue;
    }
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(content)) && guard++ < 50) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      positions.push([m.index, m.index + m[0].length]);
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
