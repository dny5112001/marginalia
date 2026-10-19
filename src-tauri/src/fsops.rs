//! Filesystem operations scoped to a vault root. All functions take the root
//! explicitly so they are unit-testable without a running Tauri app.

use crate::error::{AppError, AppResult};
use crate::paths::{is_hidden_name, resolve, to_rel};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::UNIX_EPOCH;

const MAX_TEXT_BYTES: u64 = 50 * 1024 * 1024;
const MAX_BINARY_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub kind: &'static str,
    pub size: u64,
    pub mtime: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub path: String,
    pub content: String,
    pub mtime: u64,
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn is_markdown(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// Walk the vault, skipping hidden entries. Returns a flat, sorted list.
pub fn list_tree(root: &Path) -> AppResult<Vec<FileEntry>> {
    let canon = root.canonicalize().map_err(|e| AppError::from_io(e, "<vault root>"))?;
    let mut out = Vec::new();
    let mut stack = vec![canon.clone()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            // Unreadable subfolders are skipped rather than failing the whole tree.
            Err(_) if dir != canon => continue,
            Err(e) => return Err(AppError::from_io(e, "<vault root>")),
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_hidden_name(&name) {
                continue;
            }
            let Ok(ft) = entry.file_type() else { continue };
            // Symlinks are not followed to keep the walk inside the vault.
            if ft.is_symlink() {
                continue;
            }
            let path = entry.path();
            let Some(rel) = to_rel(&canon, &path) else { continue };
            let meta = entry.metadata().ok();
            let (size, mtime) = meta.as_ref().map(|m| (m.len(), mtime_ms(m))).unwrap_or((0, 0));
            if ft.is_dir() {
                out.push(FileEntry { path: rel, kind: "dir", size: 0, mtime });
                stack.push(path);
            } else if ft.is_file() {
                out.push(FileEntry { path: rel, kind: "file", size, mtime });
            }
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

pub fn read_text(root: &Path, rel: &str) -> AppResult<TextFile> {
    let abs = resolve(root, rel)?;
    let meta = fs::metadata(&abs).map_err(|e| AppError::from_io(e, rel))?;
    if !meta.is_file() {
        return Err(AppError::InvalidPath(rel.to_string()));
    }
    if meta.len() > MAX_TEXT_BYTES {
        return Err(AppError::TooLarge(rel.to_string()));
    }
    let bytes = fs::read(&abs).map_err(|e| AppError::from_io(e, rel))?;
    let content = String::from_utf8_lossy(&bytes).into_owned();
    Ok(TextFile { path: rel.to_string(), content, mtime: mtime_ms(&meta) })
}

pub fn read_all_markdown(root: &Path) -> AppResult<Vec<TextFile>> {
    let mut out = Vec::new();
    for entry in list_tree(root)? {
        if entry.kind == "file" && is_markdown(&entry.path) {
            // A single unreadable note must not break indexing of the rest.
            if let Ok(f) = read_text(root, &entry.path) {
                out.push(f);
            }
        }
    }
    Ok(out)
}

pub fn read_binary(root: &Path, rel: &str) -> AppResult<Vec<u8>> {
    let abs = resolve(root, rel)?;
    let meta = fs::metadata(&abs).map_err(|e| AppError::from_io(e, rel))?;
    if meta.len() > MAX_BINARY_BYTES {
        return Err(AppError::TooLarge(rel.to_string()));
    }
    fs::read(&abs).map_err(|e| AppError::from_io(e, rel))
}

/// Atomic write: write to a temp file in the same directory, fsync, rename over
/// the target. If `expected_mtime` is given and the file on disk has a different
/// mtime, the write is refused with `Conflict` so external edits aren't clobbered.
pub fn write_text(root: &Path, rel: &str, content: &str, expected_mtime: Option<u64>) -> AppResult<u64> {
    let abs = resolve(root, rel)?;
    if let Some(expected) = expected_mtime {
        match fs::metadata(&abs) {
            Ok(meta) if mtime_ms(&meta) != expected => return Err(AppError::Conflict(rel.to_string())),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(AppError::from_io(e, rel)),
        }
    }
    let parent = abs.parent().ok_or_else(|| AppError::InvalidPath(rel.to_string()))?;
    if !parent.exists() {
        return Err(AppError::NotFound(format!("folder for {rel}")));
    }
    let file_name = abs.file_name().unwrap().to_string_lossy();
    let tmp = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
        // Preserve permissions of an existing file.
        if let Ok(meta) = fs::metadata(&abs) {
            let _ = fs::set_permissions(&tmp, meta.permissions());
        }
        fs::rename(&tmp, &abs)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(AppError::from_io(e, rel));
    }
    let meta = fs::metadata(&abs).map_err(|e| AppError::from_io(e, rel))?;
    Ok(mtime_ms(&meta))
}

/// Create a new file; never overwrites.
pub fn create_file(root: &Path, rel: &str, content: &str) -> AppResult<u64> {
    let abs = resolve(root, rel)?;
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::from_io(e, rel))?;
    }
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&abs)
        .map_err(|e| AppError::from_io(e, rel))?;
    f.write_all(content.as_bytes()).map_err(|e| AppError::from_io(e, rel))?;
    f.sync_all().map_err(|e| AppError::from_io(e, rel))?;
    let meta = fs::metadata(&abs).map_err(|e| AppError::from_io(e, rel))?;
    Ok(mtime_ms(&meta))
}

pub fn create_folder(root: &Path, rel: &str) -> AppResult<()> {
    let abs = resolve(root, rel)?;
    if abs.exists() {
        return Err(AppError::AlreadyExists(rel.to_string()));
    }
    fs::create_dir_all(&abs).map_err(|e| AppError::from_io(e, rel))
}

/// Rename or move. Refuses to overwrite an existing target. A case-only rename
/// on a case-insensitive filesystem is allowed.
pub fn rename(root: &Path, from: &str, to: &str) -> AppResult<()> {
    let src = resolve(root, from)?;
    let dst = resolve(root, to)?;
    if !src.exists() {
        return Err(AppError::NotFound(from.to_string()));
    }
    let case_only = from.to_lowercase() == to.to_lowercase() && from != to;
    if dst.exists() && !case_only {
        return Err(AppError::AlreadyExists(to.to_string()));
    }
    if dst.starts_with(&src) && src != dst {
        return Err(AppError::InvalidPath(format!("cannot move {from} into itself")));
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::from_io(e, to))?;
    }
    fs::rename(&src, &dst).map_err(|e| AppError::from_io(e, from))
}

/// Delete by moving to the OS trash; if unavailable, move into `<vault>/.trash`
/// so data is always recoverable.
pub fn delete(root: &Path, rel: &str) -> AppResult<()> {
    let abs = resolve(root, rel)?;
    if !abs.exists() {
        return Err(AppError::NotFound(rel.to_string()));
    }
    if trash::delete(&abs).is_ok() {
        return Ok(());
    }
    let trash_dir = root.join(".trash");
    fs::create_dir_all(&trash_dir).map_err(|e| AppError::from_io(e, ".trash"))?;
    let name = abs.file_name().unwrap().to_string_lossy().into_owned();
    let mut target = trash_dir.join(&name);
    let mut n = 1;
    while target.exists() {
        target = trash_dir.join(format!("{n} {name}"));
        n += 1;
    }
    fs::rename(&abs, &target).map_err(|e| AppError::from_io(e, rel))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_write_read_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let m1 = create_file(root, "notes/Hello.md", "# Hi").unwrap();
        assert!(matches!(create_file(root, "notes/Hello.md", "x"), Err(AppError::AlreadyExists(_))));
        let m2 = write_text(root, "notes/Hello.md", "# Hi\n\nbody ünïcode", Some(m1)).unwrap();
        let f = read_text(root, "notes/Hello.md").unwrap();
        assert_eq!(f.content, "# Hi\n\nbody ünïcode");
        assert_eq!(f.mtime, m2);
        // No temp files left behind.
        let leftovers: Vec<_> = fs::read_dir(root.join("notes")).unwrap().flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp")).collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn write_detects_external_change() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let m1 = create_file(root, "a.md", "one").unwrap();
        assert!(matches!(write_text(root, "a.md", "two", Some(m1 + 5000)), Err(AppError::Conflict(_))));
        assert_eq!(read_text(root, "a.md").unwrap().content, "one");
    }

    #[test]
    fn write_into_missing_folder_fails_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(write_text(dir.path(), "nope/a.md", "x", None), Err(AppError::NotFound(_))));
    }

    #[test]
    fn rename_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        create_file(root, "a.md", "A").unwrap();
        create_file(root, "b.md", "B").unwrap();
        assert!(matches!(rename(root, "a.md", "b.md"), Err(AppError::AlreadyExists(_))));
        rename(root, "a.md", "sub/c.md").unwrap();
        assert_eq!(read_text(root, "sub/c.md").unwrap().content, "A");
        assert!(matches!(rename(root, "sub", "sub/inner"), Err(AppError::InvalidPath(_))));
    }

    #[test]
    fn tree_skips_hidden_and_lists_nested() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        create_file(root, "x/y/z.md", "").unwrap();
        create_file(root, ".git/config", "").unwrap();
        create_file(root, "img.png", "").unwrap();
        let tree = list_tree(root).unwrap();
        let paths: Vec<_> = tree.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, vec!["img.png", "x", "x/y", "x/y/z.md"]);
        assert_eq!(read_all_markdown(root).unwrap().len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn permission_error_is_reported() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        create_file(root, "locked/a.md", "x").unwrap();
        fs::set_permissions(root.join("locked"), fs::Permissions::from_mode(0o500)).unwrap();
        let res = write_text(root, "locked/a.md", "y", None);
        fs::set_permissions(root.join("locked"), fs::Permissions::from_mode(0o700)).unwrap();
        assert!(matches!(res, Err(AppError::PermissionDenied(_))));
        assert_eq!(read_text(root, "locked/a.md").unwrap().content, "x");
    }
}
