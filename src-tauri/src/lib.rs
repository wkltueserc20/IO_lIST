use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

static HAS_UNSAVED_CHANGES: AtomicBool = AtomicBool::new(false);

// ── Commands ───────────────────────────────────────────────────

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
fn write_file_base64(path: String, content: String) -> Result<(), String> {
    let bytes = STANDARD.decode(&content).map_err(|e| e.to_string())?;
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_unsaved_state(has_unsaved: bool) {
    HAS_UNSAVED_CHANGES.store(has_unsaved, Ordering::Relaxed);
}

#[tauri::command]
fn close_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.destroy().ok();
    }
}

#[tauri::command]
fn get_app_data_dir(handle: AppHandle) -> Result<String, String> {
    handle
        .path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

// ── Menu ───────────────────────────────────────────────────────

fn build_menu(app: &AppHandle, recent_paths: &[String]) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    // File menu items
    let new_item = MenuItem::with_id(app, "new", "新增專案", true, Some("CmdOrCtrl+N"))?;
    let open_item = MenuItem::with_id(app, "open", "開啟...", true, Some("CmdOrCtrl+O"))?;
    let save_item = MenuItem::with_id(app, "save", "儲存", true, Some("CmdOrCtrl+S"))?;
    let save_as_item = MenuItem::with_id(app, "save-as", "另存新檔...", true, Some("CmdOrCtrl+Shift+S"))?;
    let export_item = MenuItem::with_id(app, "export-excel", "匯出 Excel", true, None::<&str>)?;
    let print_item  = MenuItem::with_id(app, "print", "列印...", true, Some("CmdOrCtrl+P"))?;
    let quit_item = PredefinedMenuItem::quit(app, Some("結束"))?;

    // Recent files submenu
    let recent_submenu = Submenu::with_id(app, "recent-files", "最近開啟", true)?;
    if recent_paths.is_empty() {
        let no_recent = MenuItem::with_id(app, "no-recent", "（無最近記錄）", false, None::<&str>)?;
        recent_submenu.append(&no_recent)?;
    } else {
        for (i, path) in recent_paths.iter().enumerate() {
            let label = Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path.as_str())
                .to_string();
            let id = format!("recent:{}", i);
            let item = MenuItem::with_id(app, id, label, true, None::<&str>)?;
            recent_submenu.append(&item)?;
        }
    }

    let file_menu = Submenu::with_id(app, "file", "檔案", true)?;
    file_menu.append_items(&[
        &new_item,
        &open_item,
        &PredefinedMenuItem::separator(app)?,
        &save_item,
        &save_as_item,
        &PredefinedMenuItem::separator(app)?,
        &recent_submenu,
        &PredefinedMenuItem::separator(app)?,
        &export_item,
        &PredefinedMenuItem::separator(app)?,
        &print_item,
        &PredefinedMenuItem::separator(app)?,
        &quit_item,
    ])?;

    // Edit menu
    let undo_item = MenuItem::with_id(app, "undo", "復原", true, Some("CmdOrCtrl+Z"))?;
    let redo_item = MenuItem::with_id(app, "redo", "重做", true, Some("CmdOrCtrl+Y"))?;
    let edit_menu = Submenu::with_id(app, "edit", "編輯", true)?;
    edit_menu.append_items(&[&undo_item, &redo_item])?;

    let menu = Menu::new(app)?;
    menu.append_items(&[&file_menu, &edit_menu])?;

    Ok(menu)
}

// ── Entry point ────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Load recent files from AppData for initial menu build
            let recent_paths: Vec<String> = app
                .path()
                .app_data_dir()
                .ok()
                .and_then(|dir| {
                    let p = dir.join("recent-files.json");
                    fs::read_to_string(p).ok()
                })
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();

            let menu = build_menu(app.handle(), &recent_paths)
                .map_err(|e| format!("menu build error: {e}"))?;
            app.set_menu(menu)?;

            // Emit recent files list to frontend after it loads
            let handle = app.handle().clone();
            let paths_json = serde_json::to_string(&recent_paths).unwrap_or_default();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(500));
                handle.emit("recent-files-loaded", &paths_json).ok();
            });

            // Handle command-line file association (double-click .json)
            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = args.get(1).filter(|p| p.ends_with(".json")) {
                let path = path.clone();
                let handle2 = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    handle2.emit("open-file", &path).ok();
                });
            }

            // Auto-save timer: emit every 300 s
            let auto_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(300));
                auto_handle.emit("auto-save-tick", ()).ok();
            });

            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(path_idx) = id.strip_prefix("recent:") {
                // Retrieve the path from AppData and emit open-file
                if let Ok(idx) = path_idx.parse::<usize>() {
                    if let Ok(dir) = app.path().app_data_dir() {
                        let p = dir.join("recent-files.json");
                        if let Ok(content) = fs::read_to_string(p) {
                            if let Ok(paths) = serde_json::from_str::<Vec<String>>(&content) {
                                if let Some(path) = paths.get(idx) {
                                    app.emit("open-file", path).ok();
                                    return;
                                }
                            }
                        }
                    }
                }
            }
            app.emit("menu-action", id).ok();
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                window.emit("close-requested", ()).ok();
            }
        })
        .invoke_handler(tauri::generate_handler![read_file, write_file, read_file_base64, write_file_base64, get_app_data_dir, set_unsaved_state, close_window])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
