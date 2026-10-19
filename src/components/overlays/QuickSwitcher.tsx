import { useMemo, useState } from "react";
import { FuzzyModal, type FuzzyItem } from "./FuzzyModal";
import { useUi } from "../../features/ui/store";
import { useWorkspace } from "../../features/workspace/store";
import { createNote, vaultIndex } from "../../vault/store";
import { fuzzyFilter } from "../../search/fuzzy";
import { dirname, noteTitle, validateName } from "../../vault/paths";
import { formatShortcut } from "../../commands/registry";
import { toast } from "../../features/ui/store";

export function QuickSwitcher() {
  const [query, setQuery] = useState("");
  const close = () => useUi.getState().setOverlay(null);
  const recent = useWorkspace((s) => s.recentFiles);
  const items = useMemo<FuzzyItem[]>(() => {
    const notes = vaultIndex.notePaths();
    if (!query.trim()) {
      const rec = recent.filter((p) => vaultIndex.hasFile(p));
      const rest = notes.filter((p) => !rec.includes(p));
      return [...rec, ...rest].slice(0, 60).map((p) => ({ id: p, label: noteTitle(p), detail: dirname(p), hint: rec.includes(p) ? "recent" : undefined }));
    }
    // Match against title and aliases; also the full path so "folder/name" works.
    const candidates = notes.flatMap((p) => {
      const parsed = vaultIndex.get(p);
      return [
        { path: p, text: noteTitle(p), alias: false },
        ...(parsed?.aliases ?? []).map((a) => ({ path: p, text: a, alias: true })),
        ...(query.includes("/") ? [{ path: p, text: p, alias: false }] : []),
      ];
    });
    const seen = new Set<string>();
    return fuzzyFilter(query, candidates, (c) => c.text, 80)
      .filter(({ item }) => (seen.has(item.path) ? false : (seen.add(item.path), true)))
      .map(({ item, indices }) => ({ id: item.path, label: item.text, indices, detail: item.alias ? `alias of ${noteTitle(item.path)}` : dirname(item.path) }));
  }, [query, recent]);

  return (
    <FuzzyModal
      placeholder="Find or create a note…"
      items={items}
      query={query}
      onQuery={setQuery}
      onClose={close}
      emptyText={query.trim() ? `No note named "${query}". Press Enter to create it.` : "No notes yet."}
      onChoose={(item, { newTab, create }) => {
        close();
        if (create || !item.id) {
          const name = (item.id ? query : item.label).trim();
          const err = validateName(name.split("/").pop() ?? "");
          if (err) return toast(err, "error");
          const parts = name.split("/");
          const title = parts.pop()!;
          void createNote(parts.length ? parts.join("/") : undefined, title, "", { newTab });
          return;
        }
        useWorkspace.getState().openNote(item.id, { newTab });
      }}
      footer={
        <>
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↩</kbd> open</span>
          <span><kbd>{formatShortcut("Mod+Enter")}</kbd> new tab</span>
          <span><kbd>⇧↩</kbd> create</span>
          <span><kbd>esc</kbd> close</span>
        </>
      }
    />
  );
}
