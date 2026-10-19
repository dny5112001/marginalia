import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openUrl } from "@tauri-apps/plugin-opener";
import { createExtensions, reconfigure, type EditorHooks, type EditorOptions } from "../../editor/setup";
import { loadVaultImage } from "../../markdown/images";
import type { Settings } from "../../types";
import { setActiveEditor } from "../../editor/activeEditor";
import { documents, followLink, saveAttachment, vaultIndex } from "../../vault/store";
import { toast } from "../../features/ui/store";

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
import { useSettings } from "../../settings/store";
import { useDoc } from "../../hooks/useDoc";
import { useStatus } from "../../features/status/store";
import { isTauri } from "../../filesystem";
import { extractFrontmatter, headingSlug } from "../../links/parse";
import { dirname, noteTitle } from "../../vault/paths";

const editorOptions = (s: Settings): EditorOptions => ({
  lineNumbers: s.lineNumbers,
  wrap: s.lineWrapping,
  fontSize: s.editorFontSize,
  livePreview: s.livePreview,
});

/** Editor states are cached per path so switching tabs keeps undo history, selection and scroll. */
const stateCache = new Map<string, { state: EditorState; hooks: { current: EditorHooks }; scroll: number }>();

export function forgetEditorState(path: string) {
  stateCache.delete(path);
}

export function openExternal(url: string) {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (isTauri) void openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function MarkdownEditor({ path, active }: { path: string; active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const hooksRef = useRef<{ current: EditorHooks } | null>(null);
  const appliedRev = useRef(0);
  const doc = useDoc(path);
  const settings = useSettings((s) => s.settings);
  const ready = !!doc && doc.status !== "loading" && !(doc.status === "error" && doc.mtime === undefined);

  // Create (or restore) the view once the document is loaded.
  useEffect(() => {
    if (!ready || !host.current) return;
    const d = documents.get(path)!;
    const hooks: EditorHooks = {
      onChange: (content) => documents.edit(path, content),
      onSelection: (info) => useStatus.getState().setCursor(info),
      onFollowLink: (link, newTab) => {
        if (link.kind === "markdown" && /^[a-z][a-z0-9+.-]*:/i.test(link.target)) return openExternal(link.target);
        if (link.kind === "markdown") {
          const resolved = vaultIndex.resolveLink({ target: link.target, kind: "markdown" }, path);
          if (resolved) return void followLink(resolved, path, { newTab, heading: link.heading });
        }
        void followLink(link.target, path, { newTab, heading: link.heading });
      },
      noteNames: () => {
        const notes = vaultIndex.notePaths();
        const counts = new Map<string, number>();
        for (const p of notes) counts.set(noteTitle(p).toLowerCase(), (counts.get(noteTitle(p).toLowerCase()) ?? 0) + 1);
        // Duplicate titles complete to a folder-qualified link so they resolve unambiguously.
        return notes.map((p) => {
          const title = noteTitle(p);
          const dup = (counts.get(title.toLowerCase()) ?? 0) > 1;
          return { label: dup ? p.replace(/\.md$/i, "") : title, detail: dirname(p) };
        });
      },
      headingsFor: (target) => {
        const resolved = target ? vaultIndex.resolveTarget(target, path) : path;
        return resolved ? (vaultIndex.get(resolved)?.headings.map((h) => h.text) ?? []) : [];
      },
      loadImage: (target, kind) => loadVaultImage(target, kind, path),
      onFiles: async (files) => {
        const out: string[] = [];
        for (const f of files) {
          if (f.size > 100 * 1024 * 1024) {
            toast(`"${f.name}" is larger than 100 MB and was not added.`, "error");
            continue;
          }
          const md = await saveAttachment(path, { name: f.name, type: f.type, base64: await fileToBase64(f) });
          if (md) out.push(md);
        }
        return out;
      },
      onSave: () => void documents.save(path),
    };
    const cached = stateCache.get(path);
    let state: EditorState;
    if (cached && cached.state.doc.toString() === d.content) {
      cached.hooks.current = hooks;
      hooksRef.current = cached.hooks;
      state = cached.state;
    } else {
      hooksRef.current = { current: hooks };
      const ref = hooksRef.current;
      const proxy: EditorHooks = {
        onChange: (c) => ref.current.onChange(c),
        onSelection: (i) => ref.current.onSelection?.(i),
        onFollowLink: (l, n) => ref.current.onFollowLink(l, n),
        noteNames: () => ref.current.noteNames(),
        headingsFor: (t) => ref.current.headingsFor(t),
        loadImage: (t, k) => ref.current.loadImage(t, k),
        onFiles: (f) => ref.current.onFiles!(f),
        onSave: () => ref.current.onSave(),
      };
      const s = useSettings.getState().settings;
      // Start below the frontmatter, which Live Preview shows as the Properties block.
      const fmEnd = s.livePreview ? (extractFrontmatter(d.content)?.end ?? 0) : 0;
      state = EditorState.create({
        doc: d.content,
        selection: { anchor: Math.min(fmEnd, d.content.length) },
        extensions: createExtensions(proxy, editorOptions(s)),
      });
    }
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    appliedRev.current = d.externalRev;
    reconfigure(view, editorOptions(useSettings.getState().settings), hooksRef.current!.current);
    const scroller = host.current.closest(".pane-scroll");
    if (cached && scroller) requestAnimationFrame(() => (scroller.scrollTop = cached.scroll));
    return () => {
      stateCache.set(path, { state: view.state, hooks: hooksRef.current!, scroll: scroller?.scrollTop ?? 0 });
      setActiveEditor(null);
      view.destroy();
      viewRef.current = null;
    };
  }, [path, ready]);

  // Apply content replaced from outside the editor (external edit, conflict resolution, link rewrite).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !doc || doc.externalRev === appliedRev.current) return;
    appliedRev.current = doc.externalRev;
    const cur = view.state.doc.toString();
    if (cur === doc.content) return;
    const head = Math.min(view.state.selection.main.head, doc.content.length);
    view.dispatch({ changes: { from: 0, to: cur.length, insert: doc.content }, selection: { anchor: head } });
  }, [doc]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !hooksRef.current) return;
    reconfigure(view, editorOptions(settings), hooksRef.current.current);
    view.contentDOM.spellcheck = settings.spellcheck;
  }, [settings, ready]);

  useEffect(() => {
    const view = viewRef.current;
    if (!active || !view) return;
    setActiveEditor(view, path);
    const r = view.state.selection.main;
    const line = view.state.doc.lineAt(r.head);
    useStatus.getState().setCursor({ line: line.number, col: r.head - line.from + 1, selected: Math.abs(r.to - r.from) });
    const id = requestAnimationFrame(() => view.focus());
    return () => cancelAnimationFrame(id);
  }, [active, ready, path]);

  // Jump to heading requests from the outline or `[[Note#Heading]]` links.
  useEffect(() => {
    const onGoto = (e: Event) => {
      const { path: p, heading, offset } = (e as CustomEvent<{ path: string; heading?: string; offset?: number }>).detail;
      const view = viewRef.current;
      if (p !== path || !view) return;
      let pos = offset;
      if (pos == null && heading) {
        const h = vaultIndex.get(path)?.headings.find((x) => headingSlug(x.text) === headingSlug(heading));
        pos = h?.offset;
      }
      if (pos == null || pos > view.state.doc.length) return;
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 40 }) });
      view.focus();
    };
    window.addEventListener("marginalia:goto-heading", onGoto);
    return () => window.removeEventListener("marginalia:goto-heading", onGoto);
  }, [path]);

  if (!doc || doc.status === "loading") return <div className="editor-loading">Loading…</div>;
  if (!ready) return <div className="empty-state error">Could not open this file: {doc.error}</div>;
  return <div className="editor-host" ref={host} />;
}
