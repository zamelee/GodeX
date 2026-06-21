use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ModelCapabilities {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub text: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub image_input: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub audio_input: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub video_input: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub image_output: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub audio_output: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tool_use: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub stream: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EnabledModel {
    pub provider: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub multimodal: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub capabilities: Option<ModelCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub name: String,
    pub spec: String,
    pub base_url: String,
    pub api_key: String,
    pub timeout_ms: u64,
}

pub fn read_providers(path: &Path) -> Vec<ProviderInfo> {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<ProviderInfo> = Vec::new();
    let mut in_providers = false;
    let mut current: Option<ProviderInfo> = None;
    for line in raw.lines() {
        if line.starts_with("providers:") {
            in_providers = true;
            continue;
        }
        if !in_providers {
            continue;
        }
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
        if indent == 2 && !trimmed.is_empty() && !trimmed.starts_with('#') {
            // top-level provider entry (2 spaces indent)
            if let Some(prev) = current.take() {
                out.push(prev);
            }
            let name = trimmed.trim_end_matches(':').to_string();
            current = Some(ProviderInfo {
                name,
                spec: String::new(),
                base_url: String::new(),
                api_key: String::new(),
                timeout_ms: 120000,
            });
            continue;
        }
        if let Some(p) = current.as_mut() {
            if let Some(rest) = trimmed.strip_prefix("spec:") {
                p.spec = rest.trim().to_string();
            } else if let Some(rest) = trimmed.strip_prefix("base_url:") {
                p.base_url = rest.trim().to_string();
            } else if let Some(rest) = trimmed.strip_prefix("api_key:") {
                p.api_key = rest.trim().to_string();
            } else if let Some(rest) = trimmed.strip_prefix("timeout_ms:") {
                p.timeout_ms = rest.trim().parse().unwrap_or(120000);
            }
        }
    }
    if let Some(prev) = current.take() {
        out.push(prev);
    }
    out
}

pub fn read_enabled_models(path: &Path) -> Vec<EnabledModel> {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<EnabledModel> = Vec::new();
    let mut in_models = false;
    let mut in_enabled = false;
    let mut current: Option<EnabledModel> = None;
    for line in raw.lines() {
        let trimmed = line.trim_start();
        if line.starts_with("models:") {
            in_models = true;
            continue;
        }
        if in_models && !in_enabled && trimmed.starts_with("enabled:") {
            in_enabled = true;
            continue;
        }
        if !in_enabled {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("- provider:") {
            if let Some(prev) = current.take() {
                out.push(prev);
            }
            current = Some(EnabledModel {
                provider: rest.trim().to_string(),
                model: String::new(),
                context_window: None,
                max_tokens: None,
                multimodal: None,
                capabilities: None,
                note: None,
            });
            continue;
        }
        if let Some(p) = current.as_mut() {
            if let Some(rest) = trimmed.strip_prefix("model:") {
                p.model = rest.trim().to_string();
            } else if let Some(rest) = trimmed.strip_prefix("context_window:") {
                p.context_window = rest.trim().parse().ok();
            } else if let Some(rest) = trimmed.strip_prefix("max_tokens:") {
                p.max_tokens = rest.trim().parse().ok();
            } else if let Some(rest) = trimmed.strip_prefix("multimodal:") {
                p.multimodal = Some(rest.trim() == "true");
            } else if let Some(rest) = trimmed.strip_prefix("note:") {
                let v = rest.trim();
                p.note = Some(v.trim_matches('"').to_string());
            }
        }
    }
    if let Some(prev) = current.take() {
        out.push(prev);
    }
    out
}

pub fn save_enabled_models(path: &Path, items: &[EnabledModel]) -> Result<(), String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read config failed: {}", e))?;
    let new_block = render_enabled_block(items);
    let updated = replace_or_insert(&raw, &new_block);
    fs::write(path, updated).map_err(|e| format!("write config failed: {}", e))?;
    Ok(())
}

fn render_enabled_block(items: &[EnabledModel]) -> String {
    if items.is_empty() {
        return "  enabled: []\n".to_string();
    }
    let mut s = String::from("  enabled:\n");
    for m in items {
        s.push_str(&format!("    - provider: {}\n", m.provider));
        s.push_str(&format!("      model: {}\n", m.model));
        if let Some(cw) = m.context_window {
            s.push_str(&format!("      context_window: {}\n", cw));
        }
        if let Some(mt) = m.max_tokens {
            s.push_str(&format!("      max_tokens: {}\n", mt));
        }
        if let Some(mm) = m.multimodal {
            s.push_str(&format!("      multimodal: {}\n", if mm { "true" } else { "false" }));
        }
        if let Some(cap) = &m.capabilities {
            let mut any = false;
            s.push_str("      capabilities:\n");
            let pairs = [
                ("text", cap.text),
                ("image_input", cap.image_input),
                ("audio_input", cap.audio_input),
                ("video_input", cap.video_input),
                ("image_output", cap.image_output),
                ("audio_output", cap.audio_output),
                ("tool_use", cap.tool_use),
                ("stream", cap.stream),
            ];
            for (k, v) in pairs {
                if let Some(b) = v {
                    s.push_str(&format!("        {}: {}\n", k, if b { "true" } else { "false" }));
                    any = true;
                }
            }
            if !any {
                // nothing tracked under capabilities, leave the section off
                let trim_end = s.len() - "      capabilities:\n".len();
                s.truncate(trim_end);
            }
        }
        if let Some(note) = &m.note {
            if !note.is_empty() {
                s.push_str(&format!("      note: \"{}\"\n", note.replace('"', "\\\"")));
            }
        }
    }
    s
}

fn replace_or_insert(raw: &str, new_block: &str) -> String {
    // Strategy: find "  enabled:" with 2-space indent; replace the contiguous
    // block until the next top-level key or EOF. If not present, insert a
    // "models:\n  enabled: <block>" pair right after `default_provider:` line.
    if let Some(start) = raw.find("  enabled:") {
        // ensure it is preceded by "models:" (2-space indent)
        let before = &raw[..start];
        if before.ends_with("models:\n") || before.trim_end().ends_with("models:") {
            // find end: next line whose leftmost non-space is at 0 indent (top-level key)
            let after_start = start;
            #[allow(unused_assignments)]
            let mut end: Option<usize> = None;
            for (i, line) in raw[after_start..].lines().enumerate() {
                if i == 0 { continue; }
                if !line.is_empty() && !line.starts_with(' ') && !line.starts_with('\t') {
                    end = Some(after_start + i);
                    // back up to start of this line
                    let mut cut = end.expect("end is set on this branch");
                    while cut > 0 && &raw[cut..cut + 1] != "\n" { cut -= 1; }
                    if cut > 0 { cut += 1; }
                    return format!("{}{}{}", before, new_block.trim_end(), &raw[cut..]);
                }
            }
            return format!("{}{}", before, new_block.trim_end());
        }
    }
    // No `models.enabled` block; insert after `default_provider:` line.
    if let Some(idx) = raw.find("default_provider:") {
        let nl = raw[idx..].find('\n').unwrap_or(0) + idx + 1;
        return format!("{}models:\n{}\n{}", &raw[..nl], new_block, &raw[nl..]);
    }
    // No anchor; append at the end.
    format!("{}models:\n{}", raw, new_block)
}
