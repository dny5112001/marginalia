import { FilePlus, FolderPlus, ChevronsDownUp } from "lucide-react";
import { useWorkspace } from "../../features/workspace/store";
import { FileTree } from "./FileTree";
import { SearchPanel } from "./SearchPanel";
import { TagPanel } from "./TagPanel";
import { createNote } from "../../vault/store";
import { promptNewFolder } from "../../commands/appCommands";
import { formatShortcut } from "../../commands/registry";

export function LeftSidebar() {
  const view = useWorkspace((s) => s.leftView);
  const collapseAll = () => useWorkspace.setState({ expandedFolders: [] });
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
    </div>
  );
}
