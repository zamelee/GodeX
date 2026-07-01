// Quick test: read current godex.yaml and dump what read_providers returns.
use std::path::Path;
fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| r"D:\Documents\VibeCoding\GodeX\godex.yaml".to_string());
    let p = Path::new(&path);
    // Inline a copy of read_providers here so we don't have to expose the helper.
    let raw = match std::fs::read_to_string(p) { Ok(s) => s, Err(e) => { println!("read fail: {}", e); return; } };
    println!("file: {}", path);
    println!("size: {} bytes, lines: {}", raw.len(), raw.lines().count());
    println!("---");
    let mut providers: Vec<(String, String, String, String, u64)> = Vec::new();
    let mut in_providers = false;
    let mut current: Option<(String, String, String, String, u64)> = None;
    for line in raw.lines() {
        if line.starts_with("providers:") { in_providers = true; println!("[enter providers]"); continue; }
        if !line.is_empty() && !line.starts_with(' ') && !line.starts_with('\t') {
            in_providers = false;
            if !line.starts_with("providers:") { println!("[exit providers at: {}]", line); }
            continue;
        }
        if !in_providers { continue; }
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
        if indent == 2 && !trimmed.is_empty() && !trimmed.starts_with('#') {
            if let Some(prev) = current.take() { providers.push(prev); }
            let name = trimmed.trim_end_matches(':').to_string();
            println!("[provider name indent=2] {}", name);
            current = Some((name, String::new(), String::new(), String::new(), 120000));
            continue;
        }
        if let Some(p) = current.as_mut() {
            if let Some(rest) = trimmed.strip_prefix("spec:") { p.1 = rest.trim().to_string(); println!("  spec={}", rest.trim()); }
            else if let Some(rest) = trimmed.strip_prefix("base_url:") { p.2 = rest.trim().to_string(); println!("  base_url={}", rest.trim()); }
            else if let Some(rest) = trimmed.strip_prefix("api_key:") { p.3 = rest.trim().to_string(); println!("  api_key={}", &rest.trim()[..rest.trim().len().min(8)]); }
            else if let Some(rest) = trimmed.strip_prefix("timeout_ms:") { p.4 = rest.trim().parse().unwrap_or(120000); println!("  timeout_ms={}", rest.trim()); }
        }
    }
    if let Some(prev) = current.take() { providers.push(prev); }
    println!("---");
    println!("TOTAL providers: {}", providers.len());
    for (name, spec, base, key, to) in &providers {
        println!("  name={} spec={} base_url={} key={}... timeout_ms={}", name, spec, base, &key[..key.len().min(8)], to);
    }
}