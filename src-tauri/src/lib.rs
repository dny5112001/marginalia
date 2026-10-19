mod error;
mod fsops;
mod paths;
mod vault;

use base64::Engine;
use error::{AppError, AppResult};
use fsops::{FileEntry, TextFile};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use vault::{VaultInfo, VaultState};

fn pick_folder(app: &AppHandle, title: &str) -> AppResult<Option<std::path::PathBuf>> {
    let picked = app.dialog().file().set_title(title).blocking_pick_folder();
    match picked {
        None => Ok(None),
        Some(fp) => fp.into_path().map(Some).map_err(|e| AppError::Io(e.to_string())),
    }
}

#[tauri::command]
async fn vault_pick_open(app: AppHandle, state: State<'_, VaultState>) -> AppResult<Option<VaultInfo>> {
    match pick_folder(&app, "Open folder as vault")? {
        None => Ok(None),
        Some(p) => vault::activate(&app, &state, p).map(Some),
    }
}

#[tauri::command]
async fn vault_pick_create(app: AppHandle, state: State<'_, VaultState>, name: String) -> AppResult<Option<VaultInfo>> {
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\', '\0']) || name.starts_with('.') {
        return Err(AppError::InvalidPath(name.to_string()));
    }
    let Some(parent) = pick_folder(&app, "Choose where to create the vault")? else {
        return Ok(None);
    };
    let target = parent.join(name);
    if target.exists() {
        return Err(AppError::AlreadyExists(target.to_string_lossy().into_owned()));
    }
    std::fs::create_dir_all(&target).map_err(|e| AppError::from_io(e, name))?;
    let info = vault::activate(&app, &state, target.clone())?;
    let welcome = "# Welcome\n\nThis vault is a plain folder of Markdown files.\n\n- Link notes with [[wikilinks]]\n- Tag ideas with #tags\n- Press Mod+P for the command palette\n";
    let _ = fsops::create_file(&target, "Welcome.md", welcome);
    Ok(Some(info))
}

#[tauri::command]
async fn vault_open_known(app: AppHandle, state: State<'_, VaultState>, path: String) -> AppResult<VaultInfo> {
    vault::open_known(&app, &state, &path)
}

#[tauri::command]
fn vault_list_known(app: AppHandle) -> Vec<VaultInfo> {
    vault::list_vaults(&app)
}

#[tauri::command]
fn vault_forget(app: AppHandle, path: String) -> AppResult<()> {
    vault::forget_vault(&app, &path)
}

#[tauri::command]
fn vault_close(state: State<'_, VaultState>) {
    vault::close(&state)
}

#[tauri::command]
async fn fs_list(state: State<'_, VaultState>) -> AppResult<Vec<FileEntry>> {
    fsops::list_tree(&state.root()?)
}

#[tauri::command]
async fn fs_read_text(state: State<'_, VaultState>, path: String) -> AppResult<TextFile> {
    fsops::read_text(&state.root()?, &path)
}

#[tauri::command]
async fn fs_read_all_markdown(state: State<'_, VaultState>) -> AppResult<Vec<TextFile>> {
    fsops::read_all_markdown(&state.root()?)
}

#[tauri::command]
async fn fs_read_base64(state: State<'_, VaultState>, path: String) -> AppResult<String> {
    let bytes = fsops::read_binary(&state.root()?, &path)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
async fn fs_write_text(
    state: State<'_, VaultState>,
    path: String,
    content: String,
    expected_mtime: Option<u64>,
) -> AppResult<u64> {
    fsops::write_text(&state.root()?, &path, &content, expected_mtime)
}

#[tauri::command]
async fn fs_create_file(state: State<'_, VaultState>, path: String, content: String) -> AppResult<u64> {
    fsops::create_file(&state.root()?, &path, &content)
}

#[tauri::command]
async fn fs_create_folder(state: State<'_, VaultState>, path: String) -> AppResult<()> {
    fsops::create_folder(&state.root()?, &path)
}

#[tauri::command]
async fn fs_rename(state: State<'_, VaultState>, from: String, to: String) -> AppResult<()> {
    fsops::rename(&state.root()?, &from, &to)
}

#[tauri::command]
async fn fs_delete(state: State<'_, VaultState>, path: String) -> AppResult<()> {
    fsops::delete(&state.root()?, &path)
}

/// App menu without the default "Close Window" (Mod+W closes a tab instead) and with a
/// Quit item that routes through the frontend so pending saves complete first.
fn build_menu<R: tauri::Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let quit = MenuItem::with_id(handle, "quit", "Quit Marginalia", true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(
        handle,
        "Marginalia",
        true,
        &[
            &PredefinedMenuItem::about(handle, Some("About Marginalia"), None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::show_all(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &quit,
        ],
    )?;
    let edit = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        handle,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(handle, None)?, &PredefinedMenuItem::fullscreen(handle, None)?],
    )?;
    Menu::with_items(handle, &[&app_menu, &edit, &window])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(VaultState::default())
        .menu(build_menu)
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                // Let the frontend flush unsaved notes, then it closes the window.
                if app.emit("app-quit-requested", ()).is_err() {
                    app.exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            vault_pick_open,
            vault_pick_create,
            vault_open_known,
            vault_list_known,
            vault_forget,
            vault_close,
            fs_list,
            fs_read_text,
            fs_read_all_markdown,
            fs_read_base64,
            fs_write_text,
            fs_create_file,
            fs_create_folder,
            fs_rename,
            fs_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
