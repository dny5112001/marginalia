/**
 * Central command + shortcut registry. Every app-level shortcut is declared
 * here exactly once; the palette, menus and the shortcut reference read from it.
 */

export interface Command {
  id: string;
  name: string;
  category: string;
  /** e.g. `Mod+Shift+F`. `Mod` = ⌘ on macOS, Ctrl elsewhere. */
  shortcut?: string;
  /** Run even when focus is in a text field (e.g. Mod+S, Mod+P). Default true for Mod shortcuts. */
  global?: boolean;
  enabled?: () => boolean;
  run: () => void | Promise<void>;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const commands = new Map<string, Command>();

export function registerCommands(list: Command[]) {
  for (const c of list) commands.set(c.id, c);
}

export function allCommands(): Command[] {
  return [...commands.values()];
}

export function getCommand(id: string) {
  return commands.get(id);
}

export function runCommand(id: string) {
  const c = commands.get(id);
  if (c && (c.enabled?.() ?? true)) void c.run();
}

const CODE_KEYS: Record<string, string> = {
  Backslash: "\\",
  Comma: ",",
  Period: ".",
  Slash: "/",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
};

/** Normalize a KeyboardEvent to the registry's notation, e.g. `Mod+Shift+F`. */
export function eventToShortcut(e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, mac = isMac): string {
  let key: string;
  if (e.code?.startsWith("Key")) key = e.code.slice(3);
  else if (e.code?.startsWith("Digit")) key = e.code.slice(5);
  else if (e.code && CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const parts: string[] = [];
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (mod) parts.push("Mod");
  if (mac && e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

export function normalizeShortcut(s: string, mac = isMac): string {
  // Off macOS, Ctrl and Mod are the same physical key.
  const parts = s.split("+").map((p) => (!mac && p === "Ctrl" ? "Mod" : p));
  const key = parts.pop()!;
  const order = ["Mod", "Ctrl", "Alt", "Shift"];
  const mods = order.filter((m) => parts.includes(m));
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join("+");
}

export function formatShortcut(s: string, mac = isMac): string {
  const parts = normalizeShortcut(s).split("+");
  const map: Record<string, string> = mac
    ? { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Tab: "⇥", Enter: "↩" }
    : { Mod: "Ctrl", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };
  return parts.map((p) => map[p] ?? p).join(mac ? "" : "+");
}

/** Shortcuts bound to more than one command. Should always be empty (tested). */
export function findConflicts(list: Command[] = allCommands()): string[] {
  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  for (const c of list) {
    if (!c.shortcut) continue;
    const k = normalizeShortcut(c.shortcut);
    if (seen.has(k)) conflicts.push(`${k}: ${seen.get(k)} / ${c.id}`);
    else seen.set(k, c.id);
  }
  return conflicts;
}

export function handleGlobalKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return;
  const sc = eventToShortcut(e);
  for (const c of commands.values()) {
    if (!c.shortcut || normalizeShortcut(c.shortcut) !== normalizeShortcut(sc)) continue;
    const target = e.target as HTMLElement | null;
    const inField = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
    const isGlobal = c.global ?? c.shortcut.includes("Mod");
    if (inField && !isGlobal) return;
    if (c.enabled && !c.enabled()) return;
    e.preventDefault();
    e.stopPropagation();
    void c.run();
    return;
  }
}
