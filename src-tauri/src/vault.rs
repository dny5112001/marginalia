//! Vault session state, the approved-vault registry and the file watcher.
//!
//! Security model: the frontend can never name an arbitrary absolute path.
//! A vault becomes accessible only after the user picks it in a native folder
//! dialog (or created it via one); that path is recorded in the app's config
//! directory, and later re-opening is restricted to recorded paths.

use crate::error::{AppError, AppResult};
use crate::paths::{is_hidden_name, to_rel};
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub path: String,
    pub name: String,
    pub last_opened: u64,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct Registry {
    vaults: Vec<VaultInfo>,
}

#[derive(Default)]
pub struct VaultState {
    root: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>,
}

impl VaultState {
    pub fn root(&self) -> AppResult<PathBuf> {
        self.root.lock().unwrap().clone().ok_or(AppError::NoVault)
    }
}

fn registry_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    fs::create_dir_all(&dir).map_err(|e| AppError::from_io(e, "config dir"))?;
    Ok(dir.join("vaults.json"))
}

fn load_registry(app: &AppHandle) -> Registry {
    registry_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        // A corrupt registry is treated as empty; vault data itself is untouched.
        .unwrap_or_default()
}

fn save_registry(app: &AppHandle, reg: &Registry) -> AppResult<()> {
    let path = registry_path(app)?;
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(reg).map_err(|e| AppError::Io(e.to_string()))?;
    fs::write(&tmp, data).map_err(|e| AppError::from_io(e, "vaults.json"))?;
    fs::rename(&tmp, &path).map_err(|e| AppError::from_io(e, "vaults.json"))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn list_vaults(app: &AppHandle) -> Vec<VaultInfo> {
    let mut v = load_registry(app).vaults;
    v.sort_by_key(|x| std::cmp::Reverse(x.last_opened));
    v
}

pub fn forget_vault(app: &AppHandle, path: &str) -> AppResult<()> {
    let mut reg = load_registry(app);
    reg.vaults.retain(|v| v.path != path);
    save_registry(app, &reg)
}

/// Activate a vault path that the user selected through a trusted channel.
pub fn activate(app: &AppHandle, state: &VaultState, path: PathBuf) -> AppResult<VaultInfo> {
    let canon = path.canonicalize().map_err(|e| AppError::from_io(e, &path.to_string_lossy()))?;
    if !canon.is_dir() {
        return Err(AppError::InvalidPath(canon.to_string_lossy().into_owned()));
    }
    let info = VaultInfo {
        path: canon.to_string_lossy().into_owned(),
        name: canon.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Vault".into()),
        last_opened: now_ms(),
    };
    let mut reg = load_registry(app);
    reg.vaults.retain(|v| v.path != info.path);
    reg.vaults.push(info.clone());
    save_registry(app, &reg)?;

    *state.root.lock().unwrap() = Some(canon.clone());
    start_watcher(app, state, &canon);
    Ok(info)
}

/// Re-open a vault only if it was previously approved by the user.
pub fn open_known(app: &AppHandle, state: &VaultState, path: &str) -> AppResult<VaultInfo> {
    let reg = load_registry(app);
    if !reg.vaults.iter().any(|v| v.path == path) {
        return Err(AppError::NotApproved(path.to_string()));
    }
    let p = PathBuf::from(path);
    if !p.is_dir() {
        return Err(AppError::NotFound(path.to_string()));
    }
    activate(app, state, p)
}

pub fn close(state: &VaultState) {
    *state.watcher.lock().unwrap() = None;
    *state.root.lock().unwrap() = None;
}

fn is_relevant(rel: &str) -> bool {
    !rel.split('/').any(is_hidden_name) && !rel.ends_with(".tmp")
}

fn start_watcher(app: &AppHandle, state: &VaultState, root: &Path) {
    let handle = app.clone();
    let root_owned = root.to_path_buf();
    let debouncer = new_debouncer(Duration::from_millis(250), move |res: DebounceEventResult| {
        if let Ok(events) = res {
            let mut paths: Vec<String> = events
                .iter()
                .filter_map(|e| to_rel(&root_owned, &e.path))
                .filter(|p| is_relevant(p))
                .collect();
            paths.sort();
            paths.dedup();
            if !paths.is_empty() {
                let _ = handle.emit("vault-changed", paths);
            }
        }
    });
    match debouncer {
        Ok(mut d) => {
            if d.watcher().watch(root, RecursiveMode::Recursive).is_ok() {
                *state.watcher.lock().unwrap() = Some(d);
            }
        }
        Err(e) => eprintln!("file watcher unavailable: {e}"),
    }
}
