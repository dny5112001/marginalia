import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { FileEntry, TextFile, VaultInfo } from "../types";
import { toBackendError, type VaultBackend } from "./backend";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toBackendError(e);
  }
}

export const tauriBackend: VaultBackend = {
  native: true,
  pickOpenVault: () => call<VaultInfo | null>("vault_pick_open"),
  pickCreateVault: (name) => call<VaultInfo | null>("vault_pick_create", { name }),
  openKnownVault: (path) => call<VaultInfo>("vault_open_known", { path }),
  listKnownVaults: () => call<VaultInfo[]>("vault_list_known"),
  forgetVault: (path) => call<void>("vault_forget", { path }),
  closeVault: () => call<void>("vault_close"),
  list: () => call<FileEntry[]>("fs_list"),
  readText: (path) => call<TextFile>("fs_read_text", { path }),
  readAllMarkdown: () => call<TextFile[]>("fs_read_all_markdown"),
  readBase64: (path) => call<string>("fs_read_base64", { path }),
  writeText: (path, content, expectedMtime) =>
    call<number>("fs_write_text", { path, content, expectedMtime: expectedMtime ?? null }),
  createFile: (path, content) => call<number>("fs_create_file", { path, content }),
  createFolder: (path) => call<void>("fs_create_folder", { path }),
  rename: (from, to) => call<void>("fs_rename", { from, to }),
  remove: (path) => call<void>("fs_delete", { path }),
  onChange: async (cb) => listen<string[]>("vault-changed", (e) => cb(e.payload)),
};
