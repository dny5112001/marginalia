import { memo, useMemo, useRef, useState } from "react";
import { ChevronRight, File, FileText, Folder, FolderOpen, Image as ImageIcon } from "lucide-react";
import type { FileEntry } from "../../types";
import { useVault, createNote, movePath, documents } from "../../vault/store";
import { useWorkspace } from "../../features/workspace/store";
import { useUi, toast } from "../../features/ui/store";
import { promptDelete, promptMove, promptNewFolder, promptRename } from "../../commands/appCommands";
import { basename, dirname, isImage, isMarkdown, noteTitle } from "../../vault/paths";
import { useDoc } from "../../hooks/useDoc";

interface TreeNode {
  entry: FileEntry;
  children: TreeNode[];
}

export function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirs = new Map<string, TreeNode>();
  const sorted = [...entries].sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  for (const e of sorted) {
    const node: TreeNode = { entry: e, children: [] };
    if (e.kind === "dir") dirs.set(e.path, node);
    const parent = dirname(e.path);
    (parent ? (dirs.get(parent)?.children ?? root) : root).push(node);
  }
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) =>
      a.entry.kind !== b.entry.kind
        ? a.entry.kind === "dir"
          ? -1
          : 1
        : basename(a.entry.path).localeCompare(basename(b.entry.path), undefined, { numeric: true, sensitivity: "base" }),
    );
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(root);
  return root;
}

const DRAG_MIME = "application/x-marginalia-path";

export function FileTree() {
  const entries = useVault((s) => s.entries);
  const tree = useMemo(() => buildTree(entries), [entries]);
  const [rootDrop, setRootDrop] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(".tree-row") ?? [])];
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[Math.min(items.length - 1, idx + 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[Math.max(0, idx - 1)]?.focus();
    }
  };

  if (!entries.length)
    return (
      <div className="empty-state">
        <p>This vault has no files yet.</p>
        <button className="btn" onClick={() => void createNote()}>
          Create a note
        </button>
      </div>
    );

  return (
    <div
      ref={ref}
      className={`file-tree ${rootDrop ? "drop-target" : ""}`}
      role="tree"
      aria-label="Files"
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault();
          setRootDrop(true);
        }
      }}
      onDragLeave={() => setRootDrop(false)}
      onDrop={(e) => {
        setRootDrop(false);
        const p = e.dataTransfer.getData(DRAG_MIME);
        if (p) {
          e.preventDefault();
          void movePath(p, "");
        }
      }}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        useUi.getState().openContextMenu(e.clientX, e.clientY, [
          { label: "New note", run: () => void createNote("") },
          { label: "New folder", run: () => void promptNewFolder("") },
        ]);
      }}
    >
      {tree.map((n) => (
        <TreeItem key={n.entry.path} node={n} depth={0} />
      ))}
    </div>
  );
}

const TreeItem = memo(function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
  const { entry } = node;
  const isDir = entry.kind === "dir";
  const expanded = useWorkspace((s) => s.expandedFolders.includes(entry.path));
  const activePath = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeTabId)?.path);
  const [drop, setDrop] = useState(false);
  const md = isMarkdown(entry.path);
  const doc = useDoc(md ? entry.path : undefined);
  const dirty = !!doc && documents.isDirty(entry.path);

  const open = (newTab = false) => {
    if (isDir) return useWorkspace.getState().toggleFolder(entry.path);
    if (md) useWorkspace.getState().openNote(entry.path, { newTab });
    else toast(`"${basename(entry.path)}" is not a Markdown note. Attachments are shown when embedded in notes.`);
  };

  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const folder = isDir ? entry.path : dirname(entry.path);
    useUi.getState().openContextMenu(e.clientX, e.clientY, [
      ...(isDir
        ? [
            { label: "New note", run: () => void createNote(entry.path) },
            { label: "New folder", run: () => void promptNewFolder(entry.path) },
            { label: "", separator: true },
          ]
        : md
          ? [{ label: "Open in new tab", run: () => open(true) }, { label: "", separator: true }]
          : []),
      { label: "Rename…", shortcut: "F2", run: () => void promptRename(entry.path) },
      { label: "Move to…", run: () => void promptMove(entry.path) },
      ...(!isDir ? [{ label: "New note in this folder", run: () => void createNote(folder) }] : []),
      { label: "Copy path", run: () => void navigator.clipboard?.writeText(entry.path) },
      { label: "", separator: true },
      { label: "Delete", danger: true, run: () => void promptDelete(entry.path) },
    ]);
  };

  const Icon = isDir ? (expanded ? FolderOpen : Folder) : md ? FileText : isImage(entry.path) ? ImageIcon : File;
  return (
    <div role="none">
      <div
        className={`tree-row ${activePath === entry.path ? "active" : ""} ${drop ? "drop-target" : ""} ${md || isDir ? "" : "attachment"}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        role="treeitem"
        aria-expanded={isDir ? expanded : undefined}
        aria-selected={activePath === entry.path}
        tabIndex={0}
        draggable
        title={entry.path}
        onClick={(e) => open(e.metaKey || e.ctrlKey)}
        onAuxClick={(e) => e.button === 1 && open(true)}
        onContextMenu={menu}
        onKeyDown={(e) => {
          if (e.key === "Enter") open(e.metaKey || e.ctrlKey);
          else if (e.key === "F2") {
            e.preventDefault();
            void promptRename(entry.path);
          } else if (e.key === "Delete" || (e.key === "Backspace" && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            void promptDelete(entry.path);
          } else if (isDir && e.key === "ArrowRight" && !expanded) useWorkspace.getState().toggleFolder(entry.path, true);
          else if (isDir && e.key === "ArrowLeft" && expanded) useWorkspace.getState().toggleFolder(entry.path, false);
        }}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, entry.path);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!isDir || !e.dataTransfer.types.includes(DRAG_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          setDrop(true);
        }}
        onDragLeave={() => setDrop(false)}
        onDrop={(e) => {
          setDrop(false);
          if (!isDir) return;
          const p = e.dataTransfer.getData(DRAG_MIME);
          if (!p) return;
          e.preventDefault();
          e.stopPropagation();
          void movePath(p, entry.path);
        }}
      >
        {isDir ? <ChevronRight size={13} className={`chevron ${expanded ? "open" : ""}`} /> : <span className="chevron-space" />}
        <Icon size={14} className="tree-icon" />
        <span className="tree-label">{md ? noteTitle(entry.path) : basename(entry.path)}</span>
        {!md && !isDir && <span className="ext-badge">{basename(entry.path).split(".").pop()}</span>}
        {dirty && <span className="tab-dot" aria-label="Unsaved changes" />}
      </div>
      {isDir && expanded && (
        <div role="group">
          {node.children.map((c) => (
            <TreeItem key={c.entry.path} node={c} depth={depth + 1} />
          ))}
          {node.children.length === 0 && (
            <div className="tree-empty" style={{ paddingLeft: 30 + depth * 14 }}>
              Empty folder
            </div>
          )}
        </div>
      )}
    </div>
  );
});
