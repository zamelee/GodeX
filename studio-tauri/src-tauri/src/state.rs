use crate::godex::GodexSupervisor;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;

pub struct Paths {
    pub godex_config: PathBuf,
    pub godex_binary: PathBuf,
    pub studio_log: Option<PathBuf>,
}

impl Paths {
    pub fn default_paths() -> Self {
        let godex_config = std::env::var("GODEX_CONFIG")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("C:\\Users\\Bliss\\.godex\\config.yaml"));
        let godex_binary = std::env::var("GODEX_BINARY")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                PathBuf::from("D:\\Documents\\VibeCoding\\GodeX\\platforms\\win32-x64\\bin\\godex2.exe")
            });
        Self { godex_config, godex_binary, studio_log: None }
    }
}

pub struct AppState {
    pub paths: Mutex<Paths>,
    pub godex: Arc<GodexSupervisor>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            paths: Mutex::new(Paths::default_paths()),
            godex: Arc::new(GodexSupervisor::new()),
        }
    }
}
