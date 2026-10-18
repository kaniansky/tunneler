// TUNNELER ONLINE desktop app: a native window (the OS's own web view) showing the game's pages from
// public/ (embedded at build time). Online play goes to the server set on the homepage Settings
// screen (src/js/endpoint.js), by default the public one.
//
// Updates: the main menu (home.js) asks `update_check` for a newer release (the updater plugin reads
// latest.json from the newest GitHub release, signed with the key in tauri.conf.json). Where the app
// can replace itself (the Windows installer, the AppImage, the macOS app; the deb / rpm package with the
// admin password: the updater runs dpkg / rpm through pkexec or sudo) `update_install` downloads,
// installs and restarts it; elsewhere (the portable exe, the tar.gz) `update_page` opens the download
// page in the browser.

// no console window on Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

const DOWNLOADS: &str = "https://kaniansky.com/tunneler/";

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    install: bool,
    admin: bool, // (the install asks for the admin password: a deb / rpm package)
}

// can this copy of the app be replaced by the updater?
fn can_install() -> bool {
    #[cfg(target_os = "linux")]
    {
        // the AppImage, or the program a deb / rpm package installed (the tar.gz's loose binary isn't in /usr)
        std::env::var_os("APPIMAGE").is_some() || system_package()
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

// installed by a deb / rpm package (the bundler marks each package's binary with its type)
fn system_package() -> bool {
    #[cfg(target_os = "linux")]
    {
        use tauri::utils::{config::BundleType, platform::bundle_type};
        std::env::var_os("APPIMAGE").is_none()
            && matches!(bundle_type(), Some(BundleType::Deb) | Some(BundleType::Rpm))
            && std::env::current_exe().map(|p| p.starts_with("/usr")).unwrap_or(false)
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

#[tauri::command]
async fn update_check(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo { version: u.version.clone(), install: can_install(), admin: system_package() }))
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
