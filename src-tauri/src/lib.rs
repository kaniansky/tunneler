// TUNNELER app: a native window (the OS's own web view) showing the game's pages from public/
// (embedded at build time). Online play goes to the server set on the homepage Settings screen
// (src/js/endpoint.js), by default the public one. The same code is the desktop app (main.rs calls run())
// and the Android app (the Android project in gen/android loads this library and calls run() through
// tauri::mobile_entry_point).
//
// Updates (desktop only): the main menu (home.js) asks `update_check` for a newer release (the updater
// plugin reads latest.json from the newest GitHub release, signed with the key in tauri.conf.json). Where
// the app can replace itself (the Windows installer, the AppImage, the macOS app; the deb / rpm package
// with the admin password: the updater runs dpkg / rpm through pkexec or sudo) `update_install` downloads,
// installs and restarts it; elsewhere (the portable exe, the tar.gz) `update_page` opens the download page
// in the browser. On Android the store / the APK channel updates the app: there is no updater plugin, and
// update_check answers "no update", the other commands an error (home.js treats both as "no update").
//
// Fullscreen (desktop only): set_fullscreen / is_fullscreen change the window. On Android the activity is
// always fullscreen (gen/android MainActivity.kt: immersive, system bars hidden, the screen kept on), and
// the two commands answer an error (src/js/screen.js then leaves the setting alone).

#[cfg(desktop)]
mod desktop {
    use tauri_plugin_opener::OpenerExt;
    use tauri_plugin_updater::UpdaterExt;

    const DOWNLOADS: &str = "https://kaniansky.com/tunneler/";

    #[derive(serde::Serialize)]
    pub struct UpdateInfo {
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

    // running as a Flatpak (Flathub): the software manager updates it, the app offers no update of its own
    fn flatpak() -> bool {
        std::env::var_os("FLATPAK_ID").is_some() || std::path::Path::new("/.flatpak-info").exists()
    }

    #[tauri::command]
    pub async fn update_check(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
        if flatpak() {
            return Ok(None);
        }
        let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
        Ok(update.map(|u| UpdateInfo { version: u.version.clone(), install: can_install(), admin: system_package() }))
    }

    #[tauri::command]
    pub async fn update_install(app: tauri::AppHandle) -> Result<(), String> {
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
    pub fn update_page(app: tauri::AppHandle) -> Result<(), String> {
        app.opener().open_url(DOWNLOADS, None::<&str>).map_err(|e| e.to_string())
    }

    // Settings, Display: Fullscreen (and Alt+Enter, src/js/screen.js) - the whole window, which stays so when
    // the pages change (a browser leaves fullscreen on every page load)
    #[tauri::command]
    pub fn set_fullscreen(window: tauri::WebviewWindow, on: bool) -> Result<(), String> {
        window.set_fullscreen(on).map_err(|e| e.to_string())
    }
    #[tauri::command]
    pub fn is_fullscreen(window: tauri::WebviewWindow) -> Result<bool, String> {
        window.is_fullscreen().map_err(|e| e.to_string())
    }
}

#[cfg(mobile)]
mod mobile {
    const NO: &str = "not supported on this platform";

    // (the store / the APK channel updates the app: never an update offer)
    #[tauri::command]
    pub fn update_check() -> Result<Option<()>, String> {
        Ok(None)
    }
    #[tauri::command]
    pub fn update_install() -> Result<(), String> {
        Err(NO.into())
    }
    #[tauri::command]
    pub fn update_page() -> Result<(), String> {
        Err(NO.into())
    }
    // (always fullscreen: MainActivity.kt)
    #[tauri::command]
    pub fn set_fullscreen(on: bool) -> Result<(), String> {
        let _ = on;
        Err(NO.into())
    }
    #[tauri::command]
    pub fn is_fullscreen() -> Result<bool, String> {
        Err(NO.into())
    }
}

#[cfg(desktop)]
use desktop::*;
#[cfg(mobile)]
use mobile::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build()).plugin(tauri_plugin_opener::init());
    builder
        .invoke_handler(tauri::generate_handler![update_check, update_install, update_page, set_fullscreen, is_fullscreen])
        .run(tauri::generate_context!())
        .expect("error while running TUNNELER");
}
