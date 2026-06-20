// GodeX Studio - Tauri 2 entry point
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    godex_studio_lib::run();
}
