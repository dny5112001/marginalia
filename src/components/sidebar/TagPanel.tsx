import { useMemo, useState } from "react";
import { Hash, ChevronRight } from "lucide-react";
import { useVault, vaultIndex } from "../../vault/store";
import { useWorkspace } from "../../features/workspace/store";
import { noteTitle } from "../../vault/paths";

export function TagPanel() {
  const indexVersion = useVault((s) => s.indexVersion);
  const tags = useMemo(() => vaultIndex.tags(), [indexVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const openNote = useWorkspace((s) => s.openNote);
  const notes = useMemo(() => (selected ? vaultIndex.notesWithTag(selected) : []), [selected, indexVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = [...tags].filter(([t]) => t.includes(filter.toLowerCase().replace(/^#/, "")));

  return (
    <div className="tag-panel">
      <div className="panel-header">
        <span className="panel-title">Tags</span>
        <span className="muted small">{tags.size}</span>
      </div>
      <div className="search-box">
        <Hash size={14} />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tags…" aria-label="Filter tags" />
      </div>
      {tags.size === 0 ? (
        <div className="empty-state">
          <p>No tags yet. Add <code>#tag</code> inline or <code>tags:</code> in frontmatter.</p>
        </div>
      ) : (
        <ul className="tag-list">
          {list.map(([tag, paths]) => (
            <li key={tag}>
              <button className={`tag-row ${selected === tag ? "active" : ""}`} onClick={() => setSelected(selected === tag ? null : tag)} aria-expanded={selected === tag}>
                <ChevronRight size={12} className={`chevron ${selected === tag ? "open" : ""}`} />
                <span className="tag-name">#{tag}</span>
                <span className="count">{paths.length}</span>
              </button>
              {selected === tag && (
                <ul className="tag-notes">
                  {notes.map((p) => (
                    <li key={p}>
                      <button className="link-row" onClick={(e) => openNote(p, { newTab: e.metaKey || e.ctrlKey })} title={p}>
                        {noteTitle(p)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
