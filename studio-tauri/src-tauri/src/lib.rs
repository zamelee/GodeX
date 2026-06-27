// GodeX Studio - library entry
mod commands;
mod config;
mod godex;
mod state;
mod strip_ansi;

use std::fs::OpenOptions;
use std::io::Write;
use std::sync::mpsc;
use tauri::Manager;

// Background logging thread to avoid blocking the Tauri IPC thread
static DIAG_TX: std::sync::Mutex<Option<mpsc::Sender<String>>> = std::sync::Mutex::new(None);

pub fn diag(msg: &str) {
    // Fast path: send to channel without any blocking I/O.
    // Channel is unbounded so send() never blocks.
    if let Ok(guard) = DIAG_TX.lock() {
        if let Some(ref tx) = *guard {
            let _ = tx.send(msg.to_string());
        }
    }
}

fn start_log_thread() {
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Bliss".to_string());
        let log_path = format!("{}\\.godex\\studio.log", home);
        if let Some(parent) = std::path::Path::new(&log_path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .ok();
        loop {
            match rx.recv() {
                Ok(msg) => {
                    if let Some(ref mut f) = file {
                        let _ = writeln!(f, "{}", msg);
                        let _ = f.flush();
                    }
                }
                Err(_) => break,
            }
        }
    });
    *DIAG_TX.lock().unwrap() = Some(tx);
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
    diag("[studio] run() entered");
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Bliss".to_string());
    let log_path = format!("{}\\.godex\\studio.log", home);
    if let Some(parent) = std::path::Path::new(&log_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    start_log_thread();
    diag("[studio] log_thread started");

    let _ = env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info"),
    )
    .target(env_logger::Target::Stderr)
    .try_init();
    diag("[studio] env_logger initialized");

    std::panic::set_hook(Box::new(|info| {
        let loc = info.location();
        let msg = if let Some(l) = loc {
            format!("[studio] PANIC at {}:{}: {}", l.file(), l.line(), info)
        } else {
            format!("[studio] PANIC: {}", info)
        };
        eprintln!("{}", msg);
        diag(&msg);
    }));
    diag("[studio] panic hook installed");

    diag("[studio] creating tauri builder");
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            diag("[studio] setup: creating AppState");
            let state = state::AppState::new();
            app.manage(state);
            diag("[studio] setup: done");

            // On window close: kill godex only in internal (non-external) mode
            if let Some(window) = app.get_webview_window("main") {
                let state_manage = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        let state_handle = state_manage.state::<state::AppState>();
                        let is_external = state_handle.godex.is_external_mode();
                        if !is_external {
                            diag("[studio] window close: killing internal godex");
                            state_handle.godex.kill();
                        } else {
                            diag("[studio] window close: external mode, letting godex live");
                        }
                    }
                });
            }
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
            commands::set_external_mode,
            commands::set_godex_mode,
            commands::tail_trace_logs,
            commands::godex_external_start,
            commands::load_model_presets,
            commands::match_model_preset,
            commands::write_codex_model_context,
            commands::read_codex_model_context,
            commands::open_in_editor,
            commands::launch_model_probe,
            commands::set_replica_mode,
            commands::get_replica_status,
            commands::start_godex_replica,
            commands::kill_godex_replica,
        ])
        .run(tauri::generate_context!());

    diag(&format!("[studio] tauri run finished: {:?}", result));
    if let Err(e) = result {
        diag(&format!("[studio] tauri error: {}", e));
        std::process::exit(1);
    }
}
