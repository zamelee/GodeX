use crate::config::{self, EnabledModel, ProviderInfo};
use crate::state::AppState;
use crate::godex::LogLine;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use chrono::Utc;

#[derive(Serialize)]
pub struct PathInfo {
    pub godex_config: String,
    pub godex_binary: String,
    pub godex_port: u16,
    pub external_mode: bool,
    pub logging_file: Option<String>,
}
#[tauri::command]
pub fn get_config_paths(state: State<'_, AppState>) -> PathInfo {
    crate::diag(&format!("[cmd] enter get_config_paths"));
    let p = state.paths.lock();
    PathInfo {
        godex_config: p.godex_config.display().to_string(),
        godex_binary: p.godex_binary.display().to_string(),
        godex_port: p.godex_port,
        external_mode: state.godex.is_external_mode(),
        logging_file: crate::state::read_logging_file_from_config(&p.godex_config),
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
pub async fn fetch_remote_models(
    app: AppHandle,
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

    let models: Vec<RemoteModel> = arr.into_iter()
        .filter_map(|v| {
            v.get("id").and_then(|id| id.as_str()).map(|s| RemoteModel { id: s.to_string() })
        })
        .collect();
    crate::diag(&format!("[fetch] extracted {} model ids", models.len()));
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

    // Snapshot paths under the lock, then drop it before any disk I/O so
    // a slow `std::fs::write` (e.g. while external godex.exe holds a handle
    // on `%USERPROFILE%\.godex\`) cannot freeze the Tauri IPC thread.
    let (config_str, binary_str) = {
        let p = state.paths.lock();
        (p.godex_config.display().to_string(), p.godex_binary.display().to_string())
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
