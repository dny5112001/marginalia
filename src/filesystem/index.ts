import type { VaultBackend } from "./backend";
import { MemoryBackend } from "./memoryBackend";
import { tauriBackend } from "./tauriBackend";
import { sandboxSeed } from "./sandboxSeed";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let backend: VaultBackend = isTauri ? tauriBackend : new MemoryBackend(sandboxSeed);

export function getBackend(): VaultBackend {
  return backend;
}

/** Tests swap in a MemoryBackend. */
export function setBackend(b: VaultBackend) {
  backend = b;
}

export { BackendError, toBackendError } from "./backend";
export type { VaultBackend } from "./backend";
