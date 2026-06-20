// GodeX Studio - library entry
mod commands;
mod config;
mod godex;
mod state;
mod strip_ansi;

use tauri::Manager;

pub fn run() {
    let _ = env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info"),
    )
    .try_init();

    tauri::Builder::default()
        .setup(|app| {
            let state = state::AppState::new();
            app.manage(state);
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running godex-studio");
}
