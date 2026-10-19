import { useMemo } from "react";
import { useWorkspace } from "../../features/workspace/store";
import { useDoc } from "../../hooks/useDoc";
import { useStatus } from "../../features/status/store";
import { useVault, vaultIndex } from "../../vault/store";
import { countWords, extractFrontmatter } from "../../links/parse";
import { documents } from "../../vault/store";

export function StatusBar() {
  const tab = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const path = tab?.kind === "note" ? tab.path : undefined;
  const doc = useDoc(path);
  const cursor = useStatus((s) => s.cursor);
  const { indexing, indexVersion, info } = useVault();
  const counts = useMemo(() => {
    if (!doc) return null;
    const body = doc.content.slice(extractFrontmatter(doc.content)?.end ?? 0);
    return { words: countWords(body), chars: body.length };
  }, [doc]);
  const backlinks = useMemo(() => (path ? vaultIndex.backlinks(path).length : 0), [path, indexVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  let save = "";
  if (doc) {
    if (doc.status === "saving") save = "Saving…";
    else if (doc.status === "error") save = "Save failed";
    else if (doc.status === "conflict") save = "Conflict";
    else if (path && documents.isDirty(path)) save = "Unsaved";
    else if (doc.status === "clean") save = "Saved";
  }
  return (
    <footer className="statusbar" aria-label="Status bar">
      <span className="status-item muted">{info?.name}</span>
      {indexing && <span className="status-item">Indexing…</span>}
      <span className="status-spacer" />
      {path && (
        <>
          <span className="status-item">{backlinks} backlink{backlinks === 1 ? "" : "s"}</span>
          {counts && (
            <span className="status-item">
              {counts.words.toLocaleString()} words · {counts.chars.toLocaleString()} characters
            </span>
          )}
          {cursor && tab?.mode !== "preview" && (
            <span className="status-item">
              Ln {cursor.line}, Col {cursor.col}
              {cursor.selected ? ` (${cursor.selected} selected)` : ""}
            </span>
          )}
          <span className={`status-item save-state ${doc?.status ?? ""}`} aria-live="polite">
            {save}
          </span>
        </>
      )}
    </footer>
  );
}
