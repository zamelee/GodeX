// Standalone test for probe.rs - mirrors the Python verify_fixtures.py gold standard.
// Run: cargo run --release --example test_probe

use std::env;
use std::fs;

fn read_key() -> String {
    let p = r"D:\Documents\VibeCoding\GodeX\tools\.probe_key.txt";
    fs::read_to_string(p).unwrap_or_else(|_| String::new()).trim().to_string()
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let base_url = args.get(1).cloned().unwrap_or_else(|| "https://minnimax.chat/v1".to_string());
    let api_key = args.get(2).cloned().unwrap_or_else(read_key);
    let claimed_ctx: u64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(100_000);
    let claimed_max: u64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(131_072);
    let models = ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M3"];

    println!("=== test_probe: standalone probe.rs validation ===");
    println!("BASE: {}", base_url);
    println!("KEY_LEN: {}", api_key.len());
    println!("CLAIMED_CTX: {}", claimed_ctx);
    println!("CLAIMED_MAX: {}", claimed_max);
    println!();

    let mut all_caps: Vec<(String, godex_studio_lib::probe::Capabilities)> = Vec::new();

    for m in models {
        println!();
        println!("--- {} ---", m);
        let mut client = match godex_studio_lib::probe::ProbeClient::new(&base_url, &api_key, m) {
            Ok(c) => c,
            Err(e) => { println!("  client error: {}", e); continue; }
        };

        let ctx = client.probe_ctx(claimed_ctx);
        for ev in client.take_events() { print_event(&ev); }
        println!("  -> ctx = {:?}", ctx);

        let mt = client.probe_max_tokens(claimed_max);
        for ev in client.take_events() { print_event(&ev); }
        println!("  -> max_tokens = {:?}", mt);

        let caps = client.probe_caps();
        for ev in client.take_events() { print_event(&ev); }
        all_caps.push((m.to_string(), caps));
    }

    println!();
    println!("=== summary ===");
    println!("{:<22} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5}",
        "model", "text", "image", "audio", "video", "func", "reas", "web", "file", "cpu", "tool", "mcp");
    for (m, c) in &all_caps {
        let b = |x: &Option<bool>| -> String {
            match x { Some(true) => "YES".to_string(), Some(false) => "no".to_string(), None => "?".to_string() }
        };
        println!("{:<22} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5}",
            m,
            b(&c.text), b(&c.image), b(&c.audio), b(&c.video),
            b(&c.function), b(&c.reasoning), b(&c.web_search),
            b(&c.file_search), b(&c.computer_use), b(&c.tool_search), b(&c.mcp));
    }
}

fn print_event(ev: &godex_studio_lib::probe::ProbeEvent) {
    let detail = ev.detail.clone().unwrap_or_default();
    println!("  [{}] {} {}", ev.stage, ev.status, detail);
}

