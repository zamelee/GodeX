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

// Locate the "models:" top-level line and its 2-space-indented
// "enabled:" header. Returns (header_byte_offset, body_byte_offset)
// where body_byte_offset points just past the newline of the "enabled:"
// line (or to EOF if the header is the last line).
fn find_enabled_block(raw: &str) -> Option<(usize, usize)> {
    let bytes = raw.as_bytes();
    // Find a "models:" line at column 0.
    let models_idx = raw.find("\nmodels:").map(|i| i + 1)
        .or_else(|| if raw.starts_with("models:") { Some(0) } else { None })?;
    // Confirm models: is followed by newline or EOF (not a prefix).
    let after_models = models_idx + "models:".len();
    if after_models < bytes.len() && bytes[after_models] != b'\n' {
        return None;
    }
    // Now find "  enabled:" at 2-space indent anywhere after.
    let needle = "\n  enabled:";
    let rel = raw[after_models..].find(needle)?;
    let enabled_start = after_models + rel + 1; // skip leading '\n'
    // Skip past the "  enabled:" line itself.
    let after_enabled = raw[enabled_start..].find('\n')
        .map(|i| enabled_start + i + 1)
        .unwrap_or(bytes.len());
    Some((enabled_start, after_enabled))
}

fn replace_or_insert(raw: &str, new_block: &str) -> String {
    if let Some((enabled_start, body)) = find_enabled_block(raw) {
        // Find end of the block: next line whose leftmost non-space is at
        // column 0 (top-level key). The splice replaces from `enabled_start`
        // (start of "  enabled:" line) through the next top-level key (or
        // EOF), so any old "  enabled: []" header is removed cleanly even
        // when it appears on its own line.
        let bytes = raw.as_bytes();
        let mut cursor = body;
        while cursor < bytes.len() {
            let line_end_rel = raw[cursor..].find('\n');
            let line_end = cursor + line_end_rel.unwrap_or(bytes.len() - cursor);
            let line = &raw[cursor..line_end];
            if !line.is_empty() {
                let trimmed = line.trim_start();
                let indent = line.len() - trimmed.len();
                if indent == 0 {
                    // Cut from cursor (start of this top-level line) backwards
                    // to before its leading newline.
                    let mut cut = cursor;
                    if cut > 0 && bytes[cut - 1] == b'\n' { cut -= 1; }
                    return format!("{}{}{}", &raw[..enabled_start], new_block.trim_end(), &raw[cut..]);
                }
            }
            cursor = if line_end_rel.is_some() { line_end + 1 } else { bytes.len() };
        }
        // Block runs to EOF.
        return format!("{}{}", &raw[..enabled_start], new_block.trim_end());
    }
    // No `models.enabled` block; insert after `default_provider:` line.
    if let Some(idx) = raw.find("default_provider:") {
        let nl_rel = raw[idx..].find('\n').map(|i| i + 1).unwrap_or(raw.len() - idx);
        let nl = idx + nl_rel;
        let prefix = if nl > 0 && bytes_at(raw, nl - 1) == b'\n' { &raw[..nl] } else { &raw[..idx + "default_provider:".len()] };
        return format!("{}models:\n{}\n{}", prefix, new_block, &raw[nl..]);
    }
    // No anchor; append at the end.
    format!("{}models:\n{}", raw, new_block)
}

fn bytes_at(s: &str, i: usize) -> u8 {
    s.as_bytes().get(i).copied().unwrap_or(0)
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
            context_window: Some(1000000),
            max_tokens: Some(16384),
            multimodal: None,
            capabilities: None,
            note: None,
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
}
