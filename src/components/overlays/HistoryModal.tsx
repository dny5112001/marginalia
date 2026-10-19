import { useEffect, useMemo, useState } from "react";
import { History, X } from "lucide-react";
import { useUi, confirmDialog, toast } from "../../features/ui/store";
import { fileHistory } from "../../features/history";
import type { Snapshot } from "../../features/history/snapshots";
import { createNote, documents, editNote, useVault, vaultIndex } from "../../vault/store";
import { useWorkspace } from "../../features/workspace/store";
import { basename, dirname, noteTitle } from "../../vault/paths";
import { countWords } from "../../links/parse";

/** Line-level summary of what changed between a snapshot and the current text. */
export function lineDiffStats(before: string, after: string) {
  const a = new Map<string, number>();
  for (const l of before.split("\n")) a.set(l, (a.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of after.split("\n")) {
    const n = a.get(l) ?? 0;
    if (n > 0) a.set(l, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of a.values()) removed += n;
  return { added, removed };
}

export function HistoryModal() {
  const path = useUi((s) => s.historyPath);
  const close = () => useUi.setState({ historyPath: null });
  const vault = useVault((s) => s.info?.path ?? "none");
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const [sel, setSel] = useState(0);
  const current = path ? (documents.get(path)?.content ?? vaultIndex.content(path) ?? null) : null;

  useEffect(() => {
    if (!path) return;
    setSnaps(null);
    setSel(0);
    void fileHistory.list(vault, path).then(setSnaps, () => setSnaps([]));
  }, [path, vault]);

  const snap = snaps?.[sel];
  const stats = useMemo(() => (snap && current != null ? lineDiffStats(current, snap.content) : null), [snap, current]);
  if (!path) return null;

  const restore = async () => {
    if (!snap) return;
    if (current == null) {
      // The note was deleted: recreate it from the snapshot.
      const created = await createNote(dirname(path), noteTitle(path), snap.content);
      if (created) toast(`Restored "${basename(path)}".`, "success");
      close();
      return;
    }
    const ok = await confirmDialog({
      title: "Restore this version?",
      message: `The note's current text will be replaced with the version from ${new Date(snap.time).toLocaleString()}. The current text is kept in history first.`,
      confirmLabel: "Restore",
    });
    if (!ok) return;
    await fileHistory.recordDeletion(vault, path, current);
    if (await editNote(path, () => snap.content)) {
      useWorkspace.getState().openNote(path);
      toast("Version restored.", "success");
      close();
    }
  };

  return (
    <div className="overlay-backdrop" onMouseDown={close}>
      <div className="history-modal" role="dialog" aria-modal="true" aria-label={`History of ${basename(path)}`} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && close()}>
        <header className="history-head">
          <History size={15} />
          <span>Local history — {noteTitle(path)}</span>
          <button className="icon-btn" aria-label="Close" onClick={close} autoFocus>
            <X size={15} />
          </button>
        </header>
        {snaps === null ? (
          <p className="muted pad">Loading…</p>
        ) : snaps.length === 0 ? (
          <p className="muted pad">No snapshots yet. A snapshot of the previous version is kept each time the note is saved (at most once per interval set in Settings → Files).</p>
        ) : (
          <div className="history-body">
            <ul className="history-list" role="listbox" aria-label="Snapshots">
              {snaps.map((s, i) => (
                <li key={s.id ?? i}>
                  <button className={`history-item ${i === sel ? "active" : ""}`} role="option" aria-selected={i === sel} onClick={() => setSel(i)}>
                    <span>{new Date(s.time).toLocaleString()}</span>
                    <span className="muted small">{countWords(s.content)} words</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="history-preview">
              {stats && (
                <p className="muted small">
                  Compared with now: <span className="diff-add">+{stats.added}</span> / <span className="diff-del">−{stats.removed}</span> lines
                </p>
              )}
              <pre>{snap?.content}</pre>
              <div className="dialog-actions">
                <button className="btn" onClick={() => void navigator.clipboard?.writeText(snap?.content ?? "")}>
                  Copy
                </button>
                <button className="btn primary" onClick={() => void restore()}>
                  {current == null ? "Recreate note" : "Restore this version"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
