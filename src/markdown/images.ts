import { getBackend } from "../filesystem";
import { vaultIndex } from "../vault/store";
import { dirname, extname, resolveRelative } from "../vault/paths";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};
const cache = new Map<string, string>();

/** Resolve an image reference written in `sourcePath` to a vault path. */
export function resolveImagePath(target: string, kind: "wiki" | "markdown", sourcePath: string): string | null {
  if (kind === "wiki") return vaultIndex.resolveTarget(target, sourcePath);
  let decoded = target;
  try {
    decoded = decodeURI(target);
  } catch {
    /* keep raw */
  }
  return vaultIndex.resolveLink({ target: decoded, kind: "markdown" }, sourcePath) ?? resolveRelative(dirname(sourcePath), decoded);
}

/** Load a vault image through the backend as a data URL (never via arbitrary URLs). Returns null if missing. */
export async function loadVaultImage(target: string, kind: "wiki" | "markdown", sourcePath: string): Promise<string | null> {
  const path = resolveImagePath(target, kind, sourcePath);
  const mime = path ? MIME[extname(path)] : undefined;
  if (!path || !mime) return null;
  const hit = cache.get(path);
  if (hit) return hit;
  try {
    const url = `data:${mime};base64,${await getBackend().readBase64(path)}`;
    if (cache.size > 100) cache.clear();
    cache.set(path, url);
    return url;
  } catch {
    return null;
  }
}

/** Drop cached data for a path (after it changes on disk). */
export function invalidateImage(path: string) {
  cache.delete(path);
}
