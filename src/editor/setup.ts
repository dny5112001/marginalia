import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  MatchDecorator,
  placeholder,
  ViewPlugin,
  type ViewUpdate,
  dropCursor,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";
import { splitWikiTarget } from "../links/parse";
import { frontmatter } from "./frontmatter";

export const lineNumbersComp = new Compartment();
export const wrapComp = new Compartment();
export const fontComp = new Compartment();

const highlight = HighlightStyle.define([
  { tag: t.heading1, class: "md-h md-h1" },
  { tag: t.heading2, class: "md-h md-h2" },
  { tag: t.heading3, class: "md-h md-h3" },
  { tag: [t.heading4, t.heading5, t.heading6], class: "md-h md-h4" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, class: "md-link" },
  { tag: t.url, class: "md-url" },
  { tag: t.monospace, class: "md-code" },
  { tag: t.quote, class: "md-quote" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], class: "md-meta" },
  { tag: [t.keyword, t.operatorKeyword, t.modifier], class: "tok-keyword" },
  { tag: [t.string, t.special(t.string), t.regexp], class: "tok-string" },
  { tag: [t.number, t.bool, t.null, t.atom], class: "tok-number" },
  { tag: [t.comment, t.lineComment, t.blockComment], class: "tok-comment" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: "tok-fn" },
  { tag: [t.typeName, t.className, t.namespace], class: "tok-type" },
  { tag: [t.propertyName, t.attributeName], class: "tok-prop" },
  { tag: [t.tagName], class: "tok-tag" },
]);

const wikilinkDeco = new MatchDecorator({
  regexp: /!?\[\[[^[\]\n]+?\]\]/g,
  decoration: () => Decoration.mark({ class: "cm-wikilink" }),
});
const tagDeco = new MatchDecorator({
  regexp: /(?<=^|[\s(,;])#[\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*/gu,
  decoration: () => Decoration.mark({ class: "cm-hashtag" }),
});

function decoPlugin(dec: MatchDecorator) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = dec.createDeco(view);
      }
      update(u: ViewUpdate) {
        this.decorations = dec.updateDeco(u, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/** Find the wikilink or markdown link under `pos`. */
export function linkAt(state: EditorState, pos: number): { target: string; heading?: string; kind: "wiki" | "markdown" } | null {
  const line = state.doc.lineAt(pos);
  const col = pos - line.from;
  const wiki = /!?\[\[([^[\]\n]+?)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = wiki.exec(line.text))) {
    if (col >= m.index && col <= m.index + m[0].length) {
      const { target, heading } = splitWikiTarget(m[1]);
      return { target, heading, kind: "wiki" };
    }
  }
  const md = /!?\[[^\]\n]*\]\(([^)\s]+)\)/g;
  while ((m = md.exec(line.text))) {
    if (col >= m.index && col <= m.index + m[0].length) {
      const url = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return { target: url, kind: "markdown" };
      let decoded = url;
      try {
        decoded = decodeURI(url);
      } catch {
        /* raw */
      }
      const [target, heading] = decoded.split("#");
      return { target, heading, kind: "markdown" };
    }
  }
  return null;
}

export interface EditorHooks {
  onChange(content: string): void;
  onSelection?(info: { line: number; col: number; selected: number }): void;
  onFollowLink(link: { target: string; heading?: string; kind: "wiki" | "markdown" }, newTab: boolean): void;
  noteNames(): { label: string; detail: string }[];
  headingsFor(target: string): string[];
  onSave(): void;
}

function wikilinkCompletion(hooks: EditorHooks) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const open = before.lastIndexOf("[[");
    if (open === -1 || before.slice(open).includes("]]")) return null;
    const inner = before.slice(open + 2);
    if (inner.includes("|")) return null;
    const after = line.text.slice(ctx.pos - line.from);
    const closing = after.startsWith("]]") ? "" : "]]";
    const hash = inner.indexOf("#");
    if (hash !== -1) {
      const target = inner.slice(0, hash);
      const from = line.from + open + 2 + hash + 1;
      return {
        from,
        options: hooks.headingsFor(target).map((h) => ({ label: h, type: "text", apply: h + closing })),
        validFor: /^[^\]|#]*$/,
      };
    }
    const from = line.from + open + 2;
    return {
      from,
      options: hooks.noteNames().map((n) => ({ label: n.label, detail: n.detail, type: "file", apply: n.label + closing })),
      validFor: /^[^\]|#]*$/,
    };
  };
}

function wrapSelection(marker: string) {
  return (view: EditorView) => {
    view.dispatch(
      view.state.changeByRange((range) => {
        const text = view.state.sliceDoc(range.from, range.to);
        const m = marker.length;
        const outer = view.state.sliceDoc(range.from - m, range.to + m);
        if (outer.startsWith(marker) && outer.endsWith(marker) && outer.length >= 2 * m) {
          return {
            changes: [
              { from: range.from - m, to: range.from, insert: "" },
              { from: range.to, to: range.to + m, insert: "" },
            ],
            range: EditorSelection.range(range.from - m, range.to - m),
          };
        }
        return {
          changes: { from: range.from, to: range.to, insert: marker + text + marker },
          range: EditorSelection.range(range.from + m, range.to + m),
        };
      }),
    );
    return true;
  };
}

/** Toggle `- [ ]` / `- [x]` on the current line(s), adding a checkbox if missing. */
export function toggleChecklist(view: EditorView) {
  const changes = [];
  const seen = new Set<number>();
  for (const r of view.state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = view.state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const m = /^(\s*)([-*+]|\d+[.)])\s+\[( |x|X)\]\s/.exec(line.text);
        if (m) {
          const at = line.from + m[0].indexOf("[") + 1;
          changes.push({ from: at, to: at + 1, insert: m[3] === " " ? "x" : " " });
        } else {
          const lm = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line.text);
          if (lm) changes.push({ from: line.from + lm[0].length, insert: "[ ] " });
          else {
            const indent = /^\s*/.exec(line.text)![0].length;
            changes.push({ from: line.from + indent, insert: "- [ ] " });
          }
        }
      }
      pos = line.to + 1;
    }
  }
  view.dispatch({ changes });
  return true;
}

function insertLink(view: EditorView) {
  const r = view.state.selection.main;
  const text = view.state.sliceDoc(r.from, r.to);
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: `[[${text}]]` },
    selection: { anchor: r.from + 2, head: r.from + 2 + text.length },
  });
  return true;
}

export function fontTheme(size: number) {
  return EditorView.theme({ "&": { fontSize: `${size}px` } });
}

export function createExtensions(
  hooks: EditorHooks,
  opts: { lineNumbers: boolean; wrap: boolean; fontSize: number },
): Extension[] {
  return [
    lineNumbersComp.of(opts.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
    wrapComp.of(opts.wrap ? EditorView.lineWrapping : []),
    fontComp.of(fontTheme(opts.fontSize)),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true, extensions: [frontmatter] }),
    syntaxHighlighting(highlight),
    decoPlugin(wikilinkDeco),
    decoPlugin(tagDeco),
    autocompletion({ override: [wikilinkCompletion(hooks)], activateOnTyping: true, icons: false }),
    placeholder("Start writing…"),
    EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "on", "aria-label": "Note editor" }),
    keymap.of([
      { key: "Mod-s", run: () => (hooks.onSave(), true), preventDefault: true },
      { key: "Mod-b", run: wrapSelection("**") },
      { key: "Mod-i", run: wrapSelection("*") },
      { key: "Mod-Shift-x", run: wrapSelection("~~") },
      { key: "Mod-`", run: wrapSelection("`") },
      { key: "Mod-l", run: toggleChecklist },
      { key: "Mod-k", run: insertLink },
      {
        key: "Mod-Enter",
        run: (view) => {
          const l = linkAt(view.state, view.state.selection.main.head);
          if (!l) return false;
          hooks.onFollowLink(l, false);
          return true;
        },
      },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;
        const l = linkAt(view.state, pos);
        if (!l) return false;
        e.preventDefault();
        hooks.onFollowLink(l, e.altKey || e.shiftKey);
        return true;
      },
    }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) hooks.onChange(u.state.doc.toString());
      if ((u.selectionSet || u.docChanged) && hooks.onSelection) {
        const r = u.state.selection.main;
        const line = u.state.doc.lineAt(r.head);
        hooks.onSelection({ line: line.number, col: r.head - line.from + 1, selected: Math.abs(r.to - r.from) });
      }
    }),
  ];
}

export function reconfigure(view: EditorView, opts: { lineNumbers: boolean; wrap: boolean; fontSize: number }) {
  view.dispatch({
    effects: [
      lineNumbersComp.reconfigure(opts.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
      wrapComp.reconfigure(opts.wrap ? EditorView.lineWrapping : []),
      fontComp.reconfigure(fontTheme(opts.fontSize)),
    ],
  });
}
