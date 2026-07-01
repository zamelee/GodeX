use crate::config::{self, EnabledModel, ProviderInfo};
use crate::state::AppState;
use crate::godex::LogLine;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use chrono::Utc;

#[derive(Serialize, Clone)]
pub struct PathInfo {
    pub godex_config: String,
    pub godex_binary: String,
    pub godex_port: u16,
    pub external_mode: bool,
    pub logging_file: Option<String>,
    pub session_db_path: String,
    pub trace_db_path: String,
    pub path_change_notice: Option<crate::state::PathChangeNotice>,
    pub path_provision_notice: Option<crate::state::PathProvisionNotice>,
}
#[tauri::command]
pub fn get_config_paths(state: State<'_, AppState>) -> PathInfo {
    crate::diag(&format!("[cmd] enter get_config_paths"));
    let p = state.paths.lock();
    // take() the notice so the user only sees it once per session
    let notice = state.path_change_notice.lock().take();
    let provision = state.path_provision_notice.lock().take();
    PathInfo {
        godex_config: p.godex_config.display().to_string(),
        godex_binary: p.godex_binary.display().to_string(),
        godex_port: p.godex_port,
        external_mode: state.godex.is_external_mode(),
        logging_file: crate::state::read_logging_file_from_config(&p.godex_config),
        session_db_path: p.session_db_path.display().to_string(),
        trace_db_path: p.trace_db_path.display().to_string(),
        path_change_notice: notice,
        path_provision_notice: provision,
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct PortInfo {
    pub pid: u32,
    pub name: String,
}

/// Look up the process listening on the given TCP port. Returns None if free.
#[tauri::command(rename_all = "camelCase")]
pub fn check_port(port: u16) -> Option<PortInfo> {
    crate::diag(&format!("[cmd] enter check_port port={}", port));
    let out = std::process::Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let needle = format!(":{}", port);
    for line in text.lines() {
        if !line.contains("LISTENING") { continue; }
        if !line.contains(&needle) { continue; }
        if let Some(pid_str) = line.split_whitespace().last() {
            if let Ok(pid) = pid_str.parse::<u32>() {
                if pid == 0 { continue; }
                let name = process_name_for_pid_check(pid).unwrap_or_else(|| "?".to_string());
                return Some(PortInfo { pid, name });
            }
        }
    }
    None
}

/// taskkill /F /PID <pid>
#[tauri::command]
pub fn kill_pid(pid: u32) -> Result<(), String> {
    crate::diag(&format!("[cmd] enter kill_pid pid={}", pid));
    let out = std::process::Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .output()
        .map_err(|e| format!("taskkill spawn failed: {}", e))?;
    if !out.status.success() {
        return Err(format!("taskkill failed: {}", String::from_utf8_lossy(&out.stderr)));
    }
    Ok(())
}

/// Find the first free port starting from `start`, up to start+1000.
#[tauri::command(rename_all = "camelCase")]
pub fn find_free_port(start: u16) -> u16 {
    crate::diag(&format!("[cmd] enter find_free_port start={}", start));
    let mut candidate = start;
    for _ in 0..1000 {
        if candidate < 1024 && candidate < start {
            break;
        }
        if check_port(candidate).is_none() {
            return candidate;
        }
        candidate = candidate.saturating_add(1);
        if candidate == start { break; }
    }
    start
}

fn process_name_for_pid_check(pid: u32) -> Option<String> {
    let out = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next()?;
    let name = first.split(',').next()?.trim_matches(|c: char| c == '"' || c == ' ');
    if name.is_empty() { None } else { Some(name.to_string()) }
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_config_paths(state: State<'_, AppState>, godex_config: String, godex_binary: String, godex_port: u16, logging_file: Option<String>) -> Result<PathInfo, String> {
    crate::diag(&format!("[cmd] enter set_config_paths config={} binary={} port={}", godex_config, godex_binary, godex_port));
    let config_pb = PathBuf::from(&godex_config);
    let binary_pb = PathBuf::from(&godex_binary);
    if !binary_pb.exists() {
        return Err(format!("binary not found: {}", godex_binary));
    }
    if godex_port == 0 {
        return Err("port must be > 0".to_string());
    }
    // Write port into config.yaml (single source of truth for the port)
    if config_pb.exists() {
        crate::state::write_port_to_config(&config_pb, godex_port)
            .map_err(|e| format!("write port failed: {}", e))?;
    }
    // Persist binary path (skip when GODEX_BINARY env var is overriding)
        // Write logging.file if provided
        if let Some(ref lf) = logging_file {
            if !lf.is_empty() {
                crate::state::write_logging_file_to_config(&config_pb, lf)
                    .map_err(|e| format!("write logging.file failed: {}", e))?;
            }
        }
    if std::env::var("GODEX_BINARY").is_err() {
        let persisted = crate::state::PersistedPaths {
            godex_config: Some(godex_config.clone()),
            godex_binary: Some(godex_binary.clone()),
            external_mode: state.godex.is_external_mode(),
            replica_mode: state.godex.is_replica_mode(),
        };
        if let Err(e) = crate::state::save_persisted_paths(&persisted) {
            crate::diag(&format!("[cmd] set_config_paths persist failed: {}", e));
        }
    }
    state.godex.set_paths(config_pb.clone(), binary_pb.clone(), godex_port);
    {
        let mut p = state.paths.lock();
        p.godex_config = config_pb;
        p.godex_binary = binary_pb;
        p.godex_port = godex_port;
    }
    Ok(get_config_paths(state))
}

#[tauri::command]
pub fn reset_paths(state: State<'_, AppState>) -> PathInfo {
    crate::diag(&format!("[cmd] enter reset_paths"));
    crate::state::clear_persisted_paths();
    let defaults = crate::state::Paths::default_paths();
    state.godex.set_paths(defaults.godex_config.clone(), defaults.godex_binary.clone(), defaults.godex_port);
    state.godex.set_external_mode(defaults.external_mode);
    *state.paths.lock() = defaults.clone();
    PathInfo {
        godex_config: defaults.godex_config.display().to_string(),
        godex_binary: defaults.godex_binary.display().to_string(),
        godex_port: defaults.godex_port,
        external_mode: defaults.external_mode,
        logging_file: crate::state::read_logging_file_from_config(&defaults.godex_config),
        session_db_path: defaults.session_db_path.display().to_string(),
        trace_db_path: defaults.trace_db_path.display().to_string(),
        // reset_paths() is the user explicitly wiping state, so no notice needed
        path_change_notice: None,
        path_provision_notice: None,
    }
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
    let updated = sync_default_provider(&updated, &name);
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


// Keep `default_provider` pointing at a provider that actually exists.
// When the user adds a brand-new provider whose name does not match the
// existing `default_provider` (e.g. `minnimax.chat` vs the minimal-yaml
// default `minimax`), the runtime config check would fail with
// "Default provider is not configured". Auto-promote the freshly added
// provider to be the new default in that case, so the user does not
// have to manually edit YAML before their first request can flow.
fn sync_default_provider(raw: &str, new_provider_name: &str) -> String {
    let parsed: Result<serde_yaml::Value, _> = serde_yaml::from_str(raw);
    let Ok(value) = parsed else { return raw.to_string() };
    let current_default = value
        .get("default_provider")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let configured_names: Vec<String> = value
        .get("providers")
        .and_then(|v| v.as_mapping())
        .map(|m| m.keys().filter_map(|k| k.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    let needs_update = current_default.is_empty()
        || !configured_names.iter().any(|n| n == current_default);
    if !needs_update {
        return raw.to_string();
    }
    crate::diag(&format!(
        "[cmd] sync_default_provider: '{}' -> '{}'",
        current_default, new_provider_name
    ));
    raw.replacen(
        &format!("default_provider: {}", current_default),
        &format!("default_provider: {}", new_provider_name),
        1,
    )
}

// Strip a trailing inline empty mapping on the `providers:` top-level line.
// e.g. turn `providers: {}\n` into `providers:\n`. Idempotent and safe to
// call on already-clean documents. Without this, old buggy configs with
// `providers: {}\n\n  <name>:` would let find_provider_block match the
// orphan and bypass the insert-after strip path, leaving the document in
// a state js-yaml rejects ("bad indentation of a mapping entry").
fn strip_inline_empty_providers_block(raw: &str) -> String {
    raw.replace("providers: {}\n", "providers:\n")
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
    // Strip any inline empty mapping `providers: {}` first so the rest of
    // this function always operates on a `providers:` header followed by
    // children or whitespace, never a closed `{}` token. Without this, an
    // old buggy config with `providers: {}\n\n  <name>:` would let
    // find_provider_block match the orphan and bypass the insert-after strip.
    let raw = strip_inline_empty_providers_block(&raw);
    if let Some((start, end)) = find_provider_block(&raw, name) {
        // Eat the preceding newline so the new block sits cleanly.
        let cut_start = if start > 0 && raw.as_bytes()[start - 1] == b'\n' {
            start - 1
        } else {
            start
        };
        return format!("{}\n{}\n{}", &raw[..cut_start], new_block.trim_end(), &raw[end..]);
    }
    // Not found: insert after the `providers:` top-level line.
    let needle = "providers:";
    if let Some(idx) = raw.find(needle) {
        let at_line_start = idx == 0 || raw.as_bytes()[idx - 1] == b'\n';
        if at_line_start {
            let nl = raw[idx..].find('\n')
                .map(|i| idx + i + 1)
                .unwrap_or(raw.len());
            // raw was already stripped of `providers: {}` at function entry,
            // so we can simply use the whole `providers:` line as the prefix.
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


#[derive(serde::Serialize)]
pub struct EnabledModelsResponse {
    pub enabled: Vec<EnabledModel>,
    pub discovered: Vec<EnabledModel>,
}

#[tauri::command]
pub fn read_enabled_models(state: State<'_, AppState>) -> Result<EnabledModelsResponse, String> {
    crate::diag(&format!("[cmd] enter read_enabled_models"));
    let path = state.paths.lock().godex_config.clone();
    Ok(EnabledModelsResponse {
        enabled: config::read_enabled_models(&path),
        discovered: config::read_discovered_models(&path),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_enabled_models(
    state: State<'_, AppState>,
    enabled: Vec<EnabledModel>,
    discovered: Vec<EnabledModel>,
) -> Result<usize, String> {
    crate::diag(&format!(
        "[cmd] enter save_enabled_models enabled={} discovered={}",
        enabled.len(),
        discovered.len()
    ));
    let path = state.paths.lock().godex_config.clone();
    config::save_enabled_models(&path, &enabled, &discovered)?;
    Ok(enabled.len() + discovered.len())
}

#[derive(Serialize)]
pub struct RemoteModel {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub input_modalities: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max_tokens: Option<u64>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn fetch_remote_models(
    app: AppHandle,
    state: State<'_, AppState>,
    base_url: String,
    api_key: String,
) -> Result<Vec<RemoteModel>, String> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let key_disp = if api_key.is_empty() { "<none>".to_string() } else { format!("{}...", &api_key.chars().take(6).collect::<String>()) };
    crate::diag(&format!("[cmd] enter fetch_remote_models url={} key={}", url, key_disp));
    let _ = app.emit("godex://log", crate::log_line_info(&format!("[studio] fetch GET {}", url)));

    let body = match reqwest_via_ureq(&url, &api_key) {
        Ok(b) => b,
        Err(e) => {
            crate::diag(&format!("[fetch] HTTP error: {}", e));
            let _ = app.emit("godex://log", crate::log_line_error(&format!("[studio] fetch 失败: {}", e)));
            return Err(format!("上游请求失败: {}", e));
        }
    };
    crate::diag(&format!("[fetch] body bytes={}", body.len()));
    let preview: String = body.chars().take(200).collect();
    crate::diag(&format!("[fetch] preview: {}", preview));

    let parsed: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            crate::diag(&format!("[fetch] JSON parse failed: {}", e));
            let _ = app.emit("godex://log", crate::log_line_error(&format!("[studio] fetch 响应不是合法 JSON: {}", e)));
            return Err(format!("上游响应解析失败: {}", e));
        }
    };

    // OpenAI-compatible /v1/models returns { "data": [{ "id": "..." }, ...] }
    // Some proxies omit the wrapper and return a bare array. Handle both.
    let arr: Vec<serde_json::Value> = if let Some(a) = parsed.get("data").and_then(|v| v.as_array()) {
        a.clone()
    } else if let Some(a) = parsed.as_array() {
        a.clone()
    } else {
        crate::diag("[fetch] response has no 'data' array and is not an array");
        let _ = app.emit("godex://log", crate::log_line_warn("[studio] fetch 响应不含 data[] (不是 OpenAI /v1/models 格式?)"));
        Vec::new()
    };

    // 收集 id 列表
    let ids: Vec<String> = arr.into_iter()
        .filter_map(|v| v.get("id").and_then(|id| id.as_str()).map(|s| s.to_string()))
        .collect();
    crate::diag(&format!("[fetch] extracted {} model ids", ids.len()));

    // 用 preset 派生 name/description/input_modalities/context_window/max_tokens
    let pf = load_preset_file(&state.paths.lock().godex_binary).ok();
    let models: Vec<RemoteModel> = ids.into_iter().map(|id| {
        let mut m = RemoteModel {
            id: id.clone(),
            name: None,
            description: None,
            input_modalities: None,
            context_window: None,
            max_tokens: None,
        };
        if let Some(ref pf) = pf {
            if let Some(p) = match_preset(&id, pf) {
                m.name = Some(p.name);
                if p.context_window > 0 { m.context_window = Some(p.context_window); }
                if p.max_tokens > 0 { m.max_tokens = Some(p.max_tokens); }
                if !p.notes.is_empty() { m.description = Some(p.notes); }
                let mut mods = vec!["text".to_string()];
                if p.multimodal.image_input { mods.push("image".to_string()); }
                if p.multimodal.audio_input { mods.push("audio".to_string()); }
                if p.multimodal.video_input { mods.push("video".to_string()); }
                m.input_modalities = Some(mods);
            }
        }
        m
    }).collect();
    crate::diag(&format!("[fetch] enriched {} models via preset", models.len()));
    let _ = app.emit("godex://log", crate::log_line_info(&format!("[studio] fetch 解析到 {} 个模型", models.len())));
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
pub fn godex_restart(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    crate::diag(&format!("[cmd] enter godex_restart"));
    (&state.godex).start(app);
    Ok(())
}

#[tauri::command]
pub fn godex_kill(state: State<'_, AppState>) {
    crate::diag(&format!("[cmd] enter godex_kill"));
    state.godex.kill();
}

#[tauri::command]
pub fn godex_start(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    crate::diag(&format!("[cmd] enter godex_start"));
    (&state.godex).start(app);
    Ok(())
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

#[tauri::command(rename_all = "camelCase")]
pub fn set_external_mode(state: State<'_, AppState>, external_mode: bool) -> Result<(), String> {
    let t0 = Utc::now().timestamp_millis();
    crate::diag(&format!("[cmd] set_external_mode={} t0={}", external_mode, t0));

    // Snapshot paths and replica_mode under the lock, then drop it before any disk I/O so
    // a slow `std::fs::write` (e.g. while external godex.exe holds a handle
    // on `%USERPROFILE%\.godex\`) cannot freeze the Tauri IPC thread.
    let (config_str, binary_str, replica_mode_val) = {
        let p = state.paths.lock();
        (p.godex_config.display().to_string(), p.godex_binary.display().to_string(), state.godex.is_replica_mode())
    };

    // Persist + supervisor flag update happen on a worker thread; we wait
    // with a 5 s timeout so the JS caller can revert the checkbox instead
    // of hanging the UI indefinitely.
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let sup = state.godex.clone();
    std::thread::spawn(move || {
        let persisted = crate::state::PersistedPaths {
            godex_config: Some(config_str),
            godex_binary: Some(binary_str),
            external_mode,
            replica_mode: replica_mode_val,
        };
        if let Err(e) = crate::state::save_persisted_paths(&persisted) {
            let _ = tx.send(Err(format!("persist failed: {}", e)));
            return;
        }
        sup.set_external_mode(external_mode);
        let _ = tx.send(Ok(()));
    });

    let recv_res = rx.recv_timeout(std::time::Duration::from_secs(5));
    crate::diag(&format!("[cmd] set_external_mode recv t={}ms kind={:?}", Utc::now().timestamp_millis() - t0, match &recv_res { Ok(Ok(())) => "ok", Ok(Err(_)) => "err", Err(_) => "timeout" }));
    match recv_res {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("persist timed out after 5s".to_string()),
    }

    // Mirror persisted value into the in-memory state.
    { let mut p = state.paths.lock(); p.external_mode = external_mode; }
    Ok(())
}

#[tauri::command]
pub fn open_in_editor(path: String) -> Result<(), String> {
    crate::diag(&format!("[cmd] open_in_editor {}", path));
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn()
        .map_err(|e| format!("failed to open: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn launch_model_probe(state: State<'_, AppState>) -> Result<(), String> {
    crate::diag("[cmd] launch_model_probe");
    use std::path::PathBuf;
    use std::process::Stdio;
    let possible_paths = [
        PathBuf::from("D:/Documents/VibeCoding/GodeX/studio-tauri/model-probe/src-tauri/target/release/model-probe.exe"),
        PathBuf::from("D:/Documents/VibeCoding/GodeX/studio-tauri/model-probe/target/release/model-probe.exe"),
    ];
    let exe_path = possible_paths.iter().find(|p| p.exists())
        .ok_or("model-probe.exe not found. Build studio-tauri/model-probe first.")?;
    let cfg_path = {
        let p = state.paths.lock();
        p.godex_config.clone()
    };
    let mut cmd = std::process::Command::new(exe_path);
    if !cfg_path.as_os_str().is_empty() {
        cmd.arg(format!("--config={}", cfg_path.display()));
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn model-probe failed: {}", e))?;
    crate::diag(&format!("[cmd] launched model-probe from {}", exe_path.display()));
    Ok(())
}

#[derive(serde::Serialize)]
pub struct ReplicaStatus {
    pub enabled: bool,
    pub running: bool,
    pub pid: Option<u32>,
    pub replica_path: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_replica_mode(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    crate::diag(&format!("[cmd] set_replica_mode {}", enabled));
    state.godex.set_replica_mode(enabled);
    Ok(())
}

/// Set GodeX run mode: "builtin" | "replica" | "external".
/// Updates both external_mode and replica_mode flags atomically.
#[tauri::command]
pub fn set_godex_mode(state: State<'_, AppState>, mode: String) {
    crate::diag(&format!("[cmd] set_godex_mode={}", mode));
    state.godex.set_external_mode(mode == "external");
    state.godex.set_replica_mode(mode == "replica");
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_replica_status(state: State<'_, AppState>) -> ReplicaStatus {
    crate::diag("[cmd] get_replica_status");
    let godex = &state.godex;
    let enabled = godex.is_replica_mode();
    let pid = godex.replica_pid();
    let replica_path = godex.get_replica_binary().map(|p| p.display().to_string());
    ReplicaStatus {
        enabled,
        running: pid.is_some(),
        pid,
        replica_path,
    }
}

#[tauri::command]
pub fn start_godex_replica(state: State<'_, AppState>, app: AppHandle) -> Result<ReplicaStatus, String> {
    crate::diag("[cmd] start_godex_replica");
    if !state.godex.is_replica_mode() {
        return Err("replica mode not enabled".to_string());
    }
    let (pid, path) = state.godex.ensure_and_start_replica(&app)
        .map_err(|e| e)?;
    Ok(ReplicaStatus {
        enabled: true,
        running: true,
        pid: Some(pid),
        replica_path: Some(path.display().to_string()),
    })
}

#[tauri::command]
pub fn kill_godex_replica(state: State<'_, AppState>) -> Result<(), String> {
    crate::diag("[cmd] kill_godex_replica");
    state.godex.kill_replica();
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn tail_trace_logs(state: State<'_, AppState>, limit: Option<usize>, from_id: Option<i64>) -> Vec<crate::godex::TraceLogLine> {
    crate::diag(&format!("[cmd] tail_trace_logs limit={:?} from_id={:?}", limit, from_id));
    state.godex.tail_trace_logs(limit.unwrap_or(500), from_id)
}

#[tauri::command]
pub fn godex_external_start(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    crate::diag(&format!("[cmd] enter godex_external_start"));
    state.godex.set_external_mode(true);
    (&state.godex).start(app);
    Ok(())
}
// ── Model Presets ──────────────────────────────────────────────────────────

#[derive(serde::Deserialize, Clone, Debug, Serialize, Default)]
pub struct MultiModalCaps {
    #[serde(default)]
    pub image_input: bool,
    #[serde(default)]
    pub image_output: bool,
    #[serde(default)]
    pub audio_input: bool,
    #[serde(default)]
    pub audio_output: bool,
    #[serde(default)]
    pub video_input: bool,
    #[serde(default)]
    pub video_output: bool,
    #[serde(default)]
    pub tool_use: bool,
    #[serde(default)]
    pub stream: bool,
}

#[derive(serde::Deserialize, Clone, Debug, Serialize)]
pub struct ModelPreset {
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub context_window: u64,
    pub max_tokens: u64,
    #[serde(default)]
    pub multimodal: MultiModalCaps,
    #[serde(default)]
    pub notes: String,
}

#[derive(serde::Deserialize, Clone, Debug, Serialize)]
pub struct MatchRules {
    #[serde(default = "default_case_sensitive")]
    pub case_sensitive: bool,
    #[serde(default = "default_strategy_order")]
    pub strategy_order: Vec<String>,
    #[serde(default)]
    pub strip_prefixes: Vec<String>,
    #[serde(default)]
    pub strip_suffixes: Vec<String>,
}

fn default_case_sensitive() -> bool { false }
fn default_strategy_order() -> Vec<String> {
    vec!["exact".into(), "alias".into(), "contains".into(), "regex".into()]
}

#[derive(serde::Deserialize, Serialize)]
pub struct PresetFile {
    pub match_rules: MatchRules,
    pub presets: Vec<ModelPreset>,
}

/// Locate model-presets.json: same dir as binary, then ~/.godex/
fn find_preset_file(godex_binary: &std::path::Path) -> Option<std::path::PathBuf> {
    if let Some(parent) = godex_binary.parent() {
        let p = parent.join("model-presets.json");
        if p.exists() { return Some(p); }
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        let p = std::path::PathBuf::from(home).join(".godex").join("model-presets.json");
        if p.exists() { return Some(p); }
    }
    None
}

fn load_preset_file(godex_binary: &std::path::Path) -> Result<PresetFile, String> {
    let path = find_preset_file(godex_binary)
        .ok_or_else(|| "model-presets.json not found (check exe dir or ~/.godex/)".to_string())?;
    crate::diag(&format!("[preset] loaded from {}", path.display()));
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("read {}: {}", path.display(), e))?;
    let pf: PresetFile = serde_json::from_str(&content)
        .map_err(|e| format!("parse model-presets.json: {}", e))?;
    Ok(pf)
}

fn normalize_model_id(id: &str, rules: &MatchRules) -> String {
    let mut s = id.to_string();
    if !rules.case_sensitive { s = s.to_lowercase(); }
    for prefix in &rules.strip_prefixes {
        let low = if rules.case_sensitive { prefix.clone() } else { prefix.to_lowercase() };
        if let Some(rest) = s.strip_prefix(&low) { s = rest.to_string(); }
    }
    for suffix in &rules.strip_suffixes {
        let low = if rules.case_sensitive { suffix.clone() } else { suffix.to_lowercase() };
        if let Some(rest) = s.strip_suffix(&low) { s = rest.to_string(); }
    }
    s
}

fn match_preset(model_id: &str, pf: &PresetFile) -> Option<ModelPreset> {
    let rules = &pf.match_rules;
    let normalized = normalize_model_id(model_id, rules);

    for strategy in &rules.strategy_order {
        match strategy.as_str() {
            "exact" => {
                for preset in &pf.presets {
                    let name_norm = normalize_model_id(&preset.name, rules);
                    if name_norm == normalized { return Some(preset.clone()); }
                }
            }
            "alias" => {
                for preset in &pf.presets {
                    for alias in &preset.aliases {
                        let alias_norm = normalize_model_id(alias, rules);
                        if alias_norm == normalized { return Some(preset.clone()); }
                    }
                }
            }
            "contains" => {
                for preset in &pf.presets {
                    let name_norm = normalize_model_id(&preset.name, rules);
                    if name_norm.contains(&normalized) || normalized.contains(&name_norm) {
                        return Some(preset.clone());
                    }
                    for alias in &preset.aliases {
                        let alias_norm = normalize_model_id(alias, rules);
                        if alias_norm.contains(&normalized) || normalized.contains(&alias_norm) {
                            return Some(preset.clone());
                        }
                    }
                }
            }
            "regex" => {
                for preset in &pf.presets {
                    let combined = format!("{}|{}", preset.name, preset.aliases.join("|"));
                    if let Ok(re) = regex::Regex::new(&combined) {
                        if re.is_match(model_id) { return Some(preset.clone()); }
                    }
                }
            }
            _ => {}
        }
    }
    None
}

#[tauri::command(rename_all = "camelCase")]
pub fn load_model_presets(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    crate::diag("[cmd] enter load_model_presets");
    let p = state.paths.lock();
    let pf = load_preset_file(&p.godex_binary)?;
    serde_json::to_value(&pf).map_err(|e| format!("serialize presets: {}", e))
}

#[tauri::command(rename_all = "camelCase")]
pub fn match_model_preset(state: State<'_, AppState>, model_id: String) -> Result<serde_json::Value, String> {
    crate::diag(&format!("[cmd] match_model_preset id={}", model_id));
    let p = state.paths.lock();
    let pf = load_preset_file(&p.godex_binary)?;
    match match_preset(&model_id, &pf) {
        Some(preset) => serde_json::to_value(&preset).map_err(|e| format!("serialize: {}", e)),
        None => Ok(serde_json::Value::Null),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn write_codex_model_context(
    context_window: u64,
    auto_compact_ratio: Option<f64>,
) -> Result<(), String> {
    crate::diag(&format!("[cmd] write_codex_model_context cw={} ratio={:?}", context_window, auto_compact_ratio));
    crate::state::write_codex_model_context(context_window, auto_compact_ratio)
        .map_err(|e| format!("write codex config failed: {}", e))
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_codex_model_context() -> Result<Option<u64>, String> {
    crate::diag("[cmd] read_codex_model_context");
    Ok(crate::state::read_codex_model_context_window())
}

#[cfg(test)]
mod upsert_provider_inline_empty_tests {
    use super::{replace_provider_block, sync_default_provider};

    #[test]
    fn insert_after_providers_with_inline_empty_mapping_yields_parsable_yaml() {
        // Mimics the minimal yaml ensure_godex_config used to write on first
        // launch (before the MINIMAL_GODEX_CONFIG fix).
        let raw = "server:\n  host: 0.0.0.0\n  port: 5678\n\ndefault_provider: minimax\n\nproviders: {}\n\nsession:\n  backend: memory\n\nlogging:\n  level: info\n\ntrace:\n  enabled: true\n\nmodels:\n  enabled: []\n";
        let block = "  minnimax:\n    spec: minimax\n    credentials:\n      api_key: gw-c-44b1\n    endpoint:\n      base_url: https://minnimax.chat/v1\n    timeout_ms: 120000\n";
        let updated = replace_provider_block(raw, "minnimax", block);

        // The inline `{}` must be stripped, so `providers:` is followed by
        // an indented mapping entry, not by `{}` and then orphan entries.
        assert!(
            !updated.contains("providers: {}"),
            "inline empty mapping must be stripped, got:\n{}",
            updated
        );
        assert!(
            updated.contains("\n  minnimax:\n"),
            "provider block must start on its own indented line, got:\n{}",
            updated
        );

        // The updated document must be parseable as YAML.
        let parsed: serde_yaml::Value = serde_yaml::from_str(&updated)
            .expect("updated yaml must parse");
        let providers = parsed.get("providers").and_then(|v| v.as_mapping()).expect("providers mapping");
        let entry = providers.get("minnimax").and_then(|v| v.as_mapping()).expect("minnimax entry");
        assert_eq!(entry.get("spec").and_then(|v| v.as_str()), Some("minimax"));
        assert_eq!(
            entry.get("credentials")
                .and_then(|c| c.get("api_key"))
                .and_then(|k| k.as_str()),
            Some("gw-c-44b1")
        );
        assert_eq!(
            entry.get("endpoint")
                .and_then(|e| e.get("base_url"))
                .and_then(|u| u.as_str()),
            Some("https://minnimax.chat/v1")
        );
    }

    #[test]
    fn insert_after_providers_without_inline_mapping_is_unchanged() {
        // Pre-existing users whose config has `providers:` followed by
        // existing provider blocks must not be touched by the strip path.
        let raw = "providers:\n  openai:\n    spec: openai\n    credentials:\n      api_key: gw-x\n";
        let block = "  minnimax:\n    spec: minimax\n    credentials:\n      api_key: gw-c-44b1\n";
        let updated = replace_provider_block(raw, "minnimax", block);

        // The new provider should be inserted alongside the existing one.
        assert!(updated.contains("providers:\n"));
        assert!(updated.contains("  openai:\n"));
        assert!(updated.contains("  minnimax:\n"));

        let parsed: serde_yaml::Value = serde_yaml::from_str(&updated).expect("parse");
        let providers = parsed.get("providers").and_then(|v| v.as_mapping()).expect("providers mapping");
        assert!(providers.contains_key("openai"));
        assert!(providers.contains_key("minnimax"));
    }

    #[test]
    fn upsert_on_old_broken_yaml_with_orphan_provider_recovers() {
        // This is the exact broken shape the previous Studio bug produced:
        // `providers: {}` was not stripped, so the inserted provider block
        // landed as an orphan below the inline empty mapping.
        let raw = "server:\n  host: 0.0.0.0\n  port: 5678\n\ndefault_provider: minimax\n\nproviders: {}\n\n  minnimax:\n    spec: minimax\n    credentials:\n      api_key: gw-c-OLD\n    endpoint:\n      base_url: https://minnimax.chat/v1\n    timeout_ms: 120000\n\nsession:\n  backend: memory\n\nlogging:\n  level: info\n\ntrace:\n  enabled: true\n\nmodels:\n  enabled: []\n";
        let block = "  minnimax:\n    spec: minimax\n    credentials:\n      api_key: gw-c-NEW\n    endpoint:\n      base_url: https://minnimax.chat/v1\n    timeout_ms: 120000\n";
        let updated = replace_provider_block(raw, "minnimax", block);

        assert!(
            !updated.contains("providers: {}"),
            "inline empty mapping must be stripped, got:\n{}",
            updated
        );
        assert!(
            !updated.contains("gw-c-OLD"),
            "old api key must be replaced, got:\n{}",
            updated
        );

        let parsed: serde_yaml::Value = serde_yaml::from_str(&updated)
            .expect("updated yaml must parse");
        let providers = parsed.get("providers").and_then(|v| v.as_mapping()).expect("providers mapping");
        let entry = providers.get("minnimax").and_then(|v| v.as_mapping()).expect("minnimax entry");
        assert_eq!(
            entry.get("credentials")
                .and_then(|c| c.get("api_key"))
                .and_then(|k| k.as_str()),
            Some("gw-c-NEW")
        );
    }
    #[test]
    fn update_existing_provider_block_replaces_in_place() {
        // Happy path: a clean config with `providers:` followed by an
        // existing `  minnimax:` block, plus a `session:` block below.
        // The existing block must be replaced and a newline preserved
        // between `timeout_ms` and `session:` (regression test for a
        // previous `block.trim_end() + &raw[end..]` join that glued the
        // two together).
        let raw = "providers:\n  minnimax:\n    spec: minimax\n    credentials:\n      api_key: gw-OLD\n    endpoint:\n      base_url: https://minnimax.chat/v1\n    timeout_ms: 120000\n\nsession:\n  backend: memory\n";
        let block = "  minnimax:\n    spec: minimax\n    credentials:\n      api_key: gw-NEW\n    endpoint:\n      base_url: https://minnimax.chat/v1\n    timeout_ms: 120000\n";
        let updated = replace_provider_block(raw, "minnimax", block);

        assert!(
            !updated.contains("gw-OLD"),
            "old api key must be replaced, got:\n{}",
            updated
        );
        assert!(
            updated.contains("gw-NEW"),
            "new api key must be present, got:\n{}",
            updated
        );
        // The most important regression assertion: there must be a
        // newline between `timeout_ms: 120000` and `session:`.
        assert!(
            updated.contains("timeout_ms: 120000\nsession:"),
            "missing newline between block end and next section, got:\n{}",
            updated
        );

        let parsed: serde_yaml::Value = serde_yaml::from_str(&updated).expect("parse");
        let providers = parsed.get("providers").and_then(|v| v.as_mapping()).expect("providers mapping");
        let entry = providers.get("minnimax").and_then(|v| v.as_mapping()).expect("minnimax entry");
        assert_eq!(
            entry.get("credentials")
                .and_then(|c| c.get("api_key"))
                .and_then(|k| k.as_str()),
            Some("gw-NEW")
        );
        assert_eq!(parsed.get("session").and_then(|s| s.get("backend")).and_then(|b| b.as_str()), Some("memory"));
    }

    #[test]
    fn sync_default_provider_updates_when_old_default_does_not_exist() {
        let raw = "server:\n  port: 5678\ndefault_provider: minimax\nproviders:\n  minnimax.chat:\n    spec: minimax\n";
        let updated = sync_default_provider(raw, "minnimax.chat");
        assert!(
            updated.contains("default_provider: minnimax.chat"),
            "default_provider must point to the new provider, got:\n{}",
            updated
        );
        assert!(
            !updated.contains("default_provider: minimax\n"),
            "old default_provider must be replaced, got:\n{}",
            updated
        );
        // Idempotent when the new provider is already the default.
        let again = sync_default_provider(&updated, "minnimax.chat");
        assert_eq!(again, updated);
    }

    #[test]
    fn sync_default_provider_leaves_valid_default_unchanged() {
        let raw = "default_provider: openai\nproviders:\n  openai:\n    spec: openai\n  anthropic:\n    spec: anthropic\n";
        let updated = sync_default_provider(raw, "minnimax.chat");
        assert_eq!(updated, raw);
    }

    #[test]
    fn sync_default_provider_fills_empty_default() {
        let raw = "default_provider: \"\"\nproviders:\n  minnimax.chat:\n    spec: minimax\n";
        let updated = sync_default_provider(raw, "minnimax.chat");
        assert!(
            updated.contains("default_provider: minnimax.chat"),
            "empty default must be filled in, got:\n{}",
            updated
        );
    }

    #[test]
    fn sync_default_provider_returns_raw_unchanged_on_parse_failure() {
        let raw = "this is :: not [ valid yaml";
        let updated = sync_default_provider(raw, "minnimax.chat");
        assert_eq!(updated, raw);

// ============================================================
// Model Probe Command - Comprehensive capability detection
// ============================================================

use reqwest::blocking::Client;
use std::time::Duration;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProbeResultFull {
    pub model: String,
    pub context_window: Option<u64>,
    pub max_tokens: Option<u64>,
    pub text: Option<bool>,
    pub image: Option<bool>,
    pub video: Option<bool>,
    pub audio: Option<bool>,
    pub function: Option<bool>,
    pub computer_use: Option<bool>,
    pub tool_search: Option<bool>,
    pub web_search: Option<bool>,
    pub file_search: Option<bool>,
    pub mcp: Option<bool>,
    pub reasoning: Option<String>,
    pub success: bool,
    pub error: Option<String>,
}

/// Full model probing with binary search for context window and comprehensive capability detection
#[tauri::command]
pub fn probe_model(
    base_url: String,
    api_key: String,
    model: String,
    claimed_ctx: u64,
    claimed_max_tokens: u64,
) -> Result<ProbeResultFull, String> {
    crate::diag(&format!("[probe] Starting for {} claimed_ctx={} claimed_max={}", model, claimed_ctx, claimed_max_tokens));
    
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let auth = format!("Bearer {}", api_key);
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(reqwest::header::AUTHORIZATION, auth.parse().unwrap());
    headers.insert(reqwest::header::CONTENT_TYPE, "application/json".parse().unwrap());

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    crate::diag(&format!("[probe] URL: {}", url));

    // 1. Probe context window with binary search
    let max_input = probe_context_window(&client, &url, &headers, &model, claimed_ctx);
    
    // 2. Probe max_tokens
    let max_output = probe_max_tokens(&client, &url, &headers, &model, claimed_max_tokens);
    
    // 3. Probe capabilities
    let caps = probe_capabilities(&client, &url, &headers, &model);

    crate::diag(&format!("[probe] Done for {}: ctx={:?} max_tokens={:?}", model, max_input, max_output));

    match (max_input, max_output, caps) {
        (Ok(mi), Ok(mo), Ok(c)) => Ok(ProbeResultFull {
            model,
            context_window: mi,
            max_tokens: mo,
            text: c.text,
            image: c.image,
            video: c.video,
            audio: c.audio,
            function: c.function,
            computer_use: c.computer_use,
            tool_search: c.tool_search,
            web_search: c.web_search,
            file_search: c.file_search,
            mcp: c.mcp,
            reasoning: c.reasoning,
            success: mi.is_some(),
            error: None,
        }),
        (Err(e), _, _) | (_, Err(e), _) | (_, _, Err(e)) => Ok(ProbeResultFull {
            model,
            context_window: None,
            max_tokens: None,
            text: None,
            image: None,
            video: None,
            audio: None,
            function: None,
            computer_use: None,
            tool_search: None,
            web_search: None,
            file_search: None,
            mcp: None,
            reasoning: None,
            success: false,
            error: Some(e),
        }),
    }
}

struct Capabilities {
    text: Option<bool>,
    image: Option<bool>,
    video: Option<bool>,
    audio: Option<bool>,
    function: Option<bool>,
    computer_use: Option<bool>,
    tool_search: Option<bool>,
    web_search: Option<bool>,
    file_search: Option<bool>,
    mcp: Option<bool>,
    reasoning: Option<String>,
}

fn probe_context_window(
    client: &Client,
    url: &str,
    headers: &reqwest::header::HeaderMap,
    model: &str,
    claimed: u64,
) -> Result<Option<u64>, String> {
    // Step 1: Fast range finding (claimed -> 2x -> 4x -> FAIL)
    let mut test_val = claimed;
    let mut last_ok = claimed;
    let max_reasonable = 4_000_000u64;

    while test_val <= max_reasonable {
        let content_len = ((test_val as f64) * 0.75) as usize;
        let content = "A".repeat(content_len.max(100));

        let body = serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": 32
        });

        match client.post(url).headers(headers.clone()).json(&body).send() {
            Ok(r) if r.status().is_success() => {
                last_ok = test_val;
                test_val = ((test_val as f64) * 2.0) as u64;
            }
            _ => break,
        }
    }

    // Step 2: Binary search for exact value
    if last_ok < max_reasonable {
        let mut lo = last_ok;
        let mut hi = test_val.min(max_reasonable);
        
        while lo + 10000 < hi {
            let mid = (lo + hi) / 2;
            let content_len = ((mid as f64) * 0.75) as usize;
            let content = "A".repeat(content_len.max(100));

            let body = serde_json::json!({
                "model": model,
                "messages": [{"role": "user", "content": content}],
                "max_tokens": 32
            });

            match client.post(url).headers(headers.clone()).json(&body).send() {
                Ok(r) if r.status().is_success() => lo = mid,
                _ => hi = mid,
            }
        }
        return Ok(Some(lo));
    }

    Ok(Some(last_ok))
}

fn probe_max_tokens(
    client: &Client,
    url: &str,
    headers: &reqwest::header::HeaderMap,
    model: &str,
    _claimed: u64,
) -> Result<Option<u64>, String> {
    let test_values = vec![16384, 32768, 65536, 131072, 196608, 262144];

    let mut last_ok = None;
    for mt in test_values {
        let body = serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": "OK"}],
            "max_tokens": mt
        });

        match client.post(url).headers(headers.clone()).json(&body).send() {
            Ok(r) if r.status().is_success() => {
                last_ok = Some(mt);
            }
            Ok(r) if r.status().as_u16() == 400 => {
                break;
            }
            _ => {}
        }
    }

    Ok(last_ok)
}

fn probe_capabilities(
    client: &Client,
    url: &str,
    headers: &reqwest::header::HeaderMap,
    model: &str,
) -> Result<Capabilities, String> {
    // 1. Text (baseline)
    let text = test_simple_chat(client, url, headers, model);

    // 2. Image
    let image = test_image(client, url, headers, model);

    // 3. Video (hard to test, skip)
    let video = None;

    // 4. Audio (hard to test, skip)
    let audio = None;

    // 5. Function call
    let function = test_function_call(client, url, headers, model);

    // 6. Reasoning
    let reasoning = test_reasoning(client, url, headers, model);

    // 7. Other tools - batch test
    let (computer_use, tool_search, web_search, file_search, mcp) = test_tools_batch(client, url, headers, model);

    Ok(Capabilities {
        text,
        image,
        video,
        audio,
        function,
        computer_use,
        tool_search,
        web_search,
        file_search,
        mcp,
        reasoning,
    })
}

fn test_simple_chat(client: &Client, url: &str, headers: &reqwest::header::HeaderMap, model: &str) -> Option<bool> {
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 10
    });

    match client.post(url).headers(headers.clone()).json(&body).send() {
        Ok(r) if r.status().is_success() => Some(true),
        _ => Some(false),
    }
}

fn test_image(client: &Client, url: &str, headers: &reqwest::header::HeaderMap, model: &str) -> Option<bool> {
    // Tiny 1x1 transparent PNG base64
    let tiny_png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
    let body = serde_json::json!({
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "What is this?"},
                {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{}", tiny_png)}}
            ]
        }],
        "max_tokens": 20
    });

    match client.post(url).headers(headers.clone()).json(&body).send() {
        Ok(r) if r.status().is_success() => Some(true),
        _ => Some(false),
    }
}

fn test_function_call(client: &Client, url: &str, headers: &reqwest::header::HeaderMap, model: &str) -> Option<bool> {
    let tools = serde_json::json!([{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get weather for a location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string"}
                }
            }
        }
    }]);

    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "What's the weather in Beijing?"}],
        "tools": tools,
        "tool_choice": "auto",
        "max_tokens": 100
    });

    match client.post(url).headers(headers.clone()).json(&body).send() {
        Ok(r) if r.status().is_success() => {
            if let Ok(text) = r.text() {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(choice) = json.get("choices").and_then(|c| c.as_array()).and_then(|a| a.first()) {
                        if choice.get("message").and_then(|m| m.get("tool_calls")).is_some() {
                            return Some(true);
                        }
                    }
                }
            }
            Some(false)
        }
        _ => Some(false),
    }
}

fn test_reasoning(client: &Client, url: &str, headers: &reqwest::header::HeaderMap, model: &str) -> Option<String> {
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "1+1=?"}],
        "max_tokens": 50,
        "reasoning_effort": "medium"
    });

    match client.post(url).headers(headers.clone()).json(&body).send() {
        Ok(r) if r.status().is_success() => Some("medium".to_string()),
        _ => None,
    }
}

fn test_tools_batch(client: &Client, url: &str, headers: &reqwest::header::HeaderMap, model: &str) -> (Option<bool>, Option<bool>, Option<bool>, Option<bool>, Option<bool>) {
    let all_tools = serde_json::json!([
        {"type": "function", "function": {"name": "test", "description": "test", "parameters": {"type": "object", "properties": {}}}},
        {"type": "computer_use", "provider": "windows"},
        {"type": "tool_search"},
        {"type": "web_search"},
        {"type": "file_search"},
    ]);

    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "hi"}],
        "tools": all_tools,
        "tool_choice": "auto",
        "reasoning_effort": "medium"
    });

    match client.post(url).headers(headers.clone()).json(&body).send() {
        Ok(r) if r.status().is_success() => {
            (Some(true), Some(true), Some(true), Some(true), Some(false))
        }
        Ok(r) if r.status().as_u16() == 400 => {
            let function = test_function_call(client, url, headers, model);
            (function, Some(false), Some(false), Some(false), Some(false))
        }
        _ => (Some(false), Some(false), Some(false), Some(false), Some(false)),
    }
}

    }
}


// ============================================================
// New 3-command probe (split from probe_model for live progress)
// ============================================================

#[tauri::command]
pub fn probe_ctx(
    app: AppHandle,
    base_url: String,
    api_key: String,
    model: String,
    claimed: u64,
) -> Result<Option<u64>, String> {
    crate::diag(&format!("[probe_ctx] {} claimed={}", model, claimed));
    let mut client = crate::probe::ProbeClient::new(&base_url, &api_key, &model)
        .map_err(|e| format!("client: {}", e))?;
    let result = client.probe_ctx(claimed);
    let events = client.take_events();
    for ev in events {
        let _ = app.emit("probe-progress", &ev);
    }
    Ok(result)
}

#[tauri::command]
pub fn probe_max_tokens(
    app: AppHandle,
    base_url: String,
    api_key: String,
    model: String,
    claimed: u64,
) -> Result<Option<u64>, String> {
    crate::diag(&format!("[probe_max_tokens] {} claimed={}", model, claimed));
    let mut client = crate::probe::ProbeClient::new(&base_url, &api_key, &model)
        .map_err(|e| format!("client: {}", e))?;
    let result = client.probe_max_tokens(claimed);
    let events = client.take_events();
    for ev in events {
        let _ = app.emit("probe-progress", &ev);
    }
    Ok(result)
}

#[tauri::command]
pub fn probe_caps(
    app: AppHandle,
    base_url: String,
    api_key: String,
    model: String,
) -> Result<crate::probe::Capabilities, String> {
    crate::diag(&format!("[probe_caps] {}", model));
    let mut client = crate::probe::ProbeClient::new(&base_url, &api_key, &model)
        .map_err(|e| format!("client: {}", e))?;
    let caps = client.probe_caps();
    let events = client.take_events();
    for ev in events {
        let _ = app.emit("probe-progress", &ev);
    }
    Ok(caps)
}

