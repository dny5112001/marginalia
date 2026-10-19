/**
 * Search query language (parser + matcher), modelled on the operators commonly
 * used in Markdown knowledge bases:
 *
 *   word  "exact phrase"  /regex/  -exclude  a OR b  (grouping)
 *   tag:#x  path:dir  file:name  content:text
 *   line:(a b)  section:(a b)  block:(a b)  task:x  task-todo:x  task-done:x
 *   [property]  [property:value]
 *
 * Space means AND; OR binds looser than AND. Pure functions, no I/O.
 */

export type Scope = "line" | "section" | "block" | "task" | "task-todo" | "task-done";
export type Field = "tag" | "path" | "file" | "content";

export type Clause =
  | { kind: "term"; value: string; neg: boolean }
  | { kind: "phrase"; value: string; neg: boolean }
  | { kind: "regex"; source: string; neg: boolean }
  | { kind: "field"; field: Field; value: string; neg: boolean }
  | { kind: "scope"; scope: Scope; query: Query; neg: boolean }
  | { kind: "prop"; key: string; value?: string; neg: boolean }
  | { kind: "group"; query: Query; neg: boolean };

/** OR of AND-groups. */
export type Query = Clause[][];

const FIELDS = new Set(["tag", "path", "file", "content"]);
const SCOPES = new Set(["line", "section", "block", "task", "task-todo", "task-done"]);

export function normalize(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}

class Lexer {
  i = 0;
  constructor(readonly s: string) {}
  peek() {
    return this.s[this.i];
  }
  eof() {
    this.skipWs();
    return this.i >= this.s.length;
  }
  skipWs() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  readUntil(close: string): string {
    const start = this.i;
    while (this.i < this.s.length && this.s[this.i] !== close) {
      if (this.s[this.i] === "\\" && close === "/") this.i++;
      this.i++;
    }
    const out = this.s.slice(start, this.i);
    this.i++; // skip close (or step past end)
    return out;
  }
  readWord(): string {
    const start = this.i;
    while (this.i < this.s.length && !/[\s()]/.test(this.s[this.i])) this.i++;
    return this.s.slice(start, this.i);
  }
}

export function parseSearch(input: string): Query {
  const lx = new Lexer(input);
  const q = parseOr(lx, false);
  return q.filter((g) => g.length > 0);
}

function parseOr(lx: Lexer, nested: boolean): Query {
  const groups: Clause[][] = [[]];
  while (!lx.eof()) {
    if (nested && lx.peek() === ")") {
      lx.i++;
      break;
    }
    if (lx.s.startsWith("OR", lx.i) && /[\s(]|$/.test(lx.s[lx.i + 2] ?? "")) {
      lx.i += 2;
      groups.push([]);
      continue;
    }
    const c = parseClause(lx);
    if (c) groups[groups.length - 1].push(c);
  }
  return groups;
}

function parseValue(lx: Lexer): { value: string; quoted: boolean } {
  if (lx.peek() === '"') {
    lx.i++;
    return { value: lx.readUntil('"'), quoted: true };
  }
  return { value: lx.readWord(), quoted: false };
}

function parseClause(lx: Lexer): Clause | null {
  lx.skipWs();
  let neg = false;
  if (lx.peek() === "-" && lx.s[lx.i + 1] && !/\s/.test(lx.s[lx.i + 1])) {
    neg = true;
    lx.i++;
  }
  const ch = lx.peek();
  if (ch === "(") {
    lx.i++;
    return { kind: "group", query: parseOr(lx, true), neg };
  }
  if (ch === '"') {
    lx.i++;
    const value = lx.readUntil('"');
    return value ? { kind: "phrase", value, neg } : null;
  }
  if (ch === "/") {
    const save = lx.i;
    lx.i++;
    const end = lx.s.indexOf("/", lx.i);
    if (end > lx.i) {
      const source = lx.readUntil("/");
      return { kind: "regex", source, neg };
    }
    lx.i = save;
  }
  if (ch === "[") {
    lx.i++;
    const inner = lx.readUntil("]");
    const colon = inner.indexOf(":");
    const key = (colon === -1 ? inner : inner.slice(0, colon)).trim();
    const value = colon === -1 ? undefined : inner.slice(colon + 1).trim().replace(/^"|"$/g, "");
    return key ? { kind: "prop", key, value: value || undefined, neg } : null;
  }
  // key:value
  const m = /^([a-z-]+):/i.exec(lx.s.slice(lx.i));
  if (m && (FIELDS.has(m[1].toLowerCase()) || SCOPES.has(m[1].toLowerCase()))) {
    const key = m[1].toLowerCase();
    lx.i += m[0].length;
    if (SCOPES.has(key)) {
      let query: Query;
      if (lx.peek() === "(") {
        lx.i++;
        query = parseOr(lx, true);
      } else {
        const { value, quoted } = parseValue(lx);
        query = value ? [[quoted ? { kind: "phrase", value, neg: false } : { kind: "term", value, neg: false }]] : [[]];
      }
      return { kind: "scope", scope: key as Scope, query, neg };
    }
    const { value } = parseValue(lx);
    if (!value) return null;
    return { kind: "field", field: key as Field, value: key === "tag" ? value.replace(/^#/, "") : value, neg };
  }
  if (ch === "#") {
    const word = lx.readWord();
    return word.length > 1 ? { kind: "field", field: "tag", value: word.slice(1), neg } : null;
  }
  const word = lx.readWord();
  if (!word) {
    lx.i++;
    return null;
  }
  return { kind: "term", value: word, neg };
}

/** Text a clause tree is evaluated against. */
export interface MatchContext {
  title: string;
  path: string;
  content: string;
  tags: string[];
  props: Record<string, unknown> | null;
  matchCase: boolean;
}

function isWordChar(c: string | undefined) {
  return !!c && /[\p{L}\p{N}_]/u.test(c);
}

function containsWordStart(hay: string, needle: string): boolean {
  let i = hay.indexOf(needle);
  while (i !== -1) {
    if (!isWordChar(hay[i - 1])) return true;
    i = hay.indexOf(needle, i + 1);
  }
  return false;
}

function prep(ctx: MatchContext, s: string) {
  return ctx.matchCase ? s : normalize(s);
}

function propString(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(propString).join(" ");
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function compileRegex(source: string, matchCase: boolean): RegExp | null {
  try {
    return new RegExp(source, matchCase ? "mu" : "imu");
  } catch {
    return null;
  }
}

function units(scope: Scope, content: string): string[] {
  const lines = content.split("\n");
  switch (scope) {
    case "line":
      return lines;
    case "task":
    case "task-todo":
    case "task-done": {
      const re = scope === "task" ? /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s/ : scope === "task-todo" ? /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s/ : /^\s*(?:[-*+]|\d+[.)])\s+\[[^ ]\]\s/;
      return lines.filter((l) => re.test(l)).map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s/, ""));
    }
    case "block":
      return content.split(/\n\s*\n/);
    case "section": {
      const out: string[] = [];
      let cur: string[] = [];
      for (const l of lines) {
        if (/^#{1,6}\s/.test(l) && cur.length) {
          out.push(cur.join("\n"));
          cur = [];
        }
        cur.push(l);
      }
      out.push(cur.join("\n"));
      return out;
    }
  }
}

export function matchQuery(q: Query, ctx: MatchContext): boolean {
  if (q.length === 0) return false;
  return q.some((group) => group.length > 0 && group.every((c) => matchClause(c, ctx) !== c.neg));
}

function matchClause(c: Clause, ctx: MatchContext): boolean {
  const all = `${ctx.title}\n${ctx.path}\n${ctx.content}`;
  switch (c.kind) {
    case "term":
      return containsWordStart(prep(ctx, all), prep(ctx, c.value));
    case "phrase":
      return prep(ctx, all).includes(prep(ctx, c.value));
    case "regex": {
      const re = compileRegex(c.source, ctx.matchCase);
      return !!re && re.test(ctx.content);
    }
    case "field": {
      if (c.field === "tag") {
        const t = c.value.toLowerCase();
        return ctx.tags.some((x) => x === t || x.startsWith(t + "/"));
      }
      if (c.field === "path") return prep(ctx, ctx.path).includes(prep(ctx, c.value));
      if (c.field === "file") return prep(ctx, ctx.title).includes(prep(ctx, c.value));
      return prep(ctx, ctx.content).includes(prep(ctx, c.value));
    }
    case "prop": {
      const props = ctx.props ?? {};
      const key = Object.keys(props).find((k) => k.toLowerCase() === c.key.toLowerCase());
      if (key === undefined) return false;
      if (c.value === undefined) return true;
      return prep(ctx, propString(props[key])).includes(prep(ctx, c.value));
    }
    case "group":
      return matchQuery(c.query, ctx);
    case "scope":
      return units(c.scope, ctx.content).some((u) => matchQuery(c.query, { ...ctx, title: "", path: "", content: u }));
  }
}

/** Positive top-level words per OR-group, used to pick candidates from the inverted index. */
export function candidateTerms(q: Query): (string[] | null)[] {
  return q.map((group) => {
    const words = group.filter((c) => c.kind === "term" && !c.neg).map((c) => (c as { value: string }).value);
    return words.length ? words : null;
  });
}

/** Strings worth highlighting in snippets. */
export function highlightNeedles(q: Query): string[] {
  const out: string[] = [];
  const walk = (query: Query) => {
    for (const g of query)
      for (const c of g) {
        if (c.neg) continue;
        if (c.kind === "term" || c.kind === "phrase") out.push(c.value);
        else if (c.kind === "field" && c.field === "content") out.push(c.value);
        else if (c.kind === "scope" || c.kind === "group") walk(c.query);
      }
  };
  walk(q);
  return out;
}

export function regexSources(q: Query): string[] {
  const out: string[] = [];
  const walk = (query: Query) => {
    for (const g of query) for (const c of g) if (!c.neg && c.kind === "regex") out.push(c.source);
      else if (!c.neg && (c.kind === "scope" || c.kind === "group")) walk(c.query);
  };
  walk(q);
  return out;
}

/** Human-readable explanation of a query ("Explain search terms"). */
export function explainQuery(q: Query, indent = ""): string[] {
  if (q.length === 0) return [];
  const lines: string[] = [];
  if (q.length > 1) lines.push(`${indent}Match any of:`);
  for (const group of q) {
    const ind = q.length > 1 ? indent + "  " : indent;
    if (group.length > 1) lines.push(`${ind}Match all of:`);
    for (const c of group) lines.push(...explainClause(c, group.length > 1 ? ind + "  " : ind));
  }
  return lines;
}

function explainClause(c: Clause, ind: string): string[] {
  const not = c.neg ? "Excluding: " : "";
  switch (c.kind) {
    case "term":
      return [`${ind}${not}Matches text: "${c.value}"`];
    case "phrase":
      return [`${ind}${not}Contains exact text: "${c.value}"`];
    case "regex":
      return [`${ind}${not}Matches regex: /${c.source}/${compileRegex(c.source, false) ? "" : " (invalid)"}`];
    case "field":
      return [`${ind}${not}${{ tag: "Has tag", path: "File path contains", file: "File name contains", content: "File content contains" }[c.field]}: "${c.value}"`];
    case "prop":
      return [`${ind}${not}Has property "${c.key}"${c.value !== undefined ? ` containing "${c.value}"` : ""}`];
    case "group":
      return [`${ind}${not}Group:`, ...explainQuery(c.query, ind + "  ")];
    case "scope":
      return [`${ind}${not}In the same ${c.scope.replace("task-todo", "open task").replace("task-done", "completed task")}:`, ...explainQuery(c.query, ind + "  ")];
  }
}
