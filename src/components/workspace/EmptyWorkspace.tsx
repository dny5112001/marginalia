import { useWorkspace } from "../../features/workspace/store";
import { runCommand, formatShortcut } from "../../commands/registry";
import { noteTitle } from "../../vault/paths";
import { useVault } from "../../vault/store";

export function EmptyWorkspace() {
  const recent = useWorkspace((s) => s.recentFiles).slice(0, 6);
  const openNote = useWorkspace((s) => s.openNote);
  const noteCount = useVault((s) => s.entries.filter((e) => e.kind === "file" && /\.md$/i.test(e.path)).length);
  const actions: [string, string, string][] = [
    ["Create new note", "note.new", "Mod+N"],
    ["Open quick switcher", "nav.switcher", "Mod+O"],
    ["Search vault", "nav.search", "Mod+Shift+F"],
    ["Open command palette", "nav.palette", "Mod+P"],
  ];
  return (
    <div className="empty-workspace">
      <div className="empty-inner">
        <p className="empty-title">No note open</p>
        <p className="muted">{noteCount === 0 ? "This vault is empty. Create your first note to get started." : `${noteCount} notes in this vault.`}</p>
        <ul className="empty-actions">
          {actions.map(([label, id, sc]) => (
            <li key={id}>
              <button className="link-btn" onClick={() => runCommand(id)}>
                {label}
              </button>
              <kbd>{formatShortcut(sc)}</kbd>
            </li>
          ))}
        </ul>
        {recent.length > 0 && (
          <>
            <p className="section-label">Recent</p>
            <ul className="empty-actions">
              {recent.map((p) => (
                <li key={p}>
                  <button className="link-btn" onClick={() => openNote(p)}>
                    {noteTitle(p)}
                  </button>
                  <span className="muted small">{p}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
