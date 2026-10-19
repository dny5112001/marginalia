import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, CaseSensitive, Copy, HelpCircle, Search, X } from "lucide-react";
import { useBookmarks } from "../../features/bookmarks/store";
import { explainQuery, parseSearch } from "../../search/query";
import type { SearchOptions } from "../../search/searchIndex";
import { toast } from "../../features/ui/store";
import { useVault, vaultIndex } from "../../vault/store";
import { useWorkspace } from "../../features/workspace/store";
import { useUi } from "../../features/ui/store";
import { Highlighted } from "../common/Highlighted";

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [explain, setExplain] = useState(false);
  const [sort, setSort] = useState<NonNullable<SearchOptions["sort"]>>("relevance");
  const indexVersion = useVault((s) => s.indexVersion);
  const focusTick = useUi((s) => s.searchFocusTick);
  const input = useRef<HTMLInputElement>(null);
  const openNote = useWorkspace((s) => s.openNote);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusTick]);

  useEffect(() => {
    const onSearch = (e: Event) => setQuery((e as CustomEvent<string>).detail);
    window.addEventListener("marginalia:search", onSearch);
    return () => window.removeEventListener("marginalia:search", onSearch);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 120);
    return () => clearTimeout(t);
  }, [query]);

  const hits = useMemo(
    () => (debounced.trim() ? vaultIndex.search.search(debounced, { limit: 200, matchCase, sort }) : []),
    [debounced, indexVersion, matchCase, sort], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const explanation = useMemo(() => (explain && debounced.trim() ? explainQuery(parseSearch(debounced)) : []), [explain, debounced]);
  const copyResults = () => {
    const text = hits.map((h) => `- [[${h.path.replace(/\.md$/i, "")}]]`).join("\n");
    void navigator.clipboard?.writeText(text).then(
      () => toast(`Copied ${hits.length} results as links.`, "success"),
      () => toast("Could not access the clipboard.", "error"),
    );
  };

  return (
    <div className="search-panel">
      <div className="panel-header">
        <span className="panel-title">Search</span>
      </div>
      <div className="search-box">
        <Search size={14} />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes…"
          aria-label="Search vault"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) openNote(hits[0].path);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              (document.querySelector(".search-hit") as HTMLElement | null)?.focus();
            }
          }}
        />
        <button className={`icon-btn ${matchCase ? "active" : ""}`} aria-pressed={matchCase} title="Match case" aria-label="Match case" onClick={() => setMatchCase(!matchCase)}>
          <CaseSensitive size={15} />
        </button>
        {query && (
          <button className="icon-btn" aria-label="Clear search" onClick={() => setQuery("")}>
            <X size={13} />
          </button>
        )}
      </div>
      {!debounced.trim() && (
        <div className="search-help muted small">
          <p>Operators:</p>
          <ul>
            <li><code>"exact phrase"</code> <code>-exclude</code> <code>a OR b</code> <code>/regex/</code></li>
            <li><code>tag:#x</code> <code>path:folder</code> <code>file:name</code> <code>content:text</code></li>
            <li><code>line:(a b)</code> <code>section:(a b)</code> <code>task-todo:x</code></li>
            <li><code>[property]</code> <code>[status:draft]</code></li>
          </ul>
        </div>
      )}
      {debounced.trim() && (
        <div className="search-meta">
          <span className="muted small" aria-live="polite">
            {hits.length === 0 ? "No results." : `${hits.length}${hits.length === 200 ? "+" : ""} result${hits.length === 1 ? "" : "s"}`}
          </span>
          <span className="search-meta-actions">
            <select className="input small" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort results">
              <option value="relevance">Relevance</option>
              <option value="name-asc">Name (A–Z)</option>
              <option value="name-desc">Name (Z–A)</option>
              <option value="path">Path</option>
            </select>
            <button className={`icon-btn ${explain ? "active" : ""}`} title="Explain search terms" aria-label="Explain search terms" aria-pressed={explain} onClick={() => setExplain(!explain)}>
              <HelpCircle size={14} />
            </button>
            <button
              className="icon-btn"
              title="Bookmark this search"
              aria-label="Bookmark this search"
              onClick={() => void useBookmarks.getState().toggle({ type: "search", query: debounced.trim() }).then(() => toast("Search bookmark updated.", "success"))}
            >
              <Bookmark size={14} />
            </button>
            <button className="icon-btn" title="Copy results as links" aria-label="Copy results as links" disabled={!hits.length} onClick={copyResults}>
              <Copy size={14} />
            </button>
          </span>
        </div>
      )}
      {explanation.length > 0 && <pre className="search-explain">{explanation.join("\n")}</pre>}
      <ul className="search-results" role="listbox" aria-label="Search results">
        {hits.map((h) => (
          <li key={h.path}>
            <button
              className="search-hit"
              role="option"
              aria-selected={false}
              onClick={(e) => openNote(h.path, { newTab: e.metaKey || e.ctrlKey })}
              onKeyDown={(e) => {
                const el = e.currentTarget.parentElement;
                if (e.key === "ArrowDown") (el?.nextElementSibling?.querySelector("button") as HTMLElement | null)?.focus();
                if (e.key === "ArrowUp") (el?.previousElementSibling?.querySelector("button") as HTMLElement | null)?.focus() ?? input.current?.focus();
              }}
            >
              <span className="hit-title">{h.title}</span>
              <span className="hit-path muted small">{h.path}</span>
              {h.snippets.map((s, i) => (
                <span key={i} className="hit-snippet">
                  <Highlighted text={s.text} ranges={s.ranges} />
                </span>
              ))}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
