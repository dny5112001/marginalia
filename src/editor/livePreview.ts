import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { splitWikiTarget } from "../links/parse";

/**
 * Live Preview: Markdown syntax is hidden and rendered inline everywhere except
 * on lines that hold a cursor or selection, where the raw source is shown for
 * editing. The document text is never changed by this extension.
 */

export interface LivePreviewHooks {
  followLink(link: { target: string; heading?: string; kind: "wiki" | "markdown" }, newTab: boolean): void;
  loadImage(target: string, kind: "wiki" | "markdown"): Promise<string | null>;
}

const CODE_NODES = new Set(["InlineCode", "FencedCode", "CodeBlock", "Frontmatter", "HTMLBlock", "CommentBlock"]);

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) lines.add(n);
  }
  return lines;
}

function inCode(state: EditorState, pos: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (CODE_NODES.has(n.name)) return true;
  }
  return false;
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lp-task";
    box.checked = this.checked;
    box.setAttribute("aria-label", this.checked ? "Completed task" : "Open task");
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      const ch = view.state.sliceDoc(this.pos + 1, this.pos + 2);
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: ch === " " ? "x" : " " } });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-lp-bullet";
    s.textContent = "•";
    return s;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly kind: "wiki" | "markdown",
    readonly alt: string,
    readonly hooks: LivePreviewHooks,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.target === this.target && o.alt === this.alt;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-lp-image";
    const img = document.createElement("img");
    img.alt = this.alt;
    wrap.appendChild(img);
    if (/^https?:|^data:/i.test(this.target)) img.src = this.target;
    else
      void this.hooks.loadImage(this.target, this.kind).then((src) => {
        if (src) img.src = src;
        else {
          wrap.textContent = `Missing: ${this.target}`;
          wrap.classList.add("missing");
        }
      });
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "cm-lp-hr";
    return hr;
  }
}

const hide = Decoration.replace({});
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

function build(view: EditorView, hooks: LivePreviewHooks): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const decos: Range<Decoration>[] = [];
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        if (name === "Frontmatter" || name === "FencedCode" || name === "CodeBlock") return false;
        if (isActive(node.from)) {
          // Raw source on the cursor line; still let children of multi-line nodes be visited.
          if (state.doc.lineAt(node.from).number === state.doc.lineAt(node.to).number) return;
        }
        switch (name) {
          case "HeaderMark": {
            if (isActive(node.from)) return;
            const next = state.sliceDoc(node.to, node.to + 1);
            decos.push(hide.range(node.from, next === " " ? node.to + 1 : node.to));
            return;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
          case "CodeMark":
            if (!isActive(node.from) && node.to > node.from) decos.push(hide.range(node.from, node.to));
            return;
          case "QuoteMark":
            if (!isActive(node.from)) {
              const next = state.sliceDoc(node.to, node.to + 1);
              decos.push(hide.range(node.from, next === " " ? node.to + 1 : node.to));
              decos.push(Decoration.line({ class: "cm-lp-quote" }).range(state.doc.lineAt(node.from).from));
            }
            return;
          case "HorizontalRule":
            if (!isActive(node.from)) decos.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to));
            return;
          case "TaskMarker":
            if (!isActive(node.from)) {
              const checked = /x/i.test(state.sliceDoc(node.from, node.to));
              decos.push(Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, node.to));
              if (checked) {
                const line = state.doc.lineAt(node.from);
                if (node.to + 1 < line.to) decos.push(Decoration.mark({ class: "cm-lp-done" }).range(node.to + 1, line.to));
              }
            }
            return;
          case "ListMark": {
            if (isActive(node.from)) return;
            const mark = state.sliceDoc(node.from, node.to);
            const after = state.sliceDoc(node.to, node.to + 4);
            // Task items show only the checkbox; plain bullets get a dot.
            if (/^ \[[ xX]\]/.test(after)) decos.push(hide.range(node.from, node.to + 1));
            else if (mark === "-" || mark === "*" || mark === "+") decos.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
            return;
          }
          case "Image":
          case "Link": {
            if (isActive(node.from)) return false;
            const text = state.sliceDoc(node.from, node.to);
            const m = /^(!?)\[([^\]]*)\]\(\s*<?([^)>\s]+)>?(?:\s+"[^"]*")?\s*\)$/.exec(text);
            if (!m) return false;
            if (name === "Image") {
              decos.push(Decoration.replace({ widget: new ImageWidget(m[3], "markdown", m[2], hooks) }).range(node.from, node.to));
              return false;
            }
            const labelFrom = node.from + 1;
            const labelTo = labelFrom + m[2].length;
            decos.push(hide.range(node.from, labelFrom));
            if (labelTo > labelFrom)
              decos.push(Decoration.mark({ class: "cm-lp-link", attributes: { "data-href": m[3], "data-kind": "markdown" } }).range(labelFrom, labelTo));
            decos.push(hide.range(labelTo, node.to));
            return false;
          }
        }
      },
    });

    // Wikilinks and embeds are not part of the CommonMark grammar; find them by pattern.
    const text = state.sliceDoc(from, to);
    const re = /(!?)\[\[([^[\]\n]+?)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = from + m.index;
      const end = start + m[0].length;
      if (isActive(start) || inCode(state, start)) continue;
      const { target, heading, alias } = splitWikiTarget(m[2]);
      if (m[1] && IMAGE_EXT.test(target)) {
        decos.push(Decoration.replace({ widget: new ImageWidget(target, "wiki", alias ?? target, hooks) }).range(start, end));
        continue;
      }
      const innerFrom = start + m[1].length + 2;
      const pipe = m[2].indexOf("|");
      const shownFrom = pipe === -1 ? innerFrom : innerFrom + pipe + 1;
      const shownTo = end - 2;
      decos.push(hide.range(start, shownFrom));
      if (shownTo > shownFrom)
        decos.push(
          Decoration.mark({
            class: "cm-lp-link cm-lp-wikilink",
            attributes: { "data-target": target, "data-heading": heading ?? "", "data-kind": "wiki" },
          }).range(shownFrom, shownTo),
        );
      decos.push(hide.range(shownTo, end));
    }
  }
  return Decoration.set(decos, true);
}

/** Hide the frontmatter block in Live Preview; the Properties editor above the note shows it instead. */
const frontmatterField = StateField.define<DecorationSet>({
  create: (s) => frontmatterDeco(s),
  update: (deco, tr) => (tr.docChanged || tr.selection ? frontmatterDeco(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

function frontmatterDeco(state: EditorState): DecorationSet {
  const head = state.sliceDoc(0, Math.min(state.doc.length, 100_000));
  const m = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/.exec(head);
  if (!m) return Decoration.none;
  const end = m[0].length;
  // Reveal the YAML when the cursor is inside it (e.g. after undo), so it stays editable.
  if (state.selection.ranges.some((r) => r.from <= end)) return Decoration.none;
  const lineEnd = state.doc.lineAt(end).to;
  const to = lineEnd < state.doc.length ? lineEnd + 1 : lineEnd;
  return Decoration.set([Decoration.replace({ block: true }).range(0, to)]);
}

export function livePreview(hooks: LivePreviewHooks): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, hooks);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state))
          this.decorations = build(u.view, hooks);
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(e) {
          const el = (e.target as HTMLElement).closest<HTMLElement>(".cm-lp-link");
          if (!el || e.button !== 0) return false;
          e.preventDefault();
          const kind = el.dataset.kind === "markdown" ? "markdown" : "wiki";
          const target = kind === "wiki" ? (el.dataset.target ?? "") : (el.dataset.href ?? "");
          hooks.followLink({ target, heading: el.dataset.heading || undefined, kind }, e.metaKey || e.ctrlKey);
          return true;
        },
      },
    },
  );
  return [plugin, frontmatterField, EditorView.editorAttributes.of({ class: "cm-live-preview" })];
}
