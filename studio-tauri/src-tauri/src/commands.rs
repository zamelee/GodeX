use crate::config::{self, EnabledModel, ProviderInfo};
use crate::state::AppState;
use crate::godex::LogLine;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[derive(Serialize)]
pub struct PathInfo {
    pub godex_config: String,
    pub godex_binary: String,
}

#[tauri::command]
pub fn get_config_paths(state: State<'_, AppState>) -> PathInfo {
    crate::diag(&format!("[cmd] enter get_config_paths"));
    let p = state.paths.lock();
    PathInfo {
        godex_config: p.godex_config.display().to_string(),
        godex_binary: p.godex_binary.display().to_string(),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_config_paths(state: State<'_, AppState>, godex_config: String, godex_binary: String) -> PathInfo {
    crate::diag(&format!("[cmd] enter set_config_paths"));
    let config = PathBuf::from(&godex_config);
    let binary = PathBuf::from(&godex_binary);
    state.godex.set_paths(config.clone(), binary.clone());
    {
        let mut p = state.paths.lock();
        p.godex_config = config;
        p.godex_binary = binary;
    }
    get_config_paths(state)
}

#[tauri::command]
pub fn list_providers(state: State<'_, AppState>) -> Result<Vec<ProviderInfo>, String> {
    crate::diag(&format!("[cmd] enter list_providers"));
    let path = state.paths.lock().godex_config.clone();
    Ok(config::read_providers(&path))
}

#[tauri::command(rename_all = "camelCase")]
pub fn upsert_provider(state: State<'_, AppState>, name: String, base_url: String, api_key: String, spec: String, timeout_ms: u64) -> Result<(), String> {
    crate::diag(&format!("[cmd] enter upsert_provider name={}", name));
    let path = state.paths.lock().godex_config.clone();
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read failed: {}", e))?;
    let block = format!(
        "  {}:\n    spec: {}\n    credentials:\n      api_key: {}\n    endpoint:\n      base_url: {}\n    timeout_ms: {}\n",
        name, spec, api_key, base_url, timeout_ms
    );
    let updated = replace_provider_block(&raw, &name, &block);
    std::fs::write(&path, updated).map_err(|e| format!("write failed: {}", e))?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_provider(state: State<'_, AppState>, name: String) -> Result<(), String> {
    crate::diag(&format!("[cmd] enter delete_provider name={}", name));
    let path = state.paths.lock().godex_config.clone();
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read failed: {}", e))?;
    let updated = remove_provider_block(&raw, &name);
    std::fs::write(&path, updated).map_err(|e| format!("write failed: {}", e))?;
    Ok(())
}


// Returns the byte range (start, end) of the provider block named
// `name` in `raw`. A provider block is a contiguous run of lines
// starting with "  <name>:" (2-space indent) and ending just before
// the next line that has either 0-space indent (top-level key) or
// 2-space indent + "<other>:" (another provider).
fn find_provider_block(raw: &str, name: &str) -> Option<(usize, usize)> {
    let needle = format!("  {}:", name);
    let bytes = raw.as_bytes();
    let mut search_from = 0;
    while let Some(rel) = raw[search_from..].find(&needle) {
        let start = search_from + rel;
        // Must be at start of a line.
        let at_line_start = start == 0 || bytes[start - 1] == b'\n';
        if at_line_start {
            // Walk subsequent lines to find the end of the block.
            let mut cursor = start;
            // Move past the header line and its newline.
            while cursor < bytes.len() && bytes[cursor] != b'\n' {
                cursor += 1;
            }
            if cursor < bytes.len() { cursor += 1; }
            while cursor < bytes.len() {
                let line_end = raw[cursor..].find('\n')
                    .map(|i| cursor + i)
                    .unwrap_or(bytes.len());
                let line = &raw[cursor..line_end];
                if !line.is_empty() {
                    let trimmed = line.trim_start();
                    let indent = line.len() - trimmed.len();
                    if indent == 0 {
                        break;
                    }
                    if indent == 2 && trimmed.ends_with(':') && !trimmed.contains(' ') {
                        break;
                    }
                }
                cursor = if line_end < bytes.len() { line_end + 1 } else { bytes.len() };
            }
            return Some((start, cursor));
        }
        search_from = start + 1;
    }
    None
}

fn replace_provider_block(raw: &str, name: &str, new_block: &str) -> String {
    if let Some((start, end)) = find_provider_block(raw, name) {
        // Eat the preceding newline so the new block sits cleanly.
        let cut_start = if start > 0 && raw.as_bytes()[start - 1] == b'\n' {
            start - 1
        } else {
            start
        };
        return format!("{}{}{}", &raw[..cut_start], new_block.trim_end(), &raw[end..]);
    }
    // Not found: insert after the `providers:` top-level line.
    let needle = "providers:";
    if let Some(idx) = raw.find(needle) {
        let at_line_start = idx == 0 || raw.as_bytes()[idx - 1] == b'\n';
        if at_line_start {
            let nl = raw[idx..].find('\n')
                .map(|i| idx + i + 1)
                .unwrap_or(raw.len());
            let prefix = if nl == 0 || raw.as_bytes()[nl - 1] == b'\n' {
                &raw[..nl]
            } else {
                // Add a newline after the providers: line if missing.
                &raw[..idx + needle.len()]
            };
            return format!("{}\n{}\n{}", prefix, new_block.trim_end(), &raw[nl..]);
        }
    }
    format!("providers:\n{}\n", raw)
}

fn remove_provider_block(raw: &str, name: &str) -> String {
    if let Some((start, end)) = find_provider_block(raw, name) {
        let cut_start = if start > 0 && raw.as_bytes()[start - 1] == b'\n' {
            start - 1
        } else {
            start
        };
        return format!("{}{}", &raw[..cut_start], &raw[end..]);
    }
    raw.to_string()
}


#[tauri::command]
pub fn read_enabled_models(state: State<'_, AppState>) -> Result<Vec<EnabledModel>, String> {
    crate::diag(&format!("[cmd] enter read_enabled_models"));
    let path = state.paths.lock().godex_config.clone();
    Ok(config::read_enabled_models(&path))
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_enabled_models(state: State<'_, AppState>, enabled: Vec<EnabledModel>) -> Result<usize, String> {
    crate::diag(&format!("[cmd] enter save_enabled_models count={}", enabled.len()));
    let path = state.paths.lock().godex_config.clone();
    config::save_enabled_models(&path, &enabled)?;
    Ok(enabled.len())
}

#[derive(Serialize)]
pub struct RemoteModel {
    pub id: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn fetch_remote_models(base_url: String, api_key: String) -> Result<Vec<RemoteModel>, String> {
    crate::diag(&format!("[cmd] enter fetch_remote_models base_url={}", base_url));
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let req = reqwest_via_ureq(&url, &api_key)?;
    let parsed: serde_json::Value = serde_json::from_str(&req).map_err(|e| format!("parse failed: {}", e))?;
    let arr = parsed.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let models = arr.into_iter()
        .filter_map(|v| v.get("id").and_then(|id| id.as_str()).map(|s| RemoteModel { id: s.to_string() }))
        .collect();
    Ok(models)
}

fn reqwest_via_ureq(url: &str, api_key: &str) -> Result<String, String> {
    // We avoid pulling in reqwest; use the Windows WinHTTP via the web_get
    // command in Tauri instead. For now this is a thin HTTP shim.
    let agent = ureq::Agent::new();
    let mut req = agent.get(url);
    if !api_key.is_empty() {
        req = req.set("Authorization", &format!("Bearer {}", api_key));
    }
    let resp = req.call().map_err(|e| format!("upstream error: {}", e))?;
    let body = resp.into_string().map_err(|e| format!("read body failed: {}", e))?;
    Ok(body)
}

#[derive(Serialize)]
pub struct GodexStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub config: String,
    pub binary: String,
}

#[tauri::command]
pub fn godex_status(state: State<'_, AppState>) -> GodexStatus {
    crate::diag(&format!("[cmd] enter godex_status"));
    let running = state.godex.pid().is_some();
    let pid = state.godex.pid();
    let config = state.paths.lock().godex_config.display().to_string();
    let binary = state.paths.lock().godex_binary.display().to_string();
    let s = GodexStatus { running, pid, config, binary };
    s
}

#[tauri::command]
pub fn godex_restart(state: State<'_, AppState>, app: AppHandle) -> Result<u32, String> {
    crate::diag(&format!("[cmd] enter godex_restart"));
    use std::sync::Arc;
    let sup: Arc<crate::godex::GodexSupervisor> = Arc::clone(&state.godex);
    sup.start(&app)
}

#[tauri::command]
pub fn godex_kill(state: State<'_, AppState>) {
    crate::diag(&format!("[cmd] enter godex_kill"));
    state.godex.kill();
}

#[tauri::command]
pub fn godex_start(state: State<'_, AppState>, app: AppHandle) -> Result<u32, String> {
    crate::diag(&format!("[cmd] enter godex_start"));
    use std::sync::Arc;
    let sup: Arc<crate::godex::GodexSupervisor> = Arc::clone(&state.godex);
    sup.start(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn godex_logs_tail(state: State<'_, AppState>, limit: Option<usize>) -> Vec<LogLine> {
    crate::diag(&format!("[cmd] enter godex_logs_tail limit={:?}", limit));
    state.godex.tail(limit.unwrap_or(200))
}

#[tauri::command]
pub fn godex_logs_clear(state: State<'_, AppState>) {
    crate::diag(&format!("[cmd] enter godex_logs_clear"));
    state.godex.clear();
}
