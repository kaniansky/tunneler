// TUNNELER ONLINE desktop app: a native window (the OS's own web view) showing the game's pages from
// public/ (embedded at build time). Online play goes to the server set on the homepage Settings
// screen (src/js/endpoint.js), by default the public one.
//
// Updates: the main menu (home.js) asks `update_check` for a newer release (the updater plugin reads
// latest.json from the newest GitHub release, signed with the key in tauri.conf.json). Where the app
// can replace itself (the Windows installer, the AppImage, the macOS app) `update_install` downloads,
// installs and restarts it; elsewhere (the portable exe, deb / rpm, the tar.gz) `update_page` opens
// the download page in the browser.

// no console window on Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

const DOWNLOADS: &str = "https://kaniansky.com/tunneler/";

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    install: bool,
}

// can this copy of the app be replaced by the updater?
fn can_install() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE").is_some()
    }
    #[cfg(target_os = "windows")]
    {
        // installed by the NSIS installer (its uninstaller lies next to the program), not the portable exe
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("uninstall.exe").exists()))
            .unwrap_or(false)
    }
    #[cfg(target_os = "macos")]
    {
        true
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        false
    }
}

#[tauri::command]
async fn update_check(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo { version: u.version.clone(), install: can_install() }))
}

#[tauri::command]
async fn update_install(app: tauri::AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update".to_string())?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

#[tauri::command]
fn update_page(app: tauri::AppHandle) -> Result<(), String> {
    app.opener().open_url(DOWNLOADS, None::<&str>).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![update_check, update_install, update_page])
        .run(tauri::generate_context!())
        .expect("error while running TUNNELER ONLINE");
}
