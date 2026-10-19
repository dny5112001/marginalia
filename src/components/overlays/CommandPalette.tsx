import { useMemo, useState } from "react";
import { FuzzyModal } from "./FuzzyModal";
import { useUi } from "../../features/ui/store";
import { allCommands, formatShortcut, runCommand } from "../../commands/registry";
import { fuzzyFilter } from "../../search/fuzzy";

const RECENT_KEY = "marginalia:recentCommands";

function recentCommands(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function CommandPalette() {
  const [query, setQuery] = useState("");
  const close = () => useUi.getState().setOverlay(null);
  const items = useMemo(() => {
    const cmds = allCommands().filter((c) => c.enabled?.() ?? true);
    const label = (c: (typeof cmds)[number]) => `${c.category}: ${c.name}`;
    if (!query.trim()) {
      const rec = recentCommands();
      cmds.sort((a, b) => {
        const ra = rec.indexOf(a.id);
        const rb = rec.indexOf(b.id);
        if (ra !== rb) return (ra === -1 ? 999 : ra) - (rb === -1 ? 999 : rb);
        return label(a).localeCompare(label(b));
      });
      return cmds.map((c) => ({ id: c.id, label: label(c), hint: c.shortcut && formatShortcut(c.shortcut) }));
    }
    return fuzzyFilter(query, cmds, label, 60).map(({ item, indices }) => ({
      id: item.id,
      label: label(item),
      indices,
      hint: item.shortcut && formatShortcut(item.shortcut),
    }));
  }, [query]);

  return (
    <FuzzyModal
      placeholder="Type a command…"
      items={items}
      query={query}
      onQuery={setQuery}
      onClose={close}
      onChoose={(item) => {
        if (!item.id) return;
        close();
        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify([item.id, ...recentCommands().filter((x) => x !== item.id)].slice(0, 8)));
        } catch {
          /* ignore */
        }
        // Let the modal unmount (and focus return) before running.
        setTimeout(() => runCommand(item.id), 0);
      }}
    />
  );
}
