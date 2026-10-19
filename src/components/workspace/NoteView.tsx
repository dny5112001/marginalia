import { useEffect, useState } from "react";
import { BookOpen, Columns2, PencilLine, AlertTriangle, History, Trash2 } from "lucide-react";
import type { Tab, ViewMode } from "../../types";
import { useDoc } from "../../hooks/useDoc";
import { documents, renamePath } from "../../vault/store";
import { useWorkspace } from "../../features/workspace/store";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { MarkdownPreview } from "../editor/MarkdownPreview";
import { basename, dirname, joinPath, noteTitle, validateName } from "../../vault/paths";
import { toast } from "../../features/ui/store";
import { formatShortcut } from "../../commands/registry";

export function NoteView({ tab, active }: { tab: Tab; active: boolean }) {
  const path = tab.path!;
  const doc = useDoc(path);
  const setMode = useWorkspace((s) => s.setMode);

  useEffect(() => {
    void documents.open(path);
  }, [path]);

  const modes: { mode: ViewMode; icon: typeof PencilLine; label: string; sc: string }[] = [
    { mode: "edit", icon: PencilLine, label: "Edit", sc: "Mod+E" },
    { mode: "split", icon: Columns2, label: "Split", sc: "Mod+Alt+E" },
    { mode: "preview", icon: BookOpen, label: "Reading view", sc: "Mod+E" },
  ];

  return (
    <div className="note-view">
      <header className="note-header">
        <div className="breadcrumb" title={path}>
          {dirname(path)
            .split("/")
            .filter(Boolean)
            .map((part, i) => (
              <span key={i} className="crumb">
                {part}
                <span className="crumb-sep">/</span>
              </span>
            ))}
        </div>
        <div className="segmented" role="group" aria-label="View mode">
          {modes.map(({ mode, icon: Icon, label, sc }) => (
            <button
              key={mode}
              className={tab.mode === mode ? "active" : ""}
              aria-pressed={tab.mode === mode}
              title={`${label} (${formatShortcut(sc)})`}
              onClick={() => setMode(tab.id, mode)}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
      </header>
      {doc && <Banners path={path} />}
      <div className={`note-body mode-${tab.mode}`}>
        {tab.mode !== "preview" && (
          <div className="pane editor-pane">
            <TitleInput path={path} />
            <MarkdownEditor path={path} active={active} />
          </div>
        )}
        {tab.mode !== "edit" && (
          <div className="pane preview-pane">
            {tab.mode === "preview" && <h1 className="preview-title">{noteTitle(path)}</h1>}
            {doc && doc.status !== "loading" ? <MarkdownPreview path={path} content={doc.content} /> : <div className="editor-loading">Loading…</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Inline, editable note title that renames the file. */
function TitleInput({ path }: { path: string }) {
  const [value, setValue] = useState(noteTitle(path));
  useEffect(() => setValue(noteTitle(path)), [path]);
  const commit = async () => {
    const next = value.trim();
    if (next === noteTitle(path)) return;
    const err = validateName(next);
    if (err) {
      toast(err, "error");
      setValue(noteTitle(path));
      return;
    }
    const ext = basename(path).slice(noteTitle(path).length);
    const ok = await renamePath(path, joinPath(dirname(path), next + ext));
    if (!ok) setValue(noteTitle(path));
  };
  return (
    <input
      className="title-input"
      value={value}
      aria-label="Note title"
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          (document.querySelector(".editor-host .cm-content") as HTMLElement | null)?.focus();
        } else if (e.key === "Escape") {
          setValue(noteTitle(path));
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function Banners({ path }: { path: string }) {
  const doc = useDoc(path)!;
  if (doc.status === "conflict")
    return (
      <div className="banner warn" role="alert">
        <AlertTriangle size={15} />
        <span>This note was changed outside Marginalia while you had unsaved edits.</span>
        <button onClick={() => void documents.resolveConflict(path, "keepMine")}>Keep my version</button>
        <button onClick={() => void documents.resolveConflict(path, "useDisk")}>Load version on disk</button>
      </div>
    );
  if (doc.deletedOnDisk)
    return (
      <div className="banner warn" role="alert">
        <Trash2 size={15} />
        <span>This file was deleted or moved outside Marginalia. Saving will recreate it.</span>
        <button onClick={() => void documents.save(path, true)}>Save again</button>
      </div>
    );
  if (doc.recovered)
    return (
      <div className="banner info" role="status">
        <History size={15} />
        <span>Recovered unsaved changes from a previous session.</span>
        <button onClick={() => void documents.save(path)}>Keep and save</button>
        <button onClick={() => void documents.discardRecovered(path)}>Discard</button>
      </div>
    );
  if (doc.status === "error")
    return (
      <div className="banner error" role="alert">
        <AlertTriangle size={15} />
        <span>Not saved: {doc.error}. Your changes are kept and will be retried.</span>
        <button onClick={() => void documents.save(path)}>Retry now</button>
      </div>
    );
  return null;
}
