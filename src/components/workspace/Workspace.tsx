import { useEffect } from "react";
import { useWorkspace } from "../../features/workspace/store";
import { TopBar } from "./TopBar";
import { Ribbon } from "./Ribbon";
import { LeftSidebar } from "../sidebar/LeftSidebar";
import { RightSidebar } from "../sidebar/RightSidebar";
import { Resizer } from "./Resizer";
import { StatusBar } from "./StatusBar";
import { NoteView } from "./NoteView";
import { GraphView } from "../../graph/GraphView";
import { EmptyWorkspace } from "./EmptyWorkspace";

export function Workspace() {
  const { tabs, activeTabId, leftOpen, rightOpen, leftWidth, rightWidth, setLeftWidth, setRightWidth } = useWorkspace();
  const active = tabs.find((t) => t.id === activeTabId);

  // Collapse sidebars on narrow windows so the editor keeps usable width.
  useEffect(() => {
    let last = window.innerWidth;
    const onResize = () => {
      const w = window.innerWidth;
      const s = useWorkspace.getState();
      if (w < 960 && last >= 960 && s.rightOpen) s.toggleRight();
      if (w < 720 && last >= 720 && s.leftOpen) s.toggleLeft();
      last = w;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="app-shell">
      <TopBar />
      <div className="workspace">
        <Ribbon />
        {leftOpen && (
          <>
            <aside className="sidebar left" style={{ width: leftWidth }} aria-label="Left sidebar">
              <LeftSidebar />
            </aside>
            <Resizer side="left" width={leftWidth} onResize={setLeftWidth} />
          </>
        )}
        <main className="center" aria-label="Editor">
          {active?.kind === "note" && active.path ? (
            <NoteView key={active.id} tab={active} active />
          ) : active?.kind === "graph" ? (
            <GraphView />
          ) : (
            <EmptyWorkspace />
          )}
        </main>
        {rightOpen && (
          <>
            <Resizer side="right" width={rightWidth} onResize={setRightWidth} />
            <aside className="sidebar right" style={{ width: rightWidth }} aria-label="Right sidebar">
              <RightSidebar />
            </aside>
          </>
        )}
      </div>
      <StatusBar />
    </div>
  );
}
