import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useVault, vaultIndex } from "../../vault/store";
import { useWorkspace } from "../../features/workspace/store";
import { useUi } from "../../features/ui/store";
import { Highlighted } from "../common/Highlighted";

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
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

  const hits = useMemo(() => (debounced.trim() ? vaultIndex.search.search(debounced, 200) : []), [debounced, indexVersion]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {query && (
          <button className="icon-btn" aria-label="Clear search" onClick={() => setQuery("")}>
            <X size={13} />
          </button>
        )}
      </div>
      <p className="search-help muted small">
        Use <code>tag:name</code>, <code>path:folder</code>, <code>file:name</code> or <code>"exact phrase"</code>.
      </p>
      {debounced.trim() && (
        <p className="search-count muted small" aria-live="polite">
          {hits.length === 0 ? "No results." : `${hits.length}${hits.length === 200 ? "+" : ""} result${hits.length === 1 ? "" : "s"}`}
        </p>
      )}
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
