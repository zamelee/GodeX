use crate::godex::GodexSupervisor;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn persist_file() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home).join(".godex").join("studio-paths.json")
}
const DEFAULT_PORT: u16 = 5678;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PersistedPaths {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub godex_config: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub godex_binary: Option<String>,
    #[serde(default)]
    pub external_mode: bool,
}

pub fn load_persisted_paths() -> PersistedPaths {
    std::fs::read_to_string(persist_file())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_persisted_paths(p: &PersistedPaths) -> std::io::Result<()> {
    if let Some(parent) = std::path::Path::new(&persist_file()).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(p)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    std::fs::write(persist_file(), json)
}

pub fn clear_persisted_paths() {
    let _ = std::fs::remove_file(persist_file());
}

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
            lines.insert(idx + 1, format!("  port: {}", new_port));
        } else {
            let mut new_lines = vec!["server:".to_string(), format!("  port: {}", new_port)];
            new_lines.append(&mut lines);
            lines = new_lines;
        }
    }
    let mut out = lines.join("\n");
    if trailing_newline { out.push('\n'); }
    std::fs::write(path, out)
}

/// Read logging.file from godex config YAML. Returns None if unset.
pub fn read_logging_file_from_config(config: &std::path::Path) -> Option<String> {
    let raw = std::fs::read_to_string(config).ok()?;
    let mut in_logging = false;
    for line in raw.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("logging:") {
            in_logging = true;
            continue;
        }
        if in_logging {
            if !line.is_empty() && !line.starts_with(' ') && !line.starts_with('\t') {
                break;
            }
            if let Some(rest) = trimmed.strip_prefix("file:") {
                let val = rest.trim();
                if !val.is_empty() && val != "undefined" && val != "null" {
                    return Some(val.trim_matches('"').to_string());
                }
            }
        }
    }
    None
}

/// Line-based write of logging.file in godex config YAML.
pub fn write_logging_file_to_config(
    config_path: &std::path::Path,
    logging_file: &str,
) -> std::io::Result<()> {
    let raw = std::fs::read_to_string(config_path)?;
    let trailing_newline = raw.ends_with('\n');
    let mut lines: Vec<String> = raw.lines().map(String::from).collect();
    let mut in_logging = false;
    let mut file_replaced = false;
    let mut logging_block_idx: Option<usize> = None;
    for i in 0..lines.len() {
        if lines[i].trim_start().starts_with("logging:") {
            in_logging = true;
            logging_block_idx = Some(i);
            continue;
        }
        if in_logging {
            if !lines[i].is_empty() && !lines[i].starts_with(' ') && !lines[i].starts_with('\t') {
                in_logging = false;
                continue;
            }
            if lines[i].trim_start().starts_with("file:") {
                let indent: String = lines[i].chars().take_while(|c| c.is_whitespace()).collect();
                lines[i] = format!("{}file: \"{}\"", indent, logging_file);
                file_replaced = true;
            }
        }
    }
    if !file_replaced {
        if let Some(idx) = logging_block_idx {
            lines.insert(idx + 1, format!("  file: \"{}\"", logging_file));
        } else {
            let mut nl = vec!["logging:".to_string(), format!("  file: \"{}\"", logging_file)];
            nl.append(&mut lines);
            lines = nl;
        }
    }
    let mut out = lines.join("\n");
    if trailing_newline { out.push('\n'); }
    std::fs::write(config_path, out)
}

#[derive(Clone)]
pub struct Paths {
    pub godex_config: PathBuf,
    pub godex_binary: PathBuf,
    pub godex_port: u16,
    pub external_mode: bool,
    pub studio_log: Option<PathBuf>,
    pub session_db_path: PathBuf,
    pub trace_db_path: PathBuf,
}

impl Paths {
    pub fn default_paths() -> Self {
        let persisted = load_persisted_paths();
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".to_string());
        let home_dot_godex = PathBuf::from(&home).join(".godex");

        // godex_config: env GODEX_CONFIG -> persisted -> cwd/godex.yaml -> ~/.godex/config.yaml
        let godex_config = resolve_godex_config(&persisted, &home_dot_godex);

        // godex_binary: env GODEX_BINARY -> cwd/godex[.exe] -> persisted (exists) -> ~/.godex/bin/<godex-binary>
        let godex_binary = resolve_godex_binary(&persisted, &home_dot_godex);

        // db paths mirror godex prod defaults (src/config/paths.ts):
        //   session: ~/.godex/data/sessions.db
        //   trace:   ~/.godex/data/trace.db
        let data_dir = home_dot_godex.join("data");
        let session_db_path = data_dir.join("sessions.db");
        let trace_db_path = data_dir.join("trace.db");

        let godex_port = std::env::var("GODEX_PORT")
            .ok()
            .and_then(|s| s.parse::<u16>().ok())
            .unwrap_or_else(|| read_port_from_config(&godex_config));
        Self {
            godex_config,
            godex_binary,
            godex_port,
            external_mode: persisted.external_mode,
            studio_log: None,
            session_db_path,
            trace_db_path,
        }
    }
}

/// Resolve the active godex config path. Priority chain:
///   1. $GODEX_CONFIG env var (Studio-only convenience)
///   2. ./godex.yaml in the current working directory
///   3. ~/.godex/studio-paths.json "godex_config" (only if file still exists)
///   4. ~/.godex/config.yaml (cross-platform homedir)
///
/// Note: cwd (step 2) is checked BEFORE persisted (step 3) so that portable
/// deployments — where the user double-clicks start-studio.bat from the
/// portable folder — always use ./godex.yaml in that folder, even if a stale
/// path from a different machine is still cached in studio-paths.json.
/// Persisted is only honoured when the file it points to still exists, so
/// moved/deleted paths silently fall through to the next step.
fn resolve_godex_config(persisted: &PersistedPaths, home_dot_godex: &Path) -> PathBuf {
    if let Ok(v) = std::env::var("GODEX_CONFIG") {
        if !v.trim().is_empty() {
            return PathBuf::from(v);
        }
    }
    let cwd_candidate = std::env::current_dir().ok().map(|d| d.join("godex.yaml"));
    if let Some(p) = cwd_candidate {
        if p.exists() {
            return p;
        }
    }
    if let Some(v) = &persisted.godex_config {
        if !v.trim().is_empty() {
            let p = PathBuf::from(v);
            if p.exists() {
                return p;
            }
        }
    }
    home_dot_godex.join("config.yaml")
}

/// Detected at startup: persisted godex_config pointed somewhere that no
/// longer exists. Returned to the UI so the user can see what happened.
#[derive(serde::Serialize, Clone)]
pub struct PathChangeNotice {
    pub from: String,
    pub to: String,
    pub reason: &'static str,
}

/// Detected at startup: godex_config resolved to a path whose file did
/// not exist. Studio may have created it for the user; UI surfaces the action.
#[derive(serde::Serialize, Clone)]
pub struct PathProvisionNotice {
    pub path: String,
    /// "copied_from_example" | "created_minimal" | "existed"
    pub source: String,
}

/// Minimum-viable godex config used when no example file is available either.
/// Memory session backend, no providers, server on 5678 — enough for the UI
/// to open and let the user add a provider through the New Provider dialog.
const MINIMAL_GODEX_CONFIG: &str = "server:\n  host: 0.0.0.0\n  port: 5678\n\ndefault_provider: minimax\n\nproviders: {}\n\nsession:\n  backend: memory\n\nlogging:\n  level: info\n\ntrace:\n  enabled: true\n\nmodels:\n  enabled: []\n";

#[cfg(test)]
mod provision_tests {
    use super::*;
    use std::fs;

    fn fresh_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("godex-studio-provision-tests").join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn returns_none_when_file_already_exists() {
        let dir = fresh_dir("exists");
        let target = dir.join("godex.yaml");
        fs::write(&target, "server: { port: 5678 }\n").unwrap();
        assert!(ensure_godex_config(&target).is_none());
    }

    #[test]
    fn copies_sibling_example_when_present() {
        let dir = fresh_dir("example");
        fs::write(dir.join("godex.example.yaml"), "server:\n  port: 9999\n").unwrap();
        let target = dir.join("godex.yaml");
        let notice = ensure_godex_config(&target).expect("expected notice");
        assert_eq!(notice.source, "copied_from_example");
        assert_eq!(notice.path, target.display().to_string());
        assert_eq!(fs::read_to_string(&target).unwrap(), "server:\n  port: 9999\n");
    }

    #[test]
    fn writes_minimal_yaml_when_no_example() {
        let dir = fresh_dir("minimal");
        let target = dir.join("subdir").join("godex.yaml");
        let notice = ensure_godex_config(&target).expect("expected notice");
        assert_eq!(notice.source, "created_minimal");
        let written = fs::read_to_string(&target).unwrap();
        assert!(written.contains("server:"));
        assert!(written.contains("port: 5678"));
        assert!(written.contains("backend: memory"));
        assert!(!written.contains("REPLACE_ME"));
    }

    #[test]
    fn cwd_godex_exe_wins_over_persisted_and_home() {
        // Reproduces the portable case: godex.exe sits next to godex-studio.exe,
        // but persisted/studio-paths.json still points at an old path under a
        // renamed/old userprofile (e.g. D:\Users\ROG\.godex\bin\godex.exe).
        let dir = fresh_dir("binary_cwd");
        let cwd_exe = dir.join(if cfg!(windows) { "godex.exe" } else { "godex" });
        fs::write(&cwd_exe, b"").unwrap();
        // Pretend the studio cwd IS this dir by env override; in tests we
        // can't chdir, so we put a stale persisted path that should lose to
        // the (non-existent in this cwd) real one. The actual cwd of the
        // test process almost certainly does not contain godex.exe, so the
        // function will fall through to persisted; assert that the persisted
        // path is honoured only when it exists.
        let stale = PathBuf::from("/nope/never/exists/godex.exe");
        let persisted = PersistedPaths { godex_config: None, godex_binary: Some(stale.display().to_string()), external_mode: false };
        let home_dot_godex = PathBuf::from("/also/nope");
        let resolved = resolve_godex_binary(&persisted, &home_dot_godex);
        // cwd of test process -- if it happens to contain a godex.exe
        // (extremely unlikely in `cargo test`), that wins; otherwise we
        // fall all the way through to home. Either way the stale path must
        // NOT be returned.
        assert_ne!(resolved, stale, "stale persisted path must not be used");
    }

    #[test]
    fn cwd_godex_wins_when_present() {
        // Use a controlled cwd by chdir-ing to a temp dir containing godex.exe
        // (or godex). Save and restore the original cwd so we don't affect
        // other tests.
        let original_cwd = std::env::current_dir().unwrap();
        let dir = fresh_dir("binary_cwd_present");
        let bin_name = if cfg!(windows) { "godex.exe" } else { "godex" };
        let cwd_exe = dir.join(bin_name);
        fs::write(&cwd_exe, b"").unwrap();
        std::env::set_current_dir(&dir).unwrap();
        // Set a stale persisted path; cwd must override it.
        let stale = PathBuf::from("/totally/missing/godex.exe");
        let persisted = PersistedPaths { godex_config: None, godex_binary: Some(stale.display().to_string()), external_mode: false };
        let home_dot_godex = PathBuf::from("/also/missing");
        let resolved = resolve_godex_binary(&persisted, &home_dot_godex);
        let _ = std::env::set_current_dir(&original_cwd);
        assert_eq!(resolved, cwd_exe, "cwd godex.exe must beat stale persisted path");
    }

    #[test]
    fn prefers_example_over_minimal() {
        // Both example and target slot exist; example should win.
        let dir = fresh_dir("both");
        fs::write(dir.join("godex.example.yaml"), "from: example\n").unwrap();
        let target = dir.join("godex.yaml");
        let notice = ensure_godex_config(&target).unwrap();
        assert_eq!(notice.source, "copied_from_example");
    }
}

/// Make sure the resolved godex_config exists on disk. If the resolved path's
/// file is missing, try to:
///   1. Copy a sibling `godex.example.yaml` next to it (portable case), or
///   2. Write a minimal-viable yaml to it (fallback when no example exists).
/// Returns a `PathProvisionNotice` describing what happened, or None if the
/// file already existed (or could not be created at all).
fn ensure_godex_config(resolved: &Path) -> Option<PathProvisionNotice> {
    if resolved.exists() { return None; }
    let parent = match resolved.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => return None,
    };
    if !parent.exists() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            crate::diag(&format!("[provision] create_dir_all({}) failed: {}", parent.display(), e));
            return None;
        }
    }
    let example = parent.join("godex.example.yaml");
    if example.exists() {
        if std::fs::copy(&example, resolved).is_ok() {
            return Some(PathProvisionNotice {
                path: resolved.display().to_string(),
                source: "copied_from_example".to_string(),
            });
        }
    }
    if std::fs::write(resolved, MINIMAL_GODEX_CONFIG).is_ok() {
        Some(PathProvisionNotice {
            path: resolved.display().to_string(),
            source: "created_minimal".to_string(),
        })
    } else {
        None
    }
}

/// Walk the same priority chain as `resolve_godex_config` and, if the

/// persisted step was skipped because its target file vanished, return a
/// notice describing the silent path switch.
fn detect_path_change(
    resolved: &Path,
    persisted: &PersistedPaths,
) -> Option<PathChangeNotice> {
    if let Some(v) = &persisted.godex_config {
        let v = v.trim();
        if !v.is_empty() {
            let p = PathBuf::from(v);
            // Only worth surfacing if the persisted path was used-or-attempted
            // AND the resolved path is different.
            if !p.exists() && p != resolved {
                return Some(PathChangeNotice {
                    from: v.to_string(),
                    to: resolved.display().to_string(),
                    reason: "missing_file",
                });
            }
        }
    }
    None
}

/// Resolve the godex binary path. Priority chain (same shape as
/// `resolve_godex_config`):
///   1. $GODEX_BINARY env var (highest)
///   2. ./godex.exe (or ./godex) in the current working directory
///      (portable-friendly: godex-studio.exe launched from a portable
///      folder automatically picks up its sibling godex.exe)
///   3. ~/.godex/studio-paths.json "godex_binary" (only if file still exists)
///   4. ~/.godex/bin/godex[.exe] (cross-platform convention, last resort)
fn resolve_godex_binary(persisted: &PersistedPaths, home_dot_godex: &Path) -> PathBuf {
    if let Ok(v) = std::env::var("GODEX_BINARY") {
        if !v.trim().is_empty() {
            return PathBuf::from(v);
        }
    }
    // cwd: ./godex.exe (Windows) or ./godex (POSIX)
    if let Ok(cwd) = std::env::current_dir() {
        let bin_name = if cfg!(windows) { "godex.exe" } else { "godex" };
        let cwd_candidate = cwd.join(bin_name);
        if cwd_candidate.exists() {
            return cwd_candidate;
        }
    }
    if let Some(v) = &persisted.godex_binary {
        if !v.trim().is_empty() {
            let p = PathBuf::from(v);
            if p.exists() {
                return p;
            }
        }
    }
    let bin_name = if cfg!(windows) { "godex.exe" } else { "godex" };
    home_dot_godex.join("bin").join(bin_name)
}

pub struct AppState {
    pub paths: Mutex<Paths>,
    pub godex: Arc<GodexSupervisor>,
    pub path_change_notice: Mutex<Option<PathChangeNotice>>,
    pub path_provision_notice: Mutex<Option<PathProvisionNotice>>,
}

impl AppState {
    pub fn new() -> Self {
        let persisted = load_persisted_paths();
        let defaults = Paths::default_paths();
        let notice = detect_path_change(&defaults.godex_config, &persisted);
        let provision = ensure_godex_config(&defaults.godex_config);
        let godex = Arc::new(GodexSupervisor::new());
        godex.set_paths(
            defaults.godex_config.clone(),
            defaults.godex_binary.clone(),
            defaults.godex_port,
        );
        godex.set_external_mode(defaults.external_mode);
        Self {
            paths: Mutex::new(defaults),
            godex,
            path_change_notice: Mutex::new(notice),
            path_provision_notice: Mutex::new(provision),
        }
    }
}

/// Get Codex config path (supports CODEX_HOME env var)
pub fn codex_config_path() -> PathBuf {
    if let Ok(home) = std::env::var("CODEX_HOME") {
        PathBuf::from(home).join("config.toml")
    } else if let Ok(home) = std::env::var("USERPROFILE") {
        PathBuf::from(home).join(".codex").join("config.toml")
    } else {
        PathBuf::from(r"C:\Users\Bliss\.codex\config.toml")
    }
}

/// Read model_context_window from Codex config
pub fn read_codex_model_context_window() -> Option<u64> {
    let path = codex_config_path();
    let raw = std::fs::read_to_string(&path).ok()?;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("model_context_window") {
            if let Some((_, rest)) = trimmed.split_once("=") {
                return rest.trim().parse::<u64>().ok();
            }
        }
    }
    None
}

/// Write model_context_window and model_auto_compact_token_limit to Codex config
pub fn write_codex_model_context(
    context_window: u64,
    auto_compact_ratio: Option<f64>,
) -> std::io::Result<()> {
    let path = codex_config_path();
    let raw = std::fs::read_to_string(&path)?;
    let trailing_newline = raw.ends_with('\n');
    let mut lines: Vec<String> = raw.lines().map(String::from).collect();
    
    let auto_compact_limit = if let Some(ratio) = auto_compact_ratio {
        (context_window as f64 * ratio) as u64
    } else {
        (context_window as f64 * 0.8) as u64
    };
    
    // First pass: collect changes
    let mut changes: Vec<(usize, String)> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with("model_context_window") {
            let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
            changes.push((i, format!("{}model_context_window = {}", indent, context_window)));
        } else if trimmed.starts_with("model_auto_compact_token_limit") {
            let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
            changes.push((i, format!("{}model_auto_compact_token_limit = {}", indent, auto_compact_limit)));
        }
    }
    // Second pass: apply changes
    for (i, new_line) in changes {
        lines[i] = new_line;
    }
    
    let mut out = lines.join("\n");
    if trailing_newline { out.push('\n'); }
    std::fs::write(&path, out)?;
    
    crate::diag(&format!("[codex] wrote model_context_window={} auto_compact={}", context_window, auto_compact_limit));
    Ok(())
}
