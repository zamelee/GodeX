// Standalone test for probe.rs
// Run: cargo run --release --example test_probe
// Usage:
//   test_probe [base_url] [key] [ctx_claim] [max_claim] [what] [model_filter]
//   what = all | ctx | max | caps | video
//   model_filter = all | MiniMax-M2.7 | MiniMax-M2.7-highspeed | MiniMax-M3
//
// Examples (saving API calls):
//   test_probe https://minnimax.chat/v1 <key> 100000 131072 caps MiniMax-M3
//   test_probe https://minnimax.chat/v1 <key> 100000 131072 ctx MiniMax-M3
//   test_probe https://minnimax.chat/v1 <key> 100000 131072 video MiniMax-M2.7

use std::env;
use std::fs;

fn read_key() -> String {
    let p = r"D:\Documents\VibeCoding\GodeX\tools\.probe_key.txt";
    fs::read_to_string(p).unwrap_or_else(|_| String::new()).trim().to_string()
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let base_url = args.get(1).cloned().filter(|s| !s.is_empty()).unwrap_or_else(|| "https://minnimax.chat/v1".to_string());
    let api_key = args.get(2).cloned().filter(|s| !s.is_empty()).unwrap_or_else(read_key);
    let claimed_ctx: u64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(100_000);
    let claimed_max: u64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(131_072);
    let what = args.get(5).map(|s| s.as_str()).unwrap_or("all");
    let model_filter = args.get(6).map(|s| s.as_str()).unwrap_or("all");
    let all_models = ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M3"];
    let models: Vec<&str> = if model_filter == "all" {
        all_models.to_vec()
    } else {
        all_models.iter().copied().filter(|m| *m == model_filter).collect()
    };

    println!("=== test_probe ===");
    println!("BASE: {}", base_url);
    println!("WHAT: {}", what);
    println!("MODELS: {:?}", models);
    println!();

    let do_ctx = what == "all" || what == "ctx";
    let do_max = what == "all" || what == "max";
    let do_caps = what == "all" || what == "caps" || what == "video";

    let mut all_results: Vec<(String, Option<u64>, Option<u64>, Option<godex_studio_lib::probe::Capabilities>)> = Vec::new();

    for m in &models {
        println!("--- {} ---", m);
        let mut client = match godex_studio_lib::probe::ProbeClient::new(&base_url, &api_key, m) {
            Ok(c) => c,
            Err(e) => { println!("  client error: {}", e); continue; }
        };

        let mut ctx_result: Option<u64> = None;
        let mut max_result: Option<u64> = None;
        let mut caps_result: Option<godex_studio_lib::probe::Capabilities> = None;

        if do_ctx {
            ctx_result = client.probe_ctx(claimed_ctx);
            for ev in client.take_events() { print_event(&ev); }
            println!("  -> ctx = {:?}", ctx_result);
        }

        if do_max {
            max_result = client.probe_max_tokens(claimed_max);
            for ev in client.take_events() { print_event(&ev); }
            println!("  -> max_tokens = {:?}", max_result);
        }

        if do_caps {
            caps_result = Some(client.probe_caps());
            for ev in client.take_events() { print_event(&ev); }
            if what == "video" {
                let c = caps_result.as_ref().unwrap();
                println!("  -> video = {:?}", c.video);
            }
        }

        all_results.push((m.to_string(), ctx_result, max_result, caps_result));
    }

    if (do_caps && what == "all") || what == "caps" {
        println!();
        println!("=== caps summary ===");
        println!("{:<22} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5}",
            "model", "text", "image", "audio", "video", "func", "reas", "web", "file", "cpu", "tool", "mcp");
        for (m, _, _, c) in &all_results {
            if let Some(cap) = c {
                let b = |x: &Option<bool>| -> String {
                    match x { Some(true) => "YES".to_string(), Some(false) => "no".to_string(), None => "?".to_string() }
                };
                println!("{:<22} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5} {:>5}",
                    m,
                    b(&cap.text), b(&cap.image), b(&cap.audio), b(&cap.video),
                    b(&cap.function), b(&cap.reasoning), b(&cap.web_search),
                    b(&cap.file_search), b(&cap.computer_use), b(&cap.tool_search), b(&cap.mcp));
            }
        }
    }
}

fn print_event(ev: &godex_studio_lib::probe::ProbeEvent) {
    let detail = ev.detail.clone().unwrap_or_default();
    println!("  [{}] {} {}", ev.stage, ev.status, detail);
}
