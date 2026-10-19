/** Helpers for vault-relative `/`-separated paths. */

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function extname(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i).toLowerCase();
}

export function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? name : name.slice(0, i);
}

export function noteTitle(path: string): string {
  return stripExt(basename(path));
}

export function joinPath(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split("/"))
    .filter((p) => p !== "" && p !== ".")
    .join("/");
}

export function isMarkdown(path: string): boolean {
  const e = extname(path);
  return e === ".md" || e === ".markdown";
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"]);
export function isImage(path: string): boolean {
  return IMAGE_EXT.has(extname(path));
}

/** Resolve `rel` (possibly with `..`) against folder `base`; returns null if it escapes the vault. */
export function resolveRelative(base: string, rel: string): string | null {
  const out: string[] = base ? base.split("/") : [];
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

const INVALID_CHARS = /[\\/:*?"<>|#^[\]\0]/;

/** Validate a single file or folder name typed by the user. Returns an error message or null. */
export function validateName(name: string): string | null {
  const n = name.trim();
  if (!n) return "Name cannot be empty.";
  if (n.startsWith(".")) return "Name cannot start with a dot.";
  if (INVALID_CHARS.test(n)) return 'Name cannot contain any of \\ / : * ? " < > | # ^ [ ]';
  if (n.length > 200) return "Name is too long.";
  return null;
}

/** Pick `Base.md`, `Base 1.md`, `Base 2.md`… that is not in `taken` (case-insensitive). */
export function uniquePath(desired: string, taken: Iterable<string>): string {
  const lower = new Set([...taken].map((t) => t.toLowerCase()));
  if (!lower.has(desired.toLowerCase())) return desired;
  const dir = dirname(desired);
  const ext = extname(desired);
  const stem = stripExt(basename(desired));
  for (let i = 1; ; i++) {
    const candidate = joinPath(dir, `${stem} ${i}${ext}`);
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

export function isAncestor(folder: string, path: string): boolean {
  return path === folder || path.startsWith(folder + "/");
}

/** Re-root `path` when `from` (a file or folder) moved to `to`. */
export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (path.startsWith(from + "/")) return to + path.slice(from.length);
  return path;
}
