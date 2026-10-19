import { Files, Search, Hash, Network, CalendarDays, Command, Settings, FolderOpen } from "lucide-react";
import { useWorkspace } from "../../features/workspace/store";
import { runCommand, formatShortcut, getCommand } from "../../commands/registry";
import { useSettings } from "../../settings/store";
import type { LeftView } from "../../types";

export function Ribbon() {
  const { leftView, leftOpen, setLeftView, toggleLeft } = useWorkspace();
  const daily = useSettings((s) => s.settings.dailyNotesEnabled);
  const view = (v: LeftView) => () => (leftOpen && leftView === v ? toggleLeft() : setLeftView(v));
  const sc = (id: string) => {
    const s = getCommand(id)?.shortcut;
    return s ? ` (${formatShortcut(s)})` : "";
  };
  const item = (label: string, Icon: typeof Files, onClick: () => void, activeFlag = false) => (
    <button className={`ribbon-btn ${activeFlag ? "active" : ""}`} onClick={onClick} title={label} aria-label={label} aria-pressed={activeFlag}>
      <Icon size={18} strokeWidth={1.75} />
    </button>
  );
  return (
    <nav className="ribbon" aria-label="Ribbon">
      {item(`Files${sc("nav.files")}`, Files, view("files"), leftOpen && leftView === "files")}
      {item(`Search${sc("nav.search")}`, Search, () => runCommand("nav.search"), leftOpen && leftView === "search")}
      {item(`Tags${sc("nav.tags")}`, Hash, view("tags"), leftOpen && leftView === "tags")}
      {item(`Graph view${sc("nav.graph")}`, Network, () => runCommand("nav.graph"))}
      {daily && item(`Today's daily note${sc("daily.open")}`, CalendarDays, () => runCommand("daily.open"))}
      {item(`Command palette${sc("nav.palette")}`, Command, () => runCommand("nav.palette"))}
      <div className="ribbon-spacer" />
      {item("Switch vault", FolderOpen, () => runCommand("vault.switch"))}
      {item(`Settings${sc("app.settings")}`, Settings, () => runCommand("app.settings"))}
    </nav>
  );
}
