import { normalize } from "./searchIndex";

/**
 * Subsequence fuzzy match used by the quick switcher and command palette.
 * Returns null for no match, or a score (higher is better) with matched indices.
 */
export function fuzzyMatch(query: string, text: string): { score: number; indices: number[] } | null {
  const q = normalize(query).replace(/\s+/g, "");
  if (!q) return { score: 0, indices: [] };
  // Highlight indices may be slightly off for text whose normalization changes length.
  return fuzzyPlain(q, normalize(text));
}

function fuzzyPlain(q: string, t: string) {
  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    // Prefer a match at a word boundary ahead of the cursor.
    for (let k = ti; k < t.length; k++) {
      if (t[k] === ch && (k === 0 || /[\s/_\-.]/.test(t[k - 1]))) {
        found = k;
        break;
      }
    }
    const next = t.indexOf(ch, ti);
    if (found === -1 || (next !== -1 && next === prev + 1)) found = next;
    if (found === -1) return null;
    const boundary = found === 0 || /[\s/_\-.]/.test(t[found - 1]);
    score += 1 + (found === prev + 1 ? 3 : 0) + (boundary ? 2 : 0);
    indices.push(found);
    prev = found;
    ti = found + 1;
  }
  // Shorter targets and earlier first matches rank higher; exact prefix gets a bonus.
  score -= t.length * 0.02 + indices[0] * 0.1;
  if (t.startsWith(q)) score += 5;
  return { score, indices };
}

export function fuzzyFilter<T>(query: string, items: T[], key: (item: T) => string, limit = 50) {
  const out: { item: T; score: number; indices: number[] }[] = [];
  for (const item of items) {
    const m = fuzzyMatch(query, key(item));
    if (m) out.push({ item, ...m });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
