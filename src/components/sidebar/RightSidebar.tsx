import { useMemo } from "react";
import { Link2, ListTree, Tags, Waypoints } from "lucide-react";
import { useWorkspace } from "../../features/workspace/store";
import { editNote, followLink, useVault, vaultIndex } from "../../vault/store";
import { linkMention } from "../../links/mentions";
import { useBookmarks } from "../../features/bookmarks/store";
import { useUi } from "../../features/ui/store";
import { useState } from "react";
import { Highlighted } from "../common/Highlighted";
import { useDoc } from "../../hooks/useDoc";
import type { RightView } from "../../types";
import { noteTitle } from "../../vault/paths";
import { parseNote } from "../../links/parse";
import { LocalGraph } from "../../graph/GraphView";

const VIEWS: { id: RightView; label: string; icon: typeof Link2 }[] = [
  { id: "backlinks", label: "Backlinks", icon: Link2 },
  { id: "outline", label: "Outline", icon: ListTree },
  { id: "properties", label: "Properties", icon: Tags },
  { id: "localGraph", label: "Local graph", icon: Waypoints },
];

export function RightSidebar() {
  const view = useWorkspace((s) => s.rightView);
  const setView = useWorkspace((s) => s.setRightView);
  const tab = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const path = tab?.kind === "note" ? tab.path : undefined;
  return (
    <div className="sidebar-inner">
      <div className="panel-tabs" role="tablist" aria-label="Note panels">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={view === id} className={`icon-btn ${view === id ? "active" : ""}`} title={label} aria-label={label} onClick={() => setView(id)}>
            <Icon size={15} />
          </button>
        ))}
      </div>
      {!path ? (
        <div className="empty-state">
          <p>Open a note to see its {VIEWS.find((v) => v.id === view)?.label.toLowerCase()}.</p>
        </div>
      ) : view === "backlinks" ? (
        <BacklinksPanel path={path} />
      ) : view === "outline" ? (
        <OutlinePanel path={path} />
      ) : view === "properties" ? (
        <PropertiesPanel path={path} />
      ) : (
        <LocalGraph path={path} />
      )}
    </div>
  );
}

function BacklinksPanel({ path }: { path: string }) {
  const indexVersion = useVault((s) => s.indexVersion);
  const openNote = useWorkspace((s) => s.openNote);
  const { backlinks, outgoing, unresolved } = useMemo(
    () => ({ backlinks: vaultIndex.backlinks(path), outgoing: vaultIndex.outgoingLinks(path), unresolved: vaultIndex.unresolvedLinks(path) }),
    [path, indexVersion], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const grouped = useMemo(() => {
    const m = new Map<string, typeof backlinks>();
    for (const b of backlinks) m.set(b.source, [...(m.get(b.source) ?? []), b]);
    return [...m];
  }, [backlinks]);

  const jump = (source: string, offset: number, newTab: boolean) => {
    openNote(source, { newTab });
    setTimeout(() => window.dispatchEvent(new CustomEvent("marginalia:goto-heading", { detail: { path: source, offset } })), 60);
  };

  return (
    <div className="panel-scroll">
      <div className="panel-header">
        <span className="panel-title">Linked mentions</span>
        <span className="count">{backlinks.length}</span>
      </div>
      {grouped.length === 0 ? (
        <p className="muted small pad">No other notes link here yet.</p>
      ) : (
        <ul className="backlinks" onKeyDown={listArrowNav}>
          {grouped.map(([source, refs]) => (
            <li key={source} className="backlink-group">
              <div className="backlink-source" title={source}>
                {noteTitle(source)}
              </div>
              {refs.map((b, i) => (
                <button key={i} className="backlink-item" onClick={(e) => jump(source, b.link.from, e.metaKey || e.ctrlKey)}>
                  {b.context || <span className="muted">(link)</span>}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
      <UnlinkedMentions path={path} onJump={jump} />
      <div className="panel-header">
        <span className="panel-title">Outgoing links</span>
        <span className="count">{outgoing.length + unresolved.length}</span>
      </div>
      <ul className="link-list" onKeyDown={listArrowNav}>
        {outgoing.map((p) => (
          <li key={p}>
            <button className="link-row" onClick={(e) => openNote(p, { newTab: e.metaKey || e.ctrlKey })} title={p}>
              {noteTitle(p)}
            </button>
          </li>
        ))}
        {unresolved.map((t) => (
          <li key={t}>
            <button className="link-row unresolved" onClick={() => void followLink(t, path)} title="Not created yet — click to create">
              {t}
            </button>
          </li>
        ))}
        {outgoing.length + unresolved.length === 0 && <li className="muted small pad">No links in this note.</li>}
      </ul>
    </div>
  );
}

function UnlinkedMentions({ path, onJump }: { path: string; onJump: (source: string, offset: number, newTab: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const indexVersion = useVault((s) => s.indexVersion);
  // Computed only when expanded: it scans other notes' text.
  const mentions = useMemo(() => (open ? vaultIndex.unlinkedMentions(path) : []), [open, path, indexVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = vaultIndex.get(path)?.title ?? noteTitle(path);
  const link = (source: string, from: number, to: number, text: string) =>
    void editNote(source, (c) => (c.slice(from, to) === text ? linkMention(c, { from, to }, title) : c));
  return (
    <>
      <button className="panel-header as-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="panel-title">Unlinked mentions</span>
        {open && <span className="count">{mentions.length}</span>}
      </button>
      {open && (
        <ul className="backlinks">
          {mentions.length === 0 && <li className="muted small pad">No unlinked mentions found.</li>}
          {mentions.map((m, i) => (
            <li key={`${m.source}:${m.from}:${i}`} className="mention">
              <button className="backlink-item" onClick={(e) => onJump(m.source, m.from, e.metaKey || e.ctrlKey)}>
                <span className="backlink-source-inline">{noteTitle(m.source)}</span>
                <Highlighted text={m.context} ranges={rangeIn(m.context, m.text)} />
              </button>
              <button className="btn small mention-link" onClick={() => link(m.source, m.from, m.to, m.text)}>
                Link
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function rangeIn(context: string, text: string): [number, number][] {
  const i = context.toLowerCase().indexOf(text.toLowerCase());
  return i === -1 ? [] : [[i, i + text.length]];
}

function listArrowNav(e: React.KeyboardEvent) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button")];
  const idx = items.indexOf(document.activeElement as HTMLElement);
  if (idx === -1) return;
  e.preventDefault();
  items[e.key === "ArrowDown" ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1)]?.focus();
}

function OutlinePanel({ path }: { path: string }) {
  const doc = useDoc(path);
  const headings = useMemo(() => (doc ? parseNote(path, doc.content).headings : []), [doc, path]);
  if (!headings.length) return <p className="muted small pad">No headings in this note.</p>;
  const min = Math.min(...headings.map((h) => h.level));
  return (
    <ul className="outline panel-scroll" onKeyDown={listArrowNav}>
      {headings.map((h, i) => (
        <li key={i}>
          <button
            className="outline-row"
            style={{ paddingLeft: 10 + (h.level - min) * 14 }}
            onClick={() => window.dispatchEvent(new CustomEvent("marginalia:goto-heading", { detail: { path, heading: h.text, offset: h.offset } }))}
            onContextMenu={(e) => {
              e.preventDefault();
              useUi.getState().openContextMenu(e.clientX, e.clientY, [
                { label: "Bookmark this heading", run: () => void useBookmarks.getState().toggle({ type: "heading", path, heading: h.text }) },
              ]);
            }}
          >
            {h.text}
          </button>
        </li>
      ))}
    </ul>
  );
}

function PropertiesPanel({ path }: { path: string }) {
  const doc = useDoc(path);
  const parsed = useMemo(() => (doc ? parseNote(path, doc.content) : null), [doc, path]);
  if (!parsed) return null;
  const entries = Object.entries(parsed.frontmatter ?? {});
  return (
    <div className="panel-scroll pad">
      {parsed.frontmatterError && <p className="banner error small">Frontmatter is not valid YAML: {parsed.frontmatterError}</p>}
      {entries.length === 0 && !parsed.frontmatterError && (
        <p className="muted small">
          No properties. Add YAML frontmatter at the top of the note:
          <code className="block">{"---\ntags: [idea]\nstatus: draft\n---"}</code>
        </p>
      )}
      {entries.length > 0 && (
        <dl className="props">
          {entries.map(([k, v]) => (
            <div key={k} className="prop">
              <dt>{k}</dt>
              <dd>{formatValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="panel-header flush">
        <span className="panel-title">Tags</span>
      </div>
      {parsed.allTags.length ? (
        <div className="chips">
          {parsed.allTags.map((t) => (
            <button key={t} className="chip" onClick={() => {
              useWorkspace.getState().setLeftView("search");
              setTimeout(() => window.dispatchEvent(new CustomEvent("marginalia:search", { detail: `tag:${t}` })), 0);
            }}>
              #{t}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted small">No tags.</p>
      )}
      <div className="panel-header flush">
        <span className="panel-title">Info</span>
      </div>
      <dl className="props">
        <div className="prop"><dt>Words</dt><dd>{parsed.wordCount}</dd></div>
        <div className="prop"><dt>Links</dt><dd>{parsed.links.length}</dd></div>
        <div className="prop"><dt>Headings</dt><dd>{parsed.headings.length}</dd></div>
        <div className="prop"><dt>Path</dt><dd className="mono">{path}</dd></div>
      </dl>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
