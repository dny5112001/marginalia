import type { BackendErrorKind, FileEntry, TextFile, VaultInfo } from "../types";

/** Error thrown by every backend operation; `kind` mirrors the Rust `AppError`. */
export class BackendError extends Error {
  constructor(
    public kind: BackendErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

export function toBackendError(e: unknown): BackendError {
  if (e instanceof BackendError) return e;
  if (e && typeof e === "object" && "kind" in e && "message" in e) {
    const o = e as { kind: BackendErrorKind; message: string };
    return new BackendError(o.kind, o.message);
  }
  return new BackendError("io", e instanceof Error ? e.message : String(e));
}

/**
 * The only way the UI touches the filesystem. Paths are always vault-relative;
 * the native implementation validates them again on the Rust side.
 */
export interface VaultBackend {
  readonly native: boolean;
  pickOpenVault(): Promise<VaultInfo | null>;
  pickCreateVault(name: string): Promise<VaultInfo | null>;
  openKnownVault(path: string): Promise<VaultInfo>;
  listKnownVaults(): Promise<VaultInfo[]>;
  forgetVault(path: string): Promise<void>;
  closeVault(): Promise<void>;

  list(): Promise<FileEntry[]>;
  readText(path: string): Promise<TextFile>;
  readAllMarkdown(): Promise<TextFile[]>;
  readBase64(path: string): Promise<string>;
  /** Atomic write. With `expectedMtime`, fails with kind `conflict` if the file changed on disk. Returns new mtime. */
  writeText(path: string, content: string, expectedMtime?: number): Promise<number>;
  /** Creates a new file; fails with `alreadyExists` rather than overwriting. */
  createFile(path: string, content: string): Promise<number>;
  createFolder(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Moves to the OS trash (or `.trash` in the vault). */
  remove(path: string): Promise<void>;
  /** Subscribe to external changes. Returns an unsubscribe function. */
  onChange(cb: (paths: string[]) => void): Promise<() => void>;
}
