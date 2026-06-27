use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

struct AppState {
    config_path: Mutex<Option<PathBuf>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProbeResult {
    pub model: String,
    pub max_input: Option<u64>,
    pub max_output: Option<u64>,
    pub text: Option<bool>,
    pub image: Option<bool>,
    pub function: Option<bool>,
    pub computer_use: Option<bool>,
    pub tool_search: Option<bool>,
    pub reasoning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnabledModel {
    pub provider: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margin: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub name: String,
    pub base_url: String,
    pub api_key: String,
}

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> Result<(Vec<EnabledModel>, Vec<ProviderInfo>), String> {
    let config_path = state.config_path.lock().unwrap().clone().ok_or("config path not set")?;
    let raw = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    
    let mut models = Vec::new();
    let mut providers = HashMap::new();
    let mut in_providers = false;
    let mut in_models = false;
    let mut in_enabled = false;
    let mut current_provider = String::new();
    let mut current_api_key = String::new();
    let mut current_base_url = String::new();
    
    for line in raw.lines() {
        let trimmed = line.trim_start();
        
        if trimmed == "providers:" { in_providers = true; in_models = false; continue; }
        if trimmed == "models:" { in_models = true; in_providers = false; continue; }
        
        if !line.is_empty() && !line.starts_with(' ') && !line.starts_with('\t') {
            if in_providers {
                if !trimmed.starts_with('#') {
                    if !current_provider.is_empty() {
                        providers.insert(current_provider.clone(), ProviderInfo {
                            name: current_provider.clone(),
                            base_url: current_base_url.clone(),
                            api_key: current_api_key.clone(),
                        });
                    }
                    current_provider = trimmed.trim_end_matches(':').to_string();
                    current_api_key.clear();
                    current_base_url.clear();
                }
            }
            if in_enabled && !trimmed.starts_with("enabled:") && !trimmed.starts_with("discovered:") {
                in_enabled = false;
            }
            continue;
        }
        
        if in_providers {
            let indent = line.len() - trimmed.len();
            if indent == 2 && !trimmed.is_empty() && !trimmed.starts_with('#') {
                if !current_provider.is_empty() {
                    providers.insert(current_provider.clone(), ProviderInfo {
                        name: current_provider.clone(),
                        base_url: current_base_url.clone(),
                        api_key: current_api_key.clone(),
                    });
                }
                current_provider = trimmed.trim_end_matches(':').to_string();
            }
            if let Some(rest) = trimmed.strip_prefix("endpoint:") {
                current_base_url = rest.trim().to_string();
            }
            if let Some(rest) = trimmed.strip_prefix("api_key:") {
                current_api_key = rest.trim().to_string();
            }
        }
        
        if in_models && in_enabled {
            if trimmed.starts_with("- provider:") {
                if let Some(p) = trimmed.strip_prefix("- provider:") {
                    models.push(EnabledModel {
                        provider: p.trim().to_string(),
                        model: String::new(),
                        context_window: None,
                        max_tokens: None,
                        margin: None,
                    });
                }
            } else if let Some(m) = models.last_mut() {
                if let Some(rest) = trimmed.strip_prefix("model:") {
                    m.model = rest.trim().to_string();
                } else if let Some(rest) = trimmed.strip_prefix("context_window:") {
                    m.context_window = rest.trim().parse().ok();
                } else if let Some(rest) = trimmed.strip_prefix("max_tokens:") {
                    m.max_tokens = rest.trim().parse().ok();
                } else if let Some(rest) = trimmed.strip_prefix("margin:") {
                    m.margin = rest.trim().parse().ok();
                }
            }
        }
    }
    
    if !current_provider.is_empty() {
        providers.insert(current_provider.clone(), ProviderInfo {
            name: current_provider,
            base_url: current_base_url,
            api_key: current_api_key,
        });
    }
    
    Ok((models, providers.into_values().collect()))
}

#[tauri::command]
fn save_probe_results(state: State<'_, AppState>, results: Vec<ProbeResult>) -> Result<(), String> {
    let config_path = state.config_path.lock().unwrap().clone().ok_or("config path not set")?;
    let raw = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = raw.lines().map(String::from).collect();
    let margin = read_margin_from_yaml(&raw).unwrap_or(0.95);
    
    for result in &results {
        let model_name = &result.model;
        let effective_ctx = result.max_input.map(|v| ((v as f64) * margin) as u64);
        
        let mut in_models = false;
        let mut in_enabled = false;
        
        for i in 0..lines.len() {
            let trimmed = lines[i].trim_start();
            if trimmed == "models:" { in_models = true; continue; }
            if in_models && trimmed.starts_with("enabled:") { in_enabled = true; continue; }
            if in_models && !in_enabled && !trimmed.is_empty() && !trimmed.starts_with(' ') && !trimmed.starts_with('\t') { break; }
            
            if in_models && in_enabled && trimmed.starts_with("- provider:") {
                if i + 1 < lines.len() && lines[i + 1].contains(&format!("  model: {}", model_name)) {
                    if let Some(ctx) = effective_ctx {
                        let ctx_line = format!("      context_window: {}", ctx);
                        let mut found = false;
                        let mut after_model = i + 1;
                        for j in (i+1)..lines.len() {
                            let t2 = lines[j].trim_start();
                            if t2.starts_with("- provider:") || (!t2.is_empty() && !t2.starts_with(' ')) {
                                break;
                            }
                            if t2.starts_with("context_window:") {
                                lines[j] = ctx_line.clone();
                                found = true;
                                break;
                            }
                            if t2.starts_with("model:") { after_model = j; }
                        }
                        if !found {
                            lines.insert(after_model + 1, ctx_line);
                        }
                    }
                }
            }
        }
    }
    
    fs::write(&config_path, lines.join("\n")).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_config_path(state: State<'_, AppState>, path: String) {
    *state.config_path.lock().unwrap() = Some(PathBuf::from(path));
}

#[tauri::command]
fn check_godex_running(port: u16) -> bool {
    TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok()
}

#[tauri::command]
fn get_default_config_path() -> Option<String> {
    if let Ok(home) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(&home).join(".godex").join("config.yaml");
        if p.exists() { return Some(p.display().to_string()); }
    }
    std::env::current_dir().ok()
        .map(|d| d.join("godex.yaml"))
        .filter(|p| p.exists())
        .map(|p| p.display().to_string())
}

#[tauri::command]
fn get_godex_url() -> String {
    std::env::var("GODEX_URL").unwrap_or_else(|_| "http://localhost:5678".to_string())
}

static CLI_CONFIG_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Parse --config=<path> (or --config <path>) from std::env::args().
/// Stored in CLI_CONFIG_PATH for run() to read.
pub fn parse_cli_args() {
    let args: Vec<String> = std::env::args().collect();
    let mut config_path: Option<PathBuf> = None;
    let mut i = 1;
    while i < args.len() {
        let arg = &args[i];
        if let Some(rest) = arg.strip_prefix("--config=") {
            config_path = Some(PathBuf::from(rest));
        } else if arg == "--config" {
            if i + 1 < args.len() {
                config_path = Some(PathBuf::from(&args[i + 1]));
                i += 1;
            }
        }
        i += 1;
    }
    let _ = CLI_CONFIG_PATH.set(config_path);
}

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let state = AppState {
        config_path: Mutex::new(CLI_CONFIG_PATH.get().cloned().unwrap_or(None).filter(|p| p.exists())),
    };
    
    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_probe_results,
            set_config_path,
            check_godex_running,
            get_default_config_path,
            get_godex_url,
        ])
        .setup(|app| {
            // 1) If --config was provided and the file exists, use it.
            if let Some(Some(cli_path)) = CLI_CONFIG_PATH.get().map(|p| p.as_ref()) {
                if cli_path.exists() {
                    if let Some(s) = app.try_state::<AppState>() {
                        *s.config_path.lock().unwrap() = Some(cli_path.clone());
                    }
                    return Ok(());
                }
            }
            // 2) Fall back: USERPROFILE/.godex/config.yaml
            if let Ok(home) = std::env::var("USERPROFILE") {
                let p = PathBuf::from(&home).join(".godex").join("config.yaml");
                if p.exists() {
                    if let Some(s) = app.try_state::<AppState>() {
                        *s.config_path.lock().unwrap() = Some(p);
                    }
                    return Ok(());
                }
            }
            // 3) Fall back: cwd/godex.yaml
            if let Ok(cwd) = std::env::current_dir() {
                let p = cwd.join("godex.yaml");
                if p.exists() {
                    if let Some(s) = app.try_state::<AppState>() {
                        *s.config_path.lock().unwrap() = Some(p);
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


/// Read first margin: value found in models.enabled[*].margin section.
/// Returns None if the key is absent or unparseable.
fn read_margin_from_yaml(raw: &str) -> Option<f64> {
    let mut in_models = false;
    let mut in_enabled = false;
    for line in raw.lines() {
        let trimmed = line.trim_start();
        if trimmed == "models:" { in_models = true; continue; }
        if in_models && trimmed.starts_with("enabled:") { in_enabled = true; continue; }
        if in_models && !in_enabled && !trimmed.is_empty() && !trimmed.starts_with(" ") && !trimmed.starts_with("	") { break; }
        if in_models && in_enabled {
            if let Some(rest) = trimmed.strip_prefix("margin:") {
                return rest.trim().parse().ok();
            }
        }
    }
    None
}
