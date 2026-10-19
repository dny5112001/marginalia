import { useState } from "react";
import { X } from "lucide-react";
import { useUi } from "../../features/ui/store";
import { useSettings } from "../../settings/store";
import { allCommands, formatShortcut } from "../../commands/registry";
import type { ThemeMode, ViewMode } from "../../types";
import { formatDate } from "../../vault/dates";

type Section = "appearance" | "editor" | "files" | "shortcuts" | "about";

export function SettingsModal({ initial = "appearance" }: { initial?: Section }) {
  const [section, setSection] = useState<Section>(initial);
  const close = () => useUi.getState().setOverlay(null);
  const sections: [Section, string][] = [
    ["appearance", "Appearance"],
    ["editor", "Editor"],
    ["files", "Files & links"],
    ["shortcuts", "Keyboard shortcuts"],
    ["about", "About"],
  ];
  return (
    <div className="overlay-backdrop" onMouseDown={close}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && close()}>
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map(([id, label]) => (
            <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)} aria-current={section === id}>
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <button className="icon-btn settings-close" onClick={close} aria-label="Close settings" autoFocus>
            <X size={16} />
          </button>
          {section === "appearance" && <Appearance />}
          {section === "editor" && <EditorSettings />}
          {section === "files" && <FileSettings />}
          {section === "shortcuts" && <ShortcutList />}
          {section === "about" && <About />}
        </div>
      </div>
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-label">{label}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)} />;
}

function Appearance() {
  const { settings, update } = useSettings();
  return (
    <>
      <h2>Appearance</h2>
      <Row label="Theme" desc="System follows your operating system setting.">
        <div className="segmented text">
          {(["dark", "light", "system"] as ThemeMode[]).map((t) => (
            <button key={t} className={settings.theme === t ? "active" : ""} aria-pressed={settings.theme === t} onClick={() => update({ theme: t })}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </Row>
    </>
  );
}

function EditorSettings() {
  const { settings, update } = useSettings();
  return (
    <>
      <h2>Editor</h2>
      <Row label="Font size" desc="Applies to the editor and reading view.">
        <input type="range" min={10} max={28} value={settings.editorFontSize} onChange={(e) => update({ editorFontSize: Number(e.target.value) })} aria-label="Editor font size" />
        <span className="mono small">{settings.editorFontSize}px</span>
      </Row>
      <Row label="Line numbers">
        <Toggle label="Line numbers" checked={settings.lineNumbers} onChange={(v) => update({ lineNumbers: v })} />
      </Row>
      <Row label="Wrap long lines">
        <Toggle label="Wrap long lines" checked={settings.lineWrapping} onChange={(v) => update({ lineWrapping: v })} />
      </Row>
      <Row label="Autosave delay" desc="How long to wait after you stop typing before writing to disk.">
        <select className="input" value={settings.autosaveDelayMs} onChange={(e) => update({ autosaveDelayMs: Number(e.target.value) })} aria-label="Autosave delay">
          {[300, 800, 1500, 3000, 5000].map((ms) => (
            <option key={ms} value={ms}>
              {ms < 1000 ? `${ms} ms` : `${ms / 1000} s`}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Live Preview" desc="Hide Markdown syntax except on the line you're editing. Turn off for plain source mode.">
        <Toggle label="Live Preview" checked={settings.livePreview} onChange={(v) => update({ livePreview: v })} />
      </Row>
      <Row label="Readable line length" desc="Limit the maximum line width for easier reading.">
        <Toggle label="Readable line length" checked={settings.readableLineLength} onChange={(v) => update({ readableLineLength: v })} />
      </Row>
      <Row label="Spellcheck">
        <Toggle label="Spellcheck" checked={settings.spellcheck} onChange={(v) => update({ spellcheck: v })} />
      </Row>
      <Row label="Default view for new tabs">
        <select className="input" value={settings.defaultViewMode} onChange={(e) => update({ defaultViewMode: e.target.value as ViewMode })} aria-label="Default view mode">
          <option value="edit">Editing</option>
          <option value="split">Split</option>
          <option value="preview">Reading</option>
        </select>
      </Row>
    </>
  );
}

function FolderInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [v, setV] = useState(value);
  return <input className="input" value={v} placeholder="(vault root)" aria-label={label} onChange={(e) => setV(e.target.value)} onBlur={() => onChange(v.trim())} />;
}

function DateFormatInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <span className="date-format">
      <input className="input" value={v} aria-label="Daily note name format" onChange={(e) => setV(e.target.value)} onBlur={() => onChange(v.trim() || "YYYY-MM-DD")} />
      <span className="muted small">{formatDate(new Date(), v || "YYYY-MM-DD")}</span>
    </span>
  );
}

function FileSettings() {
  const { settings, update } = useSettings();
  return (
    <>
      <h2>Files & links</h2>
      <Row label="Default location for new notes" desc="Also used when following a link to a note that doesn't exist yet.">
        <select className="input" value={settings.newNoteLocation} onChange={(e) => update({ newNoteLocation: e.target.value as typeof settings.newNoteLocation })} aria-label="Default location for new notes">
          <option value="root">Vault folder</option>
          <option value="current">Same folder as current note</option>
          <option value="folder">In the folder specified below</option>
        </select>
      </Row>
      {settings.newNoteLocation === "folder" && (
        <Row label="Folder for new notes">
          <FolderInput label="Folder for new notes" value={settings.newNoteFolder} onChange={(v) => update({ newNoteFolder: v })} />
        </Row>
      )}
      <Row label="Attachment folder" desc='Where pasted or dropped files are saved. Empty = vault root, "./" = next to the note, "./assets" = subfolder of the note&apos;s folder.'>
        <FolderInput label="Attachment folder" value={settings.attachmentFolder} onChange={(v) => update({ attachmentFolder: v })} />
      </Row>
      <Row label="Confirm before deleting" desc="Deleted files always go to the system trash.">
        <Toggle label="Confirm before deleting" checked={settings.confirmDelete} onChange={(v) => update({ confirmDelete: v })} />
      </Row>
      <Row label="Local file history" desc="Keep snapshots of earlier versions on this computer (outside the vault).">
        <Toggle label="Local file history" checked={settings.historyEnabled} onChange={(v) => update({ historyEnabled: v })} />
      </Row>
      <Row label="Snapshot interval" desc="Minimum minutes between two snapshots of the same note.">
        <input className="input" type="number" min={0} max={1440} style={{ width: 80 }} value={settings.historyIntervalMin} aria-label="Snapshot interval in minutes" onChange={(e) => update({ historyIntervalMin: Number(e.target.value) })} />
      </Row>
      <Row label="History length" desc="Days snapshots are kept.">
        <input className="input" type="number" min={1} max={3650} style={{ width: 80 }} value={settings.historyKeepDays} aria-label="Days to keep snapshots" onChange={(e) => update({ historyKeepDays: Number(e.target.value) })} />
      </Row>
      <Row label="Update links when renaming" desc="Rewrite [[links]] in other notes when a note is renamed or moved.">
        <Toggle label="Update links when renaming" checked={settings.updateLinksOnRename} onChange={(v) => update({ updateLinksOnRename: v })} />
      </Row>
      <Row label="Daily notes" desc="Enables the daily note command (named YYYY-MM-DD).">
        <Toggle label="Daily notes" checked={settings.dailyNotesEnabled} onChange={(v) => update({ dailyNotesEnabled: v })} />
      </Row>
      <Row label="Daily note name format" desc="Tokens: YYYY MM DD ddd dddd MMMM, [literal text].">
        <DateFormatInput value={settings.dailyNoteFormat} onChange={(v) => update({ dailyNoteFormat: v })} />
      </Row>
      <Row label="Daily note template" desc="Path or name of a note to use as the template (optional).">
        <FolderInput label="Daily note template" value={settings.dailyNoteTemplate} onChange={(v) => update({ dailyNoteTemplate: v })} />
      </Row>
      <Row label="Daily notes folder">
        <FolderInput label="Daily notes folder" value={settings.dailyNoteFolder} onChange={(v) => update({ dailyNoteFolder: v })} />
      </Row>
      <Row label="Templates folder" desc="Notes here can be inserted with “Insert template”. Supports {{title}}, {{date}}, {{time}}.">
        <FolderInput label="Templates folder" value={settings.templatesFolder} onChange={(v) => update({ templatesFolder: v })} />
      </Row>
    </>
  );
}

const EDITOR_SHORTCUTS: [string, string][] = [
  ["Mod+B", "Bold"],
  ["Mod+I", "Italic"],
  ["Mod+Shift+X", "Strikethrough"],
  ["Mod+`", "Inline code"],
  ["Mod+K", "Wrap selection in [[link]]"],
  ["Mod+L", "Toggle checklist item"],
  ["Alt+Enter", "Follow link under cursor"],
  ["Mod+Enter", "Open link under cursor in new tab"],
  ["Mod+Click", "Follow link (Mod+Alt+Click: new tab)"],
  ["Mod+F", "Find in note"],
  ["Mod+Alt+F", "Find and replace"],
  ["Mod+Z", "Undo"],
  ["Mod+Shift+Z", "Redo"],
];

export function ShortcutList() {
  const cmds = allCommands()
    .filter((c) => c.shortcut)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return (
    <>
      <h2>Keyboard shortcuts</h2>
      <table className="shortcut-table">
        <tbody>
          {cmds.map((c) => (
            <tr key={c.id}>
              <td className="muted small">{c.category}</td>
              <td>{c.name}</td>
              <td>
                <kbd>{formatShortcut(c.shortcut!)}</kbd>
              </td>
            </tr>
          ))}
          {EDITOR_SHORTCUTS.map(([sc, name]) => (
            <tr key={sc}>
              <td className="muted small">Editor</td>
              <td>{name}</td>
              <td>
                <kbd>{sc.includes("Click") ? sc.replace("Mod", formatShortcut("Mod")) : formatShortcut(sc)}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function About() {
  return (
    <>
      <h2>About Marginalia</h2>
      <p>A local-first Markdown knowledge base. Your notes are plain files in the folder you chose; Marginalia never uploads them and collects no telemetry.</p>
      <p className="muted small">The search and link index lives in memory and is rebuilt from your files each time a vault opens.</p>
    </>
  );
}

export function ShortcutsModal() {
  return <SettingsModal initial="shortcuts" />;
}
