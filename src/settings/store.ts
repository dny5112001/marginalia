import { create } from "zustand";
import type { Settings } from "../types";
import { readJson, writeJson } from "./storage";

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  editorFontSize: 15,
  lineNumbers: false,
  lineWrapping: true,
  autosaveDelayMs: 800,
  newNoteFolder: "",
  attachmentFolder: "",
  dailyNotesEnabled: true,
  dailyNoteFolder: "Daily",
  templatesFolder: "Templates",
  updateLinksOnRename: true,
  defaultViewMode: "edit",
};

const KEY = "marginalia:settings";

/** Coerce unknown stored data into valid settings, dropping bad values. */
export function sanitizeSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return s;
  const r = raw as Record<string, unknown>;
  if (r.theme === "dark" || r.theme === "light" || r.theme === "system") s.theme = r.theme;
  if (typeof r.editorFontSize === "number" && r.editorFontSize >= 10 && r.editorFontSize <= 28) s.editorFontSize = r.editorFontSize;
  if (typeof r.lineNumbers === "boolean") s.lineNumbers = r.lineNumbers;
  if (typeof r.lineWrapping === "boolean") s.lineWrapping = r.lineWrapping;
  if (typeof r.autosaveDelayMs === "number" && r.autosaveDelayMs >= 200 && r.autosaveDelayMs <= 10000) s.autosaveDelayMs = r.autosaveDelayMs;
  for (const k of ["newNoteFolder", "attachmentFolder", "dailyNoteFolder", "templatesFolder"] as const) {
    if (typeof r[k] === "string" && !(r[k] as string).includes("..")) s[k] = (r[k] as string).replace(/^\/+|\/+$/g, "");
  }
  if (typeof r.dailyNotesEnabled === "boolean") s.dailyNotesEnabled = r.dailyNotesEnabled;
  if (typeof r.updateLinksOnRename === "boolean") s.updateLinksOnRename = r.updateLinksOnRename;
  if (r.defaultViewMode === "edit" || r.defaultViewMode === "preview" || r.defaultViewMode === "split") s.defaultViewMode = r.defaultViewMode;
  return s;
}

interface SettingsStore {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: sanitizeSettings(readJson(KEY)),
  update: (patch) => {
    const settings = sanitizeSettings({ ...get().settings, ...patch });
    writeJson(KEY, settings);
    set({ settings });
  },
  reset: () => {
    writeJson(KEY, DEFAULT_SETTINGS);
    set({ settings: { ...DEFAULT_SETTINGS } });
  },
}));

export const getSettings = () => useSettings.getState().settings;
