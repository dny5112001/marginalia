//! Vault-relative path validation. Every path that crosses the IPC boundary is a
//! `/`-separated path relative to the vault root; nothing else is accepted.

use crate::error::{AppError, AppResult};
use std::path::{Component, Path, PathBuf};

/// Names the explorer and indexer never show.
pub fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

/// Validate a relative path syntactically and join it onto `root`.
/// Rejects absolute paths, `..`, drive prefixes, NUL bytes and empty paths.
pub fn join_checked(root: &Path, rel: &str) -> AppResult<PathBuf> {
    if rel.is_empty() || rel.contains('\0') {
        return Err(AppError::InvalidPath(rel.to_string()));
    }
    let rel_path = Path::new(rel);
    let mut out = root.to_path_buf();
    for comp in rel_path.components() {
        match comp {
            Component::Normal(part) => {
                let s = part.to_string_lossy();
                if s.contains('\\') && cfg!(windows) {
                    return Err(AppError::InvalidPath(rel.to_string()));
                }
                out.push(part)
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::OutsideVault(rel.to_string()));
            }
        }
    }
    if out == root {
        return Err(AppError::InvalidPath(rel.to_string()));
    }
    Ok(out)
}

/// Like `join_checked`, but also resolves symlinks of the deepest existing
/// ancestor and verifies the result still lives under the canonical root.
pub fn resolve(root: &Path, rel: &str) -> AppResult<PathBuf> {
    let joined = join_checked(root, rel)?;
    let canon_root = root
        .canonicalize()
        .map_err(|e| AppError::from_io(e, "<vault root>"))?;

    let mut existing = joined.as_path();
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
    while !existing.exists() {
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                tail.push(name);
                existing = parent;
            }
            _ => return Err(AppError::InvalidPath(rel.to_string())),
        }
    }
    let mut canon = existing
        .canonicalize()
        .map_err(|e| AppError::from_io(e, rel))?;
    for part in tail.into_iter().rev() {
        canon.push(part);
    }
    if !canon.starts_with(&canon_root) {
        return Err(AppError::OutsideVault(rel.to_string()));
    }
    Ok(canon)
}

/// Convert an absolute path under `root` back to a vault-relative `/` path.
pub fn to_rel(root: &Path, abs: &Path) -> Option<String> {
    let stripped = abs.strip_prefix(root).ok()?;
    let parts: Vec<String> = stripped
        .components()
        .filter_map(|c| match c {
            Component::Normal(p) => Some(p.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal_and_absolute() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(matches!(join_checked(root, "../x.md"), Err(AppError::OutsideVault(_))));
        assert!(matches!(join_checked(root, "a/../../x.md"), Err(AppError::OutsideVault(_))));
        assert!(matches!(join_checked(root, "/etc/passwd"), Err(AppError::OutsideVault(_))));
        assert!(matches!(join_checked(root, ""), Err(AppError::InvalidPath(_))));
        assert!(matches!(join_checked(root, "."), Err(AppError::InvalidPath(_))));
        assert!(matches!(join_checked(root, "a\0b"), Err(AppError::InvalidPath(_))));
    }

    #[test]
    fn accepts_nested_and_unicode() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let p = resolve(root, "Ideen/Über 日本語.md").unwrap();
        assert!(p.ends_with("Ideen/Über 日本語.md"));
        assert_eq!(to_rel(&root.canonicalize().unwrap(), &p).unwrap(), "Ideen/Über 日本語.md");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let outside = tempfile::tempdir().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
        assert!(matches!(resolve(dir.path(), "link/secret.md"), Err(AppError::OutsideVault(_))));
    }
}
