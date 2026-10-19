import { Bookmark as BookmarkIcon, FileText, Hash, Search } from "lucide-react";
import { useBookmarks, type Bookmark } from "../../features/bookmarks/store";
import { useWorkspace } from "../../features/workspace/store";
import { prompt, toast, useUi } from "../../features/ui/store";
import { vaultIndex } from "../../vault/store";
import { noteTitle } from "../../vault/paths";

function label(b: Bookmark) {
  if (b.title) return b.title;
  if (b.type === "file") return noteTitle(b.path);
  if (b.type === "heading") return `${noteTitle(b.path)} › ${b.heading}`;
  return b.query;
}

export function openBookmark(b: Bookmark, newTab = false) {
  const ws = useWorkspace.getState();
  if (b.type === "search") {
    ws.setLeftView("search");
    setTimeout(() => window.dispatchEvent(new CustomEvent("marginalia:search", { detail: b.query })), 0);
    return;
  }
  if (!vaultIndex.hasFile(b.path)) return toast(`"${b.path}" no longer exists.`, "error");
  ws.openNote(b.path, { newTab });
  if (b.type === "heading")
    setTimeout(() => window.dispatchEvent(new CustomEvent("marginalia:goto-heading", { detail: { path: b.path, heading: b.heading } })), 80);
}

export function BookmarksPanel() {
  const { items, error, remove, rename, move } = useBookmarks();
  return (
    <div className="tag-panel">
      <div className="panel-header">
        <span className="panel-title">Bookmarks</span>
        <span className="muted small">{items.length}</span>
      </div>
      {error && <p className="banner error small">{error}</p>}
      {items.length === 0 ? (
        <div className="empty-state">
          <BookmarkIcon size={18} />
          <p>No bookmarks yet. Bookmark notes, headings or searches from the command palette or a note's context menu.</p>
        </div>
      ) : (
        <ul className="tag-list" role="list">
          {items.map((b, i) => {
            const Icon = b.type === "search" ? Search : b.type === "heading" ? Hash : FileText;
            const missing = b.type !== "search" && !vaultIndex.hasFile(b.path);
            return (
              <li key={i}>
                <button
                  className={`tag-row ${missing ? "missing" : ""}`}
                  title={b.type === "search" ? `Search: ${b.query}` : b.path}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/x-bookmark-index", String(i))}
                  onDragOver={(e) => e.dataTransfer.types.includes("text/x-bookmark-index") && e.preventDefault()}
                  onDrop={(e) => {
                    const from = Number(e.dataTransfer.getData("text/x-bookmark-index"));
                    if (!Number.isNaN(from) && from !== i) void move(from, i);
                  }}
                  onClick={(e) => openBookmark(b, e.metaKey || e.ctrlKey)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    useUi.getState().openContextMenu(e.clientX, e.clientY, [
                      { label: "Open in new tab", disabled: b.type === "search", run: () => openBookmark(b, true) },
                      {
                        label: "Rename…",
                        run: async () => {
                          const t = await prompt({ title: "Rename bookmark", initial: label(b), confirmLabel: "Rename" });
                          if (t != null) await rename(b, t);
                        },
                      },
                      { label: "", separator: true },
                      { label: "Remove bookmark", danger: true, run: () => void remove(b) },
                    ]);
                  }}
                >
                  <Icon size={13} />
                  <span className="tag-name plain">{label(b)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
