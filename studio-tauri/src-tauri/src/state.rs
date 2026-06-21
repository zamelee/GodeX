use crate::godex::GodexSupervisor;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const PERSIST_FILE: &str = "C:\\Users\\Bliss\\.godex\\studio-paths.json";
const DEFAULT_PORT: u16 = 5678;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PersistedPaths {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub godex_config: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub godex_binary: Option<String>,
}

pub fn load_persisted_paths() -> PersistedPaths {
    std::fs::read_to_string(PERSIST_FILE)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_persisted_paths(p: &PersistedPaths) -> std::io::Result<()> {
    if let Some(parent) = std::path::Path::new(PERSIST_FILE).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(p)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    std::fs::write(PERSIST_FILE, json)
}

pub fn clear_persisted_paths() {
    let _ = std::fs::remove_file(PERSIST_FILE);
}

/// Read `server.port` from a godex config YAML. Returns DEFAULT_PORT if the
/// file is missing, unreadable, or the port field cannot be parsed.
pub fn read_port_from_config(path: &Path) -> u16 {
    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return DEFAULT_PORT,
    };
    let mut in_server = false;
    for line in raw.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("server:") {
            in_server = true;
            continue;
        }
        if in_server {
            // Top-level key (no leading space, non-empty) ends the server block
            if !line.is_empty() && !line.starts_with(' ') && !line.starts_with('\t') {
                break;
            }
            if let Some(rest) = trimmed.strip_prefix("port:") {
                if let Ok(p) = rest.trim().parse::<u16>() {
                    return p;
                }
            }
        }
    }
    DEFAULT_PORT
}

/// Line-based write of `server.port` in a godex config YAML, preserving all
/// other content (including comments / enabled-models list) verbatim.
pub fn write_port_to_config(path: &Path, new_port: u16) -> std::io::Result<()> {
    let raw = std::fs::read_to_string(path)?;
    let trailing_newline = raw.ends_with('\n');
    let mut lines: Vec<String> = raw.lines().map(String::from).collect();
    let mut in_server = false;
    let mut server_block_idx: Option<usize> = None;
    let mut port_replaced = false;

    for i in 0..lines.len() {
        if lines[i].trim_start().starts_with("server:") {
            in_server = true;
            server_block_idx = Some(i);
            continue;
        }
        if in_server {
            let non_empty = !lines[i].is_empty();
            let unindented = non_empty && !lines[i].starts_with(' ') && !lines[i].starts_with('\t');
            if unindented {
                in_server = false;
                continue;
            }
            if lines[i].trim_start().starts_with("port:") {
                let indent: String = lines[i].chars().take_while(|c| c.is_whitespace()).collect();
                lines[i] = format!("{}port: {}", indent, new_port);
                port_replaced = true;
            }
        }
    }


    if !port_replaced {
        if let Some(idx) = server_block_idx {
            // Insert a port line right after the `server:` line
            lines.insert(idx + 1, format!("  port: {}", new_port));
        } else {
            // No server block — prepend one
            let mut new_lines = vec!["server:".to_string(), format!("  port: {}", new_port)];
            new_lines.append(&mut lines);
            lines = new_lines;
        }
    }

    let mut out = lines.join("\n");
    if trailing_newline {
        out.push('\n');
    }
    std::fs::write(path, out)
}

#[derive(Clone)]
pub struct Paths {
    pub godex_config: PathBuf,
    pub godex_binary: PathBuf,
    pub godex_port: u16,
    pub studio_log: Option<PathBuf>,
}

impl Paths {
    pub fn default_paths() -> Self {
        // Priority: env var > persisted file > hardcoded default
        let persisted = load_persisted_paths();
        let godex_config = std::env::var("GODEX_CONFIG")
            .ok()
            .or(persisted.godex_config)
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:\\Users\\Bliss\\.godex\\config.yaml"));
        let godex_binary = std::env::var("GODEX_BINARY")
            .ok()
            .or(persisted.godex_binary)
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from("D:\\Documents\\VibeCoding\\GodeX\\platforms\\win32-x64\\bin\\godex2.exe")
            });
        let godex_port = std::env::var("GODEX_PORT")
            .ok()
            .and_then(|s| s.parse::<u16>().ok())
            .unwrap_or_else(|| read_port_from_config(&godex_config));
        Self { godex_config, godex_binary, godex_port, studio_log: None }
    }
}

pub struct AppState {
    pub paths: Mutex<Paths>,
    pub godex: Arc<GodexSupervisor>,
}

impl AppState {
    pub fn new() -> Self {
        let defaults = Paths::default_paths();
        let godex = Arc::new(GodexSupervisor::new());
        godex.set_paths(
            defaults.godex_config.clone(),
            defaults.godex_binary.clone(),
            defaults.godex_port,
        );
        Self {
            paths: Mutex::new(defaults),
            godex,
        }
    }
}
