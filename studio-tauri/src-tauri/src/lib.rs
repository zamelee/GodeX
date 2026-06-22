// GodeX Studio - library entry
mod commands;
mod config;
mod godex;
mod state;
mod strip_ansi;

use std::fs::OpenOptions;
use std::io::Write;
use parking_lot::Mutex;
use tauri::Manager;

pub static LOG_PATH: Mutex<Option<String>> = Mutex::new(None);

pub fn diag(msg: &str) {
    let guard = LOG_PATH.lock();
    if let Some(path) = guard.as_ref() {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{}", msg);
        }
    }
}

fn make_log_line(level: &str, text: String) -> crate::godex::LogLine {
    crate::godex::LogLine {
        ts: chrono::Utc::now().timestamp_millis(),
        level: level.to_string(),
        source: "studio".to_string(),
        text,
    }
}

pub fn log_line_info(text: &str) -> crate::godex::LogLine {
    make_log_line("info", text.to_string())
}

pub fn log_line_warn(text: &str) -> crate::godex::LogLine {
    make_log_line("warn", text.to_string())
}

pub fn log_line_error(text: &str) -> crate::godex::LogLine {
    make_log_line("error", text.to_string())
}

pub fn run() {
    let log_path = std::env::var("GODEX_STUDIO_LOG")
        .unwrap_or_else(|_| String::from("C:\\Users\\Bliss\\.godex\\studio.log"));
    if let Some(parent) = std::path::Path::new(&log_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    *LOG_PATH.lock() = Some(log_path.clone());
    // truncate previous log
    if let Ok(mut f) = OpenOptions::new().create(true).write(true).truncate(true).open(&log_path) {
        let _ = writeln!(f, "[studio] startup log_path={}", log_path);
    }
    // Also init env_logger to stderr so dev console gets output too.
    let _ = env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info"),
    )
    .target(env_logger::Target::Stderr)
    .try_init();
    diag("[studio] diag logger initialized");
    std::panic::set_hook(Box::new(|info| {
        diag(&format!("[studio] PANIC: {}", info));
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            log::info!("[studio] setup: managing AppState");
            let state = state::AppState::new();
            app.manage(state);
            log::info!("[studio] setup: done");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config_paths,
            commands::set_config_paths,
            commands::list_providers,
            commands::upsert_provider,
            commands::delete_provider,
            commands::read_enabled_models,
            commands::save_enabled_models,
            commands::fetch_remote_models,
            commands::godex_status,
            commands::godex_restart,
            commands::godex_kill,
            commands::godex_start,
            commands::godex_logs_tail,
            commands::godex_logs_clear,
            commands::check_port,
            commands::kill_pid,
            commands::find_free_port,
            commands::reset_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running godex-studio");
}



