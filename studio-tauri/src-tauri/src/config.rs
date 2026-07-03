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
    pub id: Option<String>,
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
    /// Safety margin ratio (0.0-1.0). Default 0.95 (95%).
    /// Applied to context_window and max_tokens when computing effective limits.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub margin: Option<f64>,
    /// Reasoning effort: "none" | "enabled" | "max". None = no reasoning field emitted.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reasoning: Option<String>,
    /// Raw context_window value measured by model-probe, before margin multiplication.
    /// Read from the # probe_raw: yaml comment line; never re-emitted by the user
    /// (model-probe is the sole writer). Preserved across save round-trips.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub probe_raw: Option<u64>,
    /// ISO-8601 UTC timestamp of the most recent successful probe.
    /// Read from the # probed_at: yaml comment line; same persistence rules as probe_raw.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub probed_at: Option<String>,
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
        // Any other top-level key (e.g. "models:", "default_provider:")
        // exits the providers: block.
        if !line.is_empty() && !line.starts_with(' ') && !line.starts_with('\t') {
            in_providers = false;
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


/// Attach pending capabilities to a model that does not yet have them set.
/// Returns the model with capabilities filled in if pending caps exist.
fn attach_capabilities(model: &mut EnabledModel, pending: &mut Option<ModelCapabilities>) {
    if model.capabilities.is_none() {
        if let Some(caps) = pending.take() {
            model.capabilities = Some(caps);
        }
    }
}

/// Start a new enabled/discovered entry with fresh `current` and `current_caps` state.
fn start_enabled_entry(
    current: &mut Option<EnabledModel>,
    current_caps: &mut Option<ModelCapabilities>,
    provider: String,
) {
    *current = Some(EnabledModel {
        provider,
        model: String::new(),
        id: None,
        context_window: None,
        max_tokens: None,
        multimodal: None,
        capabilities: None,
        note: None,
        margin: None,
        reasoning: None,
        probe_raw: None,
        probed_at: None,
    });
    *current_caps = Some(ModelCapabilities::default());
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
    let mut current_caps: Option<ModelCapabilities> = None;
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
            if let Some(mut prev) = current.take() {
                attach_capabilities(&mut prev, &mut current_caps);
                out.push(prev);
            }
            start_enabled_entry(&mut current, &mut current_caps, rest.trim().to_string());
            continue;
        }
        if let Some(p) = current.as_mut() {
            if let Some(rest) = trimmed.strip_prefix("model:") {
                p.model = rest.trim().to_string();
            } else if let Some(rest) = trimmed.strip_prefix("id:") {
                let v = rest.trim();
                p.id = Some(v.trim_matches('"').to_string());
            } else if let Some(rest) = trimmed.strip_prefix("context_window:") {
                p.context_window = rest.trim().parse().ok();
            } else if let Some(rest) = trimmed.strip_prefix("max_tokens:") {
                p.max_tokens = rest.trim().parse().ok();
            } else if let Some(rest) = trimmed.strip_prefix("margin:") {
                p.margin = rest.trim().parse().ok();
            } else if let Some(rest) = trimmed.strip_prefix("reasoning:") {
                let v = rest.trim().trim_matches('"').to_string();
                p.reasoning = if v.is_empty() { None } else { Some(v) };
            } else if let Some(rest) = trimmed.strip_prefix("multimodal:") {
                p.multimodal = Some(rest.trim() == "true");
            } else if let Some(rest) = trimmed.strip_prefix("note:") {
                let v = rest.trim();
                p.note = Some(v.trim_matches('"').to_string());
            } else if line.starts_with("      capabilities:") {
                // Entering capabilities sub-block; current_caps already initialized.
                continue;
            } else if let Some(rest) = trimmed.strip_prefix("#") {
                let comment = rest.trim();
                if let Some(v) = comment.strip_prefix("probe_raw:") {
                    p.probe_raw = v.trim().parse().ok();
                } else if let Some(v) = comment.strip_prefix("probed_at:") {
                    p.probed_at = Some(v.trim().to_string());
                }
            } else if line.starts_with("        ") && line.len() > 8 {
                // Capability child line (8-space indent), e.g. "        text: true"
                if let Some(eq) = trimmed.find(':') {
                    let key = trimmed[..eq].trim();
                    let val = trimmed[eq+1..].trim() == "true";
                    if let Some(c) = current_caps.as_mut() {
                        match key {
                            "text" => c.text = Some(val),
                            "image_input" => c.image_input = Some(val),
                            "audio_input" => c.audio_input = Some(val),
                            "video_input" => c.video_input = Some(val),
                            "image_output" => c.image_output = Some(val),
                            "audio_output" => c.audio_output = Some(val),
                            "tool_use" => c.tool_use = Some(val),
                            "stream" => c.stream = Some(val),
                            _ => {}
                        }
                    }
                }
            }
        }
    }
    if let Some(mut prev) = current.take() {
        attach_capabilities(&mut prev, &mut current_caps);
        out.push(prev);
    }
    out
}

pub fn read_discovered_models(path: &Path) -> Vec<EnabledModel> {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<EnabledModel> = Vec::new();
    let mut in_models = false;
    let mut in_discovered = false;
    let mut current: Option<EnabledModel> = None;
    let mut current_caps: Option<ModelCapabilities> = None;
    for line in raw.lines() {
        let trimmed = line.trim_start();
        if line.starts_with("models:") {
            in_models = true;
            continue;
        }
        if in_models && !in_discovered && trimmed.starts_with("discovered:") {
            in_discovered = true;
            continue;
        }
        if !in_discovered {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("- provider:") {
            if let Some(mut prev) = current.take() {
                attach_capabilities(&mut prev, &mut current_caps);
                out.push(prev);
            }
            start_enabled_entry(&mut current, &mut current_caps, rest.trim().to_string());
            continue;
        }
        if let Some(p) = current.as_mut() {
            if let Some(rest) = trimmed.strip_prefix("model:") {
                p.model = rest.trim().to_string();
            } else if let Some(rest) = trimmed.strip_prefix("id:") {
                let v = rest.trim();
                p.id = Some(v.trim_matches('"').to_string());
            } else if let Some(rest) = trimmed.strip_prefix("context_window:") {
                p.context_window = rest.trim().parse().ok();
            } else if let Some(rest) = trimmed.strip_prefix("max_tokens:") {
                p.max_tokens = rest.trim().parse().ok();
            } else if let Some(rest) = trimmed.strip_prefix("margin:") {
                p.margin = rest.trim().parse().ok();
            } else if let Some(rest) = trimmed.strip_prefix("reasoning:") {
                let v = rest.trim().trim_matches('"').to_string();
                p.reasoning = if v.is_empty() { None } else { Some(v) };
            } else if let Some(rest) = trimmed.strip_prefix("multimodal:") {
                p.multimodal = Some(rest.trim() == "true");
            } else if let Some(rest) = trimmed.strip_prefix("note:") {
                let v = rest.trim();
                p.note = Some(v.trim_matches('"').to_string());
            } else if line.starts_with("      capabilities:") {
                // Entering capabilities sub-block; current_caps already initialized.
                continue;
            } else if let Some(rest) = trimmed.strip_prefix("#") {
                let comment = rest.trim();
                if let Some(v) = comment.strip_prefix("probe_raw:") {
                    p.probe_raw = v.trim().parse().ok();
                } else if let Some(v) = comment.strip_prefix("probed_at:") {
                    p.probed_at = Some(v.trim().to_string());
                }
            } else if line.starts_with("        ") && line.len() > 8 {
                // Capability child line (8-space indent), e.g. "        text: true"
                if let Some(eq) = trimmed.find(':') {
                    let key = trimmed[..eq].trim();
                    let val = trimmed[eq+1..].trim() == "true";
                    if let Some(c) = current_caps.as_mut() {
                        match key {
                            "text" => c.text = Some(val),
                            "image_input" => c.image_input = Some(val),
                            "audio_input" => c.audio_input = Some(val),
                            "video_input" => c.video_input = Some(val),
                            "image_output" => c.image_output = Some(val),
                            "audio_output" => c.audio_output = Some(val),
                            "tool_use" => c.tool_use = Some(val),
                            "stream" => c.stream = Some(val),
                            _ => {}
                        }
                    }
                }
            }
        }
    }
    if let Some(mut prev) = current.take() {
        attach_capabilities(&mut prev, &mut current_caps);
        out.push(prev);
    }
    out
}

pub fn save_enabled_models(
    path: &Path,
    enabled: &[EnabledModel],
    discovered: &[EnabledModel],
) -> Result<(), String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read config failed: {}", e))?;
    crate::diag(&format!("[splice] RAW ({}b):\n{}", raw.len(), raw));
    let new_block = format!(
        "{}{}",
        render_enabled_block(enabled),
        render_discovered_block(discovered)
    );
    crate::diag(&format!("[splice] BLOCK ({}b):\n{}", new_block.len(), new_block));
    let updated = replace_or_insert(&raw, &new_block);
    crate::diag(&format!("[splice] UPDATED ({}b):\n{}", updated.len(), updated));
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
        if let Some(id) = &m.id {
            if !id.is_empty() {
                s.push_str(&format!("      id: \"{}\"\n", id.replace('"', "\\\"")));
            }
        }
        if let Some(cw) = m.context_window {
            s.push_str(&format!("      context_window: {}\n", cw));
        }
        if let Some(mt) = m.max_tokens {
            s.push_str(&format!("      max_tokens: {}\n", mt));
        }
        if let Some(mg) = m.margin {
            if (0.0..=1.0).contains(&mg) {
                s.push_str(&format!("      margin: {:.2}\n", mg));
            }
        }
        if let Some(rs) = &m.reasoning {
            if !rs.is_empty() {
                s.push_str(&format!("      reasoning: \"{}\"\n", rs.replace('"', "\\\"")));
            }
        }
        if let Some(pr) = m.probe_raw {
            s.push_str(&format!("      # probe_raw: {}\n", pr));
        }
        if let Some(pa) = &m.probed_at {
            if !pa.is_empty() {
                s.push_str(&format!("      # probed_at: {}\n", pa));
            }
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

fn render_discovered_block(items: &[EnabledModel]) -> String {
    if items.is_empty() {
        return "  discovered: []\n".to_string();
    }
    let mut s = String::from("  discovered:\n");
    for m in items {
        s.push_str(&format!("    - provider: {}\n", m.provider));
        s.push_str(&format!("      model: {}\n", m.model));
        if let Some(id) = &m.id {
            if !id.is_empty() {
                s.push_str(&format!("      id: \"{}\"\n", id.replace('"', "\\\"")));
            }
        }
        if let Some(cw) = m.context_window {
            s.push_str(&format!("      context_window: {}\n", cw));
        }
        if let Some(mt) = m.max_tokens {
            s.push_str(&format!("      max_tokens: {}\n", mt));
        }
        if let Some(mg) = m.margin {
            if (0.0..=1.0).contains(&mg) {
                s.push_str(&format!("      margin: {:.2}\n", mg));
            }
        }
        if let Some(rs) = &m.reasoning {
            if !rs.is_empty() {
                s.push_str(&format!("      reasoning: \"{}\"\n", rs.replace('"', "\\\"")));
            }
        }
        if let Some(pr) = m.probe_raw {
            s.push_str(&format!("      # probe_raw: {}\n", pr));
        }
        if let Some(pa) = &m.probed_at {
            if !pa.is_empty() {
                s.push_str(&format!("      # probed_at: {}\n", pa));
            }
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

// Locate the "models:" top-level line and its 2-space-indented
// "enabled:" header. Returns (header_byte_offset, body_byte_offset)
// where body_byte_offset points just past the newline of the "enabled:"
// line (or to EOF if the header is the last line).
// Locate the top-level models: block. Returns the byte range
// [start, end) covering the entire block (including the models: line
// itself and the trailing newline of its last line). Tolerant of CRLF
// (`r`n) and LF (`n`) line endings
// because Windows tools routinely save YAML with CRLF.
fn find_models_block(raw: &str) -> Option<(usize, usize)> {
    let bytes = raw.as_bytes();
    let models_idx = raw.find("\nmodels:")
        .map(|i| i + 1)
        .or_else(|| if raw.starts_with("models:") { Some(0) } else { None })?;
    let after_models = models_idx + "models:".len();
    if after_models < bytes.len() && bytes[after_models] != b'\n' && bytes[after_models] != b'\r' {
        return None;
    }
    // Skip past the models: line terminator. CRLF uses 2 bytes, LF uses 1.
    let mut cursor = after_models
        + if after_models < bytes.len() && bytes[after_models] == b'\r' { 2 } else { 1 };
    while cursor < bytes.len() {
        let line_end_rel = raw[cursor..].find('\n');
        let line_end = cursor + line_end_rel.unwrap_or(bytes.len() - cursor);
        let line_str = &raw[cursor..line_end];
        let current_line = line_str.strip_suffix("\r").unwrap_or(line_str);
        if !current_line.is_empty() {
            let trimmed = current_line.trim_start();
            let indent = current_line.len() - trimmed.len();
            if indent == 0 {
                return Some((models_idx, cursor));
            }
        }
        cursor = if line_end_rel.is_some() { line_end + 1 } else { bytes.len() };
    }
    Some((models_idx, cursor))
}

fn replace_or_insert(raw: &str, new_block: &str) -> String {
    let new_payload = format!("models:\n{}\n", new_block.trim_end());
    if let Some((start, end)) = find_models_block(raw) {
        // Keep the newline that precedes models: so the replacement
        // doesn't glue the previous top-level key onto models:.
        let prefix_end = if start > 0 && (raw.as_bytes()[start - 1] == b'\n' || raw.as_bytes()[start - 1] == b'\r') {
            start
        } else {
            start
        };
        let suffix = &raw[end..];
        return format!("{}{}{}", &raw[..prefix_end], new_payload, suffix);
    }
    // No models: block yet; insert after default_provider: line.
    let bytes = raw.as_bytes();
    if let Some(idx) = raw.find("default_provider:") {
        let nl = raw[idx..].find('\n')
            .map(|i| idx + i + 1)
            .unwrap_or(raw.len());
        let cut = if nl > 0 && bytes[bytes.len().min(nl) - 1] == b'\n' { nl } else { idx + "default_provider:".len() };
        return format!("{}{}\n{}", &raw[..cut], new_payload.trim_end_matches('\n'), &raw[cut..]);
    }
    // No anchor; prepend.
    format!("{}\n{}", new_payload.trim_end_matches('\n'), raw)
}
#[cfg(test)]
mod tests {
    use super::*;

    fn clean_raw() -> &'static str {
        r##"server:
  port: 5678
  host: 127.0.0.1
default_provider: minnimax
providers:
  minnimax:
    spec: minimax
    credentials:
      api_key: gw-x
    endpoint:
      base_url: https://minnimax.chat/v1
    timeout_ms: 120000
models:
  enabled: []
"##
    }

    fn corrupted_raw() -> &'static str {
        r##"server:
  port: 5678
  host: 127.0.0.1
default_provider: minnimax
providers:  minnimax:
    spec: minimax
    credentials:
      api_key: gw-x
    endpoint:
      base_url: https://minnimax.chat/v1
    timeout_ms: 120000
    spec: minimax
    credentials:
      api_key: gw-x
    endpoint:
      base_url: https://minnimax.chat/v1
    timeout_ms: 120000
models:
  enabled: []
"##
    }

    fn no_models_raw() -> &'static str {
        r##"server:
  port: 5678
  host: 127.0.0.1
default_provider: minnimax
providers:
  minnimax:
    spec: minimax
"##
    }

    fn existing_models_raw() -> &'static str {
        r##"server:
  port: 5678
default_provider: x
models:
  enabled:
    - provider: a
      model: b
"##
    }

    fn sample_items() -> Vec<EnabledModel> {
        vec![EnabledModel {
            provider: "minnimax".to_string(),
            model: "MiniMax-M3".to_string(),
            id: None,
            context_window: Some(1000000),
            max_tokens: Some(16384),
            multimodal: None,
            capabilities: None,
            note: None,
            margin: None,
            reasoning: None,
            probe_raw: None,
            probed_at: None,
        }]
    }

    #[test]
    fn replace_block_in_clean_config_keeps_providers_intact() {
        let raw = clean_raw();
        let block = render_enabled_block(&sample_items());
        let updated = replace_or_insert(raw, &block);
        assert!(updated.contains("providers:\n  minnimax:\n"), "providers block missing in:\n{}", updated);
        assert!(updated.contains("    spec: minimax"));
        assert!(updated.contains("      api_key: gw-x"));
        assert!(updated.contains("      base_url: https://minnimax.chat/v1"));
        assert!(updated.contains("    timeout_ms: 120000"));
        assert!(updated.contains("- provider: minnimax"));
        assert!(updated.contains("      model: MiniMax-M3"));
        assert!(updated.contains("      context_window: 1000000"));
        assert!(updated.contains("      max_tokens: 16384"));
        for line in updated.lines() {
            let trimmed = line.trim_start();
            let count = line.matches(": ").count();
            let is_list_item = trimmed.starts_with("- ");
            assert!(count <= 1 || is_list_item, "merged line: {:?} in:\n{}", line, updated);
        }
    }

    #[test]
    fn replace_block_in_corrupted_config_recovers_cleanly() {
        let raw = corrupted_raw();
        let block = render_enabled_block(&sample_items());
        let updated = replace_or_insert(raw, &block);
        for line in updated.lines() {
            let trimmed = line.trim_start();
            if trimmed.starts_with("stream:") || trimmed.starts_with("max_tokens:") {
                assert!(
                    !line.contains("  model:")
                        && !line.contains("  provider:")
                        && !line.contains("  context_window:"),
                    "still merged: {:?} in:\n{}",
                    line,
                    updated,
                );
            }
        }
    }

    #[test]
    fn replace_block_when_no_models_section_inserts_after_default_provider() {
        let raw = no_models_raw();
        let block = render_enabled_block(&sample_items());
        let updated = replace_or_insert(raw, &block);
        let models_idx = updated.find("\nmodels:").expect("models: should be inserted");
        let default_idx = updated.find("default_provider:").expect("default_provider still present");
        assert!(models_idx > default_idx);
        assert!(updated.contains("- provider: minnimax"));
        assert!(updated.contains("      model: MiniMax-M3"));
    }

    #[test]
    fn empty_items_renders_empty_block() {
        let block = render_enabled_block(&[]);
        assert_eq!(block, "  enabled: []\n");
        let raw = existing_models_raw();
        let updated = replace_or_insert(raw, &block);
        assert!(updated.contains("  enabled: []"));
        assert!(!updated.contains("- provider: a"));
    }

    #[test]
    fn rendered_block_is_well_formed_yaml_for_all_caps() {
        let item = EnabledModel {
            provider: "minnimax".to_string(),
            model: "MiniMax-M3".to_string(),
            id: None,
            context_window: Some(1000000),
            max_tokens: Some(16384),
            multimodal: Some(true),
            capabilities: Some(ModelCapabilities {
                text: Some(true),
                image_input: Some(true),
                audio_input: Some(true),
                video_input: None,
                image_output: None,
                audio_output: None,
                tool_use: Some(true),
                stream: Some(true),
            }),
            note: Some("hello".to_string()),
            margin: None,
            reasoning: None,
            probe_raw: None,
            probed_at: None,
        };
        let block = render_enabled_block(&[item]);
        assert!(block.contains("- provider: minnimax\n"));
        assert!(block.contains("      model: MiniMax-M3\n"));
        assert!(block.contains("      context_window: 1000000\n"));
        assert!(block.contains("      max_tokens: 16384\n"));
        assert!(block.contains("      multimodal: true\n"));
        assert!(block.contains("      capabilities:\n"));
        assert!(block.contains("        text: true\n"));
        assert!(block.contains("        image_input: true\n"));
        assert!(block.contains("        audio_input: true\n"));
        assert!(block.contains("        tool_use: true\n"));
        assert!(block.contains("        stream: true\n"));
        assert!(!block.contains("video_input:"));
        assert!(!block.contains("image_output:"));
        assert!(block.contains("      note: \"hello\"\n"));
    }

    fn double_enabled_raw() -> &'static str {
        r##"server:
  port: 5678
  host: 127.0.0.1
default_provider: minnimax
providers:
  minnimax:
    spec: minimax
    credentials:
      api_key: gw-x
    endpoint:
      base_url: https://minnimax.chat/v1
    timeout_ms: 120000
models:
  enabled: []
  enabled:
    - provider: minnimax
      model: MiniMax-M3
      context_window: 1000000
      max_tokens: 16384
"##
    }

    #[test]
    fn replace_block_when_old_empty_enabled_line_is_present() {
        // Reproduces the real-world corruption pattern: file has both
        // `  enabled: []` on its own line AND a second `  enabled:`
        // block underneath (left over from a previous buggy save).
        let raw = double_enabled_raw();
        let block = render_enabled_block(&sample_items());
        let updated = replace_or_insert(raw, &block);
        // The new block should be present.
        assert!(updated.contains("- provider: minnimax"));
        assert!(updated.contains("      model: MiniMax-M3"));
        assert!(updated.contains("      context_window: 1000000"));
        // No leftover `  enabled: []` orphan line.
        assert!(
            !updated.contains("  enabled: []"),
            "leftover `enabled: []` in output:\n{}",
            updated
        );
        // Providers block still intact.
        assert!(updated.contains("providers:\n  minnimax:"));
        assert!(updated.contains("      api_key: gw-x"));
        // Exactly one `  enabled:` header line at indent 2.
        let header_count = updated
            .lines()
            .filter(|l| l.trim_start() == "enabled:" && l.starts_with("  enabled:"))
            .count();
        assert_eq!(header_count, 1, "expected one enabled: header in:\n{}", updated);
    }
    #[test]
    fn debug_crlf_backup_replaces_models_block() {
        // User backup uses CRLF line endings. Previous splice only
        // handled LF and silently fell through to the
        // default_provider insert path, producing two
        // top-level models: keys and breaking godex.
        let raw = "server:\r\n  port: 5678\r\ndefault_provider: minimax\r\nproviders:\r\n  minimax:\r\n    spec: minimax\r\n    credentials:\r\n      api_key: gw-x\r\n    endpoint:\r\n      base_url: https://minnimax.chat/v1\r\nmodels:\r\n  aliases:\r\n    '*': minimax/MiniMax-M3\r\nsession:\r\n  backend: sqlite\r\n";        let items = vec![EnabledModel {
            provider: "minimax".to_string(),
            model: "MiniMax-M3".to_string(),
            id: None,
            context_window: Some(1000000),
            max_tokens: Some(16384),
            multimodal: None,
            capabilities: None,
            note: None,
            margin: None,
            reasoning: None,
            probe_raw: None,
            probed_at: None,
        }];
        let block = render_enabled_block(&items);
        let updated = replace_or_insert(raw, &block);
        let mut top_models = 0;
        for line in updated.lines() {
            if line == "models:" { top_models += 1; }
        }
        assert_eq!(top_models, 1, "CRLF input must produce exactly one top-level models:, got:\n{}", updated);
        assert!(!updated.contains("aliases:"), "old aliases: should be gone, got:\n{}", updated);
        assert!(updated.contains("enabled:"), "new enabled: block should be present");
    }

    /// Round-trip: yaml with # probe_raw / # probed_at comments, plus a reasoning line,
    /// must be readable as EnabledModel fields and re-emittable by render_enabled_block.
    #[test]
    fn round_trip_preserves_probe_metadata_and_reasoning() {
        let dir = std::env::temp_dir().join("godex_studio_round_trip");
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("config.yaml");
        let raw = "server:\n  port: 5678\ndefault_provider: minimax\nproviders:\n  minimax:\n    spec: minimax\nmodels:\n  enabled:\n    - provider: minimax\n      model: MiniMax-M3\n      context_window: 1235000\n      # probe_raw: 1300000\n      # probed_at: 2026-06-27T10:00:00Z\n      # probe_method: chat_completions\n      margin: 0.95\n      reasoning: \"max\"\n";
        std::fs::write(&p, raw).unwrap();
        let models = read_enabled_models(&p);
        assert_eq!(models.len(), 1);
        let m = &models[0];
        assert_eq!(m.model, "MiniMax-M3");
        assert_eq!(m.context_window, Some(1235000));
        assert_eq!(m.probe_raw, Some(1300000), "probe_raw comment not parsed");
        assert_eq!(m.probed_at.as_deref(), Some("2026-06-27T10:00:00Z"), "probed_at comment not parsed");
        assert_eq!(m.reasoning.as_deref(), Some("max"), "reasoning field not parsed");
        // Re-emit and check that probe_raw + probed_at + reasoning come back out.
        let out = render_enabled_block(&models);
        assert!(out.contains("      reasoning: \"max\""), "reasoning missing in re-emit:\n{}", out);
        assert!(out.contains("      # probe_raw: 1300000"), "probe_raw missing in re-emit:\n{}", out);
        assert!(out.contains("      # probed_at: 2026-06-27T10:00:00Z"), "probed_at missing in re-emit:\n{}", out);
        let _ = std::fs::remove_file(&p);
    }

    /// Regression: consecutive `- provider:` entries with capabilities blocks
    /// must all be parsed, not just the first and last. The previous bug used
    /// `continue` after pushing a model, which skipped re-initializing
    /// `current` and silently dropped the next entry.
    #[test]
    fn reads_all_consecutive_enabled_models_with_capabilities() {
        let dir = std::env::temp_dir().join("godex_studio_read_enabled_regression");
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("config.yaml");
        let raw = "\
server:
  port: 5678
default_provider: minnimax.chat
providers:
  minnimax.chat:
    spec: minimax
models:
  enabled:
    - provider: minnimax.chat
      model: MiniMax-M2.7
      context_window: 204800
      max_tokens: 131072
      capabilities:
        text: true
        image_input: true
        tool_use: true
        stream: true
    - provider: minnimax.chat
      model: MiniMax-M2.7-highspeed
      context_window: 204800
      max_tokens: 16384
      capabilities:
        text: true
        image_input: true
        tool_use: true
        stream: true
    - provider: minnimax.chat
      model: MiniMax-M3
      context_window: 1000000
      max_tokens: 16384
      capabilities:
        text: true
        image_input: true
        audio_input: true
        tool_use: true
        stream: true
";
        std::fs::write(&p, raw).unwrap();
        let models = read_enabled_models(&p);
        assert_eq!(
            models.len(),
            3,
            "expected 3 enabled models, got {} (middle model dropped): {:?}",
            models.len(),
            models.iter().map(|m| m.model.as_str()).collect::<Vec<_>>()
        );
        let by_name: std::collections::HashMap<&str, &str> =
            models.iter().map(|m| (m.model.as_str(), m.provider.as_str())).collect();
        assert!(by_name.contains_key("MiniMax-M2.7"), "first model missing");
        assert!(
            by_name.contains_key("MiniMax-M2.7-highspeed"),
            "middle model was dropped - regression of the `- provider:` continue bug"
        );
        assert!(by_name.contains_key("MiniMax-M3"), "last model missing");

        // Capabilities on the middle model must be present (the bug dropped the whole entry).
        let mid = models.iter().find(|m| m.model == "MiniMax-M2.7-highspeed").unwrap();
        let caps = mid.capabilities.as_ref().expect("middle model has no capabilities");
        assert_eq!(caps.text, Some(true));
        assert_eq!(caps.image_input, Some(true));
        assert_eq!(caps.tool_use, Some(true));
        assert_eq!(caps.stream, Some(true));

        let _ = std::fs::remove_file(&p);
    }}


