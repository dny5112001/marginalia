import { ArrowLeft, ArrowRight, PanelLeft, PanelRight, Plus, X, Network, FileText, File } from "lucide-react";
import { useWorkspace } from "../../features/workspace/store";
import { useDoc } from "../../hooks/useDoc";
import { documents } from "../../vault/store";
import { useUi } from "../../features/ui/store";
import { closeActiveTab } from "../../commands/appCommands";
import { formatShortcut, isMac } from "../../commands/registry";
import { noteTitle } from "../../vault/paths";
import type { Tab } from "../../types";
import { isTauri } from "../../filesystem";

export function TopBar() {
  const { tabs, activeTabId, leftOpen, leftWidth, toggleLeft, toggleRight, back, forward, activateTab } = useWorkspace();
  const active = tabs.find((t) => t.id === activeTabId);
  const canBack = !!active && active.historyIndex > 0;
  const canForward = !!active && active.historyIndex < active.history.length - 1;
  const leftSegment = 44 + (leftOpen ? leftWidth + 1 : 0);

  return (
    <div className="topbar" data-tauri-drag-region>
      <div className="topbar-left" style={{ width: leftSegment }} data-tauri-drag-region>
        {isMac && isTauri && <div className="traffic-space" data-tauri-drag-region />}
        <button className="icon-btn" onClick={toggleLeft} title={`Toggle left sidebar (${formatShortcut("Mod+\\")})`} aria-label="Toggle left sidebar">
          <PanelLeft size={16} />
        </button>
        <button className="icon-btn" onClick={back} disabled={!canBack} title={`Back (${formatShortcut("Mod+Alt+ArrowLeft")})`} aria-label="Navigate back">
          <ArrowLeft size={16} />
        </button>
        <button className="icon-btn" onClick={forward} disabled={!canForward} title={`Forward (${formatShortcut("Mod+Alt+ArrowRight")})`} aria-label="Navigate forward">
          <ArrowRight size={16} />
        </button>
      </div>
      <div className="tabstrip" role="tablist" aria-label="Open notes" data-tauri-drag-region>
        {tabs.map((t) => (
          <TabButton
            key={t.id}
            tab={t}
            active={t.id === activeTabId}
            onActivate={() => activateTab(t.id)}
            onClose={async () => {
              activateTab(t.id);
              await closeActiveTab();
            }}
          />
        ))}
        <button className="icon-btn new-tab" onClick={() => useWorkspace.getState().newTab()} title={`New tab (${formatShortcut("Mod+T")})`} aria-label="New tab">
          <Plus size={15} />
        </button>
        <div className="tabstrip-fill" data-tauri-drag-region />
      </div>
      <div className="topbar-right" data-tauri-drag-region>
        <button className="icon-btn" onClick={toggleRight} title={`Toggle right sidebar (${formatShortcut("Mod+Alt+\\")})`} aria-label="Toggle right sidebar">
          <PanelRight size={16} />
        </button>
      </div>
    </div>
  );
}

function TabButton({ tab, active, onActivate, onClose }: { tab: Tab; active: boolean; onActivate: () => void; onClose: () => void }) {
  const doc = useDoc(tab.path);
  const dirty = !!tab.path && !!doc && documents.isDirty(tab.path);
  const title = tab.kind === "graph" ? "Graph view" : tab.kind === "empty" ? "New tab" : noteTitle(tab.path ?? "");
  return (
    <div
      className={`tab ${active ? "active" : ""}`}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={tab.path ?? title}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      onClick={onActivate}
      onContextMenu={(e) => {
        e.preventDefault();
        const ws = useWorkspace.getState();
        useUi.getState().openContextMenu(e.clientX, e.clientY, [
          { label: "Close", shortcut: "Mod+W", run: onClose },
          { label: "Close other tabs", disabled: ws.tabs.length < 2, run: () => ws.closeOtherTabs(tab.id) },
          { label: "Reopen closed tab", shortcut: "Mod+Shift+T", disabled: !ws.closedTabs.length, run: () => ws.reopenClosedTab() },
          ...(tab.path ? [{ label: "", separator: true }, { label: "Copy path", run: () => void navigator.clipboard?.writeText(tab.path!) }] : []),
        ]);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onActivate();
      }}
    >
      {tab.kind === "graph" ? <Network size={13} /> : tab.kind === "empty" ? <File size={13} /> : <FileText size={13} />}
      <span className="tab-title">{title}</span>
      {doc?.status === "error" || doc?.status === "conflict" ? <span className="tab-dot error" aria-label="Save problem" /> : dirty ? <span className="tab-dot" aria-label="Unsaved changes" /> : null}
      <button
        className="tab-close"
        aria-label={`Close ${title}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}
