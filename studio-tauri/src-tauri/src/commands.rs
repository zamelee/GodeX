use crate::config::{self, EnabledModel, ProviderInfo};
use crate::state::AppState;
use crate::godex::LogLine;
use serde::{Deserialize, Serialize};
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetConfigPathsArgs {
    pub godex_config: String,
    pub godex_binary: String,
}

#[tauri::command]
pub fn set_config_paths(state: State<'_, AppState>, args: SetConfigPathsArgs) -> PathInfo {
    crate::diag(&format!("[cmd] enter set_config_paths"));
    let config = PathBuf::from(&args.godex_config);
    let binary = PathBuf::from(&args.godex_binary);
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertProviderArgs {
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub spec: String,
    pub timeout_ms: u64,
}

#[tauri::command]
pub fn upsert_provider(state: State<'_, AppState>, args: UpsertProviderArgs) -> Result<(), String> {
    crate::diag(&format!("[cmd] enter upsert_provider"));
    let path = state.paths.lock().godex_config.clone();
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read failed: {}", e))?;
    let block = format!(
        "  {}:\n    spec: {}\n    credentials:\n      api_key: {}\n    endpoint:\n      base_url: {}\n    timeout_ms: {}\n",
        args.name, args.spec, args.api_key, args.base_url, args.timeout_ms
    );
    let updated = replace_provider_block(&raw, &args.name, &block);
    std::fs::write(&path, updated).map_err(|e| format!("write failed: {}", e))?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProviderArgs {
    pub name: String,
}

#[tauri::command]
pub fn delete_provider(state: State<'_, AppState>, args: DeleteProviderArgs) -> Result<(), String> {
    crate::diag(&format!("[cmd] enter delete_provider name={}", args.name));
    let path = state.paths.lock().godex_config.clone();
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read failed: {}", e))?;
    let updated = remove_provider_block(&raw, &args.name);
    std::fs::write(&path, updated).map_err(|e| format!("write failed: {}", e))?;
    Ok(())
}

fn replace_provider_block(raw: &str, name: &str, new_block: &str) -> String {
    let needle = format!("  {}:", name);
    if let Some(start) = raw.find(&needle) {
        let mut cut_end = raw.len();
        let after = &raw[start + needle.len()..];
        for line in after.lines() {
            if !line.is_empty() && !line.starts_with(' ') && !line.starts_with('\t') {
                if let Some(idx) = raw[start..].find(line) {
                    let abs = start + idx;
                    let mut line_start = abs;
                    while line_start > 0 && &raw[line_start - 1..line_start] != "\n" { line_start -= 1; }
                    cut_end = line_start;
                }
                break;
            }
        }
        let mut cut_start = start;
        if cut_start > 0 && &raw[cut_start - 1..cut_start] == "\n" { cut_start -= 1; }
        return format!("{}{}{}", &raw[..cut_start], new_block.trim_end(), &raw[cut_end..]);
    }
    // not found; insert after `providers:` line
    if let Some(idx) = raw.find("providers:") {
        let nl = raw[idx..].find('\n').unwrap_or(0) + idx + 1;
        return format!("{}{}\n{}", &raw[..nl], new_block.trim_end(), &raw[nl..]);
    }
    format!("providers:\n{}", new_block)
}

fn remove_provider_block(raw: &str, name: &str) -> String {
    let needle = format!("  {}:", name);
    if let Some(start) = raw.find(&needle) {
        let mut cut_end = raw.len();
        let after = &raw[start + needle.len()..];
        for line in after.lines() {
            if !line.is_empty() && !line.starts_with(' ') && !line.starts_with('\t') {
                if let Some(idx) = raw[start..].find(line) {
                    let abs = start + idx;
                    let mut line_start = abs;
                    while line_start > 0 && &raw[line_start - 1..line_start] != "\n" { line_start -= 1; }
                    cut_end = line_start;
                }
                break;
            }
        }
        let mut cut_start = start;
        if cut_start > 0 && &raw[cut_start - 1..cut_start] == "\n" { cut_start -= 1; }
        return format!("{}{}", &raw[..cut_start], &raw[cut_end..]);
    }
    raw.to_string()
}

#[tauri::command]
pub fn read_enabled_models(state: State<'_, AppState>) -> Result<Vec<EnabledModel>, String> {
    crate::diag(&format!("[cmd] enter read_enabled_models"));
    let path = state.paths.lock().godex_config.clone();
    Ok(config::read_enabled_models(&path))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEnabledModelsArgs {
    pub enabled: Vec<EnabledModel>,
}

#[tauri::command]
pub fn save_enabled_models(state: State<'_, AppState>, args: SaveEnabledModelsArgs) -> Result<usize, String> {
    crate::diag(&format!("[cmd] enter save_enabled_models"));
    let path = state.paths.lock().godex_config.clone();
    config::save_enabled_models(&path, &args.enabled)?;
    Ok(args.enabled.len())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRemoteArgs {
    pub base_url: String,
    pub api_key: String,
}

#[derive(Serialize)]
pub struct RemoteModel {
    pub id: String,
}

#[tauri::command]
pub async fn fetch_remote_models(args: FetchRemoteArgs) -> Result<Vec<RemoteModel>, String> {
    crate::diag(&format!("[cmd] enter fetch_remote_models"));
    let url = format!("{}/models", args.base_url.trim_end_matches('/'));
    let req = reqwest_via_ureq(&url, &args.api_key)?;
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogsTailArgs {
    pub limit: Option<usize>,
}

#[tauri::command]
pub fn godex_logs_tail(state: State<'_, AppState>, args: LogsTailArgs) -> Vec<LogLine> {
    crate::diag(&format!("[cmd] enter godex_logs_tail"));
    state.godex.tail(args.limit.unwrap_or(200))
}

#[tauri::command]
pub fn godex_logs_clear(state: State<'_, AppState>) {
    crate::diag(&format!("[cmd] enter godex_logs_clear"));
    state.godex.clear();
}
