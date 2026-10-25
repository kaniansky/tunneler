// TUNNELER ONLINE desktop app: everything is in lib.rs (shared with the Android app, which loads the
// library itself and never runs this file).

// no console window on Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tunneler_online_lib::run()
}
