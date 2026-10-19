import { create } from "zustand";
import type { Settings } from "../types";
import { readJson, writeJson } from "./storage";

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  editorFontSize: 15,
  lineNumbers: false,
  lineWrapping: true,
  livePreview: true,
  readableLineLength: true,
  spellcheck: true,
  autosaveDelayMs: 800,
  newNoteFolder: "",
  attachmentFolder: "",
  dailyNotesEnabled: true,
  dailyNoteFolder: "Daily",
  templatesFolder: "Templates",
  updateLinksOnRename: true,
  defaultViewMode: "edit",
  historyEnabled: true,
  historyIntervalMin: 5,
  historyKeepDays: 7,
  confirmDelete: true,
  newNoteLocation: "folder",
  dailyNoteFormat: "YYYY-MM-DD",
  dailyNoteTemplate: "",
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
  for (const k of ["livePreview", "readableLineLength", "spellcheck"] as const) if (typeof r[k] === "boolean") s[k] = r[k] as boolean;
  if (typeof r.autosaveDelayMs === "number" && r.autosaveDelayMs >= 200 && r.autosaveDelayMs <= 10000) s.autosaveDelayMs = r.autosaveDelayMs;
  for (const k of ["newNoteFolder", "attachmentFolder", "dailyNoteFolder", "templatesFolder"] as const) {
    if (typeof r[k] === "string" && !(r[k] as string).includes("..")) s[k] = (r[k] as string).replace(/^\/+|\/+$/g, "");
  }
  if (typeof r.dailyNotesEnabled === "boolean") s.dailyNotesEnabled = r.dailyNotesEnabled;
  if (typeof r.updateLinksOnRename === "boolean") s.updateLinksOnRename = r.updateLinksOnRename;
  if (r.defaultViewMode === "edit" || r.defaultViewMode === "preview" || r.defaultViewMode === "split") s.defaultViewMode = r.defaultViewMode;
  if (typeof r.historyEnabled === "boolean") s.historyEnabled = r.historyEnabled;
  if (typeof r.historyIntervalMin === "number" && r.historyIntervalMin >= 0 && r.historyIntervalMin <= 1440) s.historyIntervalMin = r.historyIntervalMin;
  if (typeof r.historyKeepDays === "number" && r.historyKeepDays >= 1 && r.historyKeepDays <= 3650) s.historyKeepDays = r.historyKeepDays;
  if (typeof r.confirmDelete === "boolean") s.confirmDelete = r.confirmDelete;
  if (r.newNoteLocation === "root" || r.newNoteLocation === "current" || r.newNoteLocation === "folder") s.newNoteLocation = r.newNoteLocation;
  if (typeof r.dailyNoteFormat === "string" && r.dailyNoteFormat.trim() && !/[\\/:*?"<>|]/.test(r.dailyNoteFormat)) s.dailyNoteFormat = r.dailyNoteFormat.trim();
  if (typeof r.dailyNoteTemplate === "string" && !r.dailyNoteTemplate.includes("..")) s.dailyNoteTemplate = r.dailyNoteTemplate.trim();
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
