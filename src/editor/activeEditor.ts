import type { EditorView } from "@codemirror/view";

/** The CodeMirror view of the focused note tab, for commands that edit text. */
let active: { view: EditorView; path: string } | null = null;

export function setActiveEditor(view: EditorView | null, path?: string) {
  active = view && path ? { view, path } : null;
}

export function getActiveEditor() {
  return active;
}

export function insertAtCursor(text: string) {
  if (!active) return false;
  const { view } = active;
  const r = view.state.selection.main;
  view.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: { anchor: r.from + text.length } });
  view.focus();
  return true;
}
