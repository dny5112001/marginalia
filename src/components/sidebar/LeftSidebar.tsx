import { FilePlus, FolderPlus, ChevronsDownUp, ChevronsUpDown, ArrowUpDown } from "lucide-react";
import { useUi } from "../../features/ui/store";
import { useVault } from "../../vault/store";
import type { FileSort } from "../../types";
import { useWorkspace } from "../../features/workspace/store";
import { FileTree } from "./FileTree";
import { SearchPanel } from "./SearchPanel";
import { TagPanel } from "./TagPanel";
import { BookmarksPanel } from "./BookmarksPanel";
import { createNote } from "../../vault/store";
import { promptNewFolder } from "../../commands/appCommands";
import { formatShortcut } from "../../commands/registry";

export function LeftSidebar() {
  const view = useWorkspace((s) => s.leftView);
  const collapseAll = () => useWorkspace.setState({ expandedFolders: [] });
  const expandAll = () => useWorkspace.setState({ expandedFolders: useVault.getState().entries.filter((e) => e.kind === "dir").map((e) => e.path) });
  const sortMenu = (e: React.MouseEvent) => {
    const cur = useWorkspace.getState().fileSort;
    const opt = (v: FileSort, label: string) => ({ label: (cur === v ? "✓ " : "   ") + label, run: () => useWorkspace.getState().setFileSort(v) });
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    useUi.getState().openContextMenu(r.left, r.bottom + 4, [
      opt("name-asc", "File name (A to Z)"),
      opt("name-desc", "File name (Z to A)"),
      opt("modified-new", "Modified time (new to old)"),
      opt("modified-old", "Modified time (old to new)"),
    ]);
  };
  return (
    <div className="sidebar-inner">
      {view === "files" && (
        <>
          <div className="panel-header">
            <span className="panel-title">Files</span>
            <div className="panel-actions">
              <button className="icon-btn" title={`New note (${formatShortcut("Mod+N")})`} aria-label="New note" onClick={() => void createNote()}>
                <FilePlus size={15} />
              </button>
              <button className="icon-btn" title={`New folder (${formatShortcut("Mod+Shift+N")})`} aria-label="New folder" onClick={() => void promptNewFolder("")}>
                <FolderPlus size={15} />
              </button>
              <button className="icon-btn" title="Change sort order" aria-label="Change sort order" onClick={sortMenu}>
                <ArrowUpDown size={15} />
              </button>
              <button className="icon-btn" title="Expand all" aria-label="Expand all folders" onClick={expandAll}>
                <ChevronsUpDown size={15} />
              </button>
              <button className="icon-btn" title="Collapse all" aria-label="Collapse all folders" onClick={collapseAll}>
                <ChevronsDownUp size={15} />
              </button>
            </div>
          </div>
          <FileTree />
        </>
      )}
      {view === "search" && <SearchPanel />}
      {view === "tags" && <TagPanel />}
      {view === "bookmarks" && <BookmarksPanel />}
    </div>
  );
}
