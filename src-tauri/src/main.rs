// TUNNELER ONLINE desktop app: a native window (the OS's own web view) showing the game's pages from
// public/ (embedded at build time). Online play goes to the server set on the homepage Settings
// screen (src/js/endpoint.js), by default the public one. No commands, plugins or IPC.

// no console window on Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running TUNNELER ONLINE");
}
