// probe.rs - GodeX Studio model probe (3-command split)
// See handoff-draft.md for architecture decision.

use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, AUTHORIZATION, CONTENT_TYPE};
use serde::Serialize;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct ProbeEvent {
    pub stage: String,
    pub status: String,
    pub detail: Option<String>,
}

impl ProbeEvent {
    pub fn ok(stage: &str, detail: &str) -> Self {
        Self { stage: stage.to_string(), status: "ok".to_string(), detail: Some(detail.to_string()) }
    }
    pub fn fail(stage: &str, detail: &str) -> Self {
        Self { stage: stage.to_string(), status: "fail".to_string(), detail: Some(detail.to_string()) }
    }
    pub fn info(stage: &str, status: &str, detail: &str) -> Self {
        Self { stage: stage.to_string(), status: status.to_string(), detail: Some(detail.to_string()) }
    }
}


#[derive(Debug, Clone, Serialize, Default)]
pub struct Capabilities {
    pub text: Option<bool>,
    pub image: Option<bool>,
    pub audio: Option<bool>,
    pub video: Option<bool>,
    pub function: Option<bool>,
    pub reasoning: Option<bool>,
    pub web_search: Option<bool>,
    pub file_search: Option<bool>,
    pub computer_use: Option<bool>,
    pub tool_search: Option<bool>,
    pub mcp: Option<bool>,
}

pub struct ProbeClient {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub client: Client,
    pub events: Vec<ProbeEvent>,
}

impl ProbeClient {
    pub fn new(base_url: &str, api_key: &str, model: &str) -> Result<Self, String> {
        let client = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| format!("http client: {}", e))?;
        Ok(Self {
            base_url: base_url.trim_end_matches("/").to_string(),
            api_key: api_key.to_string(),
            model: model.to_string(),
            client,
            events: Vec::new(),
        })
    }

    fn headers(&self) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(AUTHORIZATION, format!("Bearer {}", self.api_key).parse().unwrap());
        h.insert(CONTENT_TYPE, "application/json".parse().unwrap());
        h
    }

    fn url(&self) -> String {
        format!("{}/chat/completions", self.base_url)
    }

    fn emit(&mut self, ev: ProbeEvent) {
        self.events.push(ev);
    }
}

test line 2


fn reply_text(body: &serde_json::Value) -> String {
    let msg = body.get("choices").and_then(|c| c.as_array()).and_then(|a| a.first()).and_then(|x| x.get("message")).cloned().unwrap_or(serde_json::Value::Null);
    let c = msg.get("content");
    if let Some(s) = c.and_then(|v| v.as_str()) { return s.to_string(); }
    if let Some(arr) = c.and_then(|v| v.as_array()) {
        return arr.iter().filter_map(|p| p.get("text").and_then(|t| t.as_str())).collect::<Vec<_>>().join(" ");
    }
    String::new()
}

fn usage_reasoning_tokens(body: &serde_json::Value) -> u64 {
    body.get("usage")
        .and_then(|u| u.get("completion_tokens_details"))
        .and_then(|d| d.get("reasoning_tokens"))
        .and_then(|t| t.as_u64())
        .unwrap_or(0)
}

fn has_tool_calls(body: &serde_json::Value) -> bool {
    body.get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|x| x.get("message"))
        .and_then(|m| m.get("tool_calls"))
        .map(|tc| !tc.as_array().map(|a| a.is_empty()).unwrap_or(true))
        .unwrap_or(false)
}


fn reply_contains_any(text: &str, kw_groups: &[&[&str]]) -> Option<&'static str> {
    let low = text.to_lowercase();
    for grp in kw_groups {
        for kw in grp.iter() {
            if low.contains(&kw.to_lowercase()) {
                return Some(kw);
            }
        }
    }
    None
}


// -------- embedded fixtures (from _b64_assets.rs) --------

// image_test.png b64 len: 2380
pub const IMAGE_B64: &str =
    "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"
    "m0ry4wAAAABJRU5ErkJggg=="
;

// audio_test.wav b64 len: 21392
pub const AUDIO_B64: &str =
    "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"
    "P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111Pq"
;

// video_test.mp4 b64 len: 224
pub const VIDEO_B64: &str =
    "AAAAGGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAHZtb292AAAAbG12aGQA"
    "AAAAAAAAAAAAAAAAAAPoAAAD6AABAAAAAQAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAA"
    "AAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAJbWRhdAA="
;


// -------- probe_ctx: x2 -> x4 -> bisect from claimed going UP --------
impl ProbeClient {
    pub fn probe_ctx(&mut self, claimed: u64) -> Option<u64> {
        self.emit(ProbeEvent::info("ctx", "start", &format!("claimed={}", claimed)));
        let url = self.url();
        let headers = self.headers();
        let body_for = |tokens: u64| -> serde_json::Value {
            let content_len = ((tokens as f64) * 0.75) as usize;
            let content = "A".repeat(content_len.max(100));
            serde_json::json!({
                "model": self.model,
                "messages": [{"role": "user", "content": content}],
                "max_tokens": 32,
            })
        };
        let mut last_ok = claimed;
        for mult in [1u64, 2, 4] {
            let test = claimed.saturating_mul(mult);
            let r = self.client.post(&url).headers(headers.clone()).json(&body_for(test)).send();
            match r {
                Ok(resp) if resp.status().is_success() => {
                    self.emit(ProbeEvent::info("ctx", "ok", &format!("test={} status=200", test)));
                    last_ok = test;
                }
                Ok(resp) => {
                    let s = resp.status().as_u16();
                    self.emit(ProbeEvent::info("ctx", "fail", &format!("test={} status={}", test, s)));
                    if test <= claimed { return Some(last_ok); }
                    let mut lo = last_ok;
                    let mut hi = test;
                    while hi.saturating_sub(lo) > 1024 {
                        let mid = (lo + hi) / 2;
                        let r2 = self.client.post(&url).headers(headers.clone()).json(&body_for(mid)).send();
                        match r2 {
                            Ok(resp2) if resp2.status().is_success() => {
                                self.emit(ProbeEvent::info("ctx", "bisect", &format!("lo={} mid={} hi={} status=200", lo, mid, hi)));
                                lo = mid;
                            }
                            _ => {
                                self.emit(ProbeEvent::info("ctx", "bisect", &format!("lo={} mid={} hi={} status!=200", lo, mid, hi)));
                                hi = mid;
                            }
                        }
                    }
                    last_ok = lo;
                    break;
                }
                Err(e) => {
                    self.emit(ProbeEvent::fail("ctx", &format!("test={} err={}", test, e)));
                    return Some(last_ok);
                }
            }
        }
        self.emit(ProbeEvent::info("ctx", "done", &format!("ctx={}", last_ok)));
        Some(last_ok)
    }
}



// -------- probe_max_tokens: same algorithm as ctx --------
impl ProbeClient {
    pub fn probe_max_tokens(&mut self, claimed: u64) -> Option<u64> {
        self.emit(ProbeEvent::info("max_tokens", "start", &format!("claimed={}", claimed)));
        let url = self.url();
        let headers = self.headers();
        let body_for = |mt: u64| -> serde_json::Value {
            serde_json::json!({
                "model": self.model,
                "messages": [{"role": "user", "content": "OK"}],
                "max_tokens": mt,
            })
        };
        let mut last_ok = claimed;
        for mult in [1u64, 2, 4] {
            let test = claimed.saturating_mul(mult);
            let r = self.client.post(&url).headers(headers.clone()).json(&body_for(test)).send();
            match r {
                Ok(resp) if resp.status().is_success() => {
                    self.emit(ProbeEvent::info("max_tokens", "ok", &format!("mt={} status=200", test)));
                    last_ok = test;
                }
                Ok(resp) => {
                    let s = resp.status().as_u16();
                    self.emit(ProbeEvent::info("max_tokens", "fail", &format!("mt={} status={}", test, s)));
                    if test <= claimed { return Some(last_ok); }
                    let mut lo = last_ok;
                    let mut hi = test;
                    while hi.saturating_sub(lo) > 512 {
                        let mid = (lo + hi) / 2;
                        let r2 = self.client.post(&url).headers(headers.clone()).json(&body_for(mid)).send();
                        match r2 {
                            Ok(resp2) if resp2.status().is_success() => {
                                self.emit(ProbeEvent::info("max_tokens", "bisect", &format!("lo={} mid={} hi={} status=200", lo, mid, hi)));
                                lo = mid;
                            }
                            _ => {
                                self.emit(ProbeEvent::info("max_tokens", "bisect", &format!("lo={} mid={} hi={} status!=200", lo, mid, hi)));
                                hi = mid;
                            }
                        }
                    }
                    last_ok = lo;
                    break;
                }
                Err(e) => {
                    self.emit(ProbeEvent::fail("max_tokens", &format!("mt={} err={}", test, e)));
                    return Some(last_ok);
                }
            }
        }
        self.emit(ProbeEvent::info("max_tokens", "done", &format!("mt={}", last_ok)));
        Some(last_ok)
    }
}



// -------- probe_caps: 6 multimodal/reasoning + 5 tool types, each tested individually --------
impl ProbeClient {
    pub fn probe_caps(&mut self) -> Capabilities {
        let mut caps = Capabilities::default();
        let url = self.url();
        let headers = self.headers();

        // 1. text
        let body = serde_json::json!({
            "model": self.model,
            "messages": [{"role": "user", "content": "Say hi in 3 words."}],
            "max_tokens": 32,
        });
        match self.client.post(&url).headers(headers.clone()).json(&body).send() {
            Ok(r) if r.status().is_success() => {
                let j: serde_json::Value = r.json().unwrap_or(serde_json::Value::Null);
                let txt = reply_text(&j);
                let hit = reply_contains_any(&txt, &[&["hi","hello","hey","greet","\u{4f60}\u{597d}","\u{55e8}"]]);
                let v = hit.is_some();
                caps.text = Some(v);
                self.emit(ProbeEvent::info("text", if v {"ok"} else {"fail"}, &format!("hit={:?}", hit)));
            }
            _ => { caps.text = Some(false); self.emit(ProbeEvent::fail("text", "status!=200")); }
        }

        // 2. image (RED+red fixture)
        let png_url = format!("data:image/png;base64,{}", IMAGE_B64);
        let body = serde_json::json!({
            "model": self.model,
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": "Describe this image. What color and any text?"},
                {"type": "image_url", "image_url": {"url": png_url}},
            ]}],
            "max_tokens": 256,
        });
        match self.client.post(&url).headers(headers.clone()).json(&body).send() {
            Ok(r) if r.status().is_success() => {
                let j: serde_json::Value = r.json().unwrap_or(serde_json::Value::Null);
                let txt = reply_text(&j);
                let hit = reply_contains_any(&txt, &[&["red","\u{7ea2}\u{8272}","saturated","crimson","scarlet"]]);
                let v = hit.is_some();
                caps.image = Some(v);
                self.emit(ProbeEvent::info("image", if v {"ok"} else {"fail"}, &format!("hit={:?}", hit)));
            }
            _ => { caps.image = Some(false); self.emit(ProbeEvent::fail("image", "status!=200")); }
        }

        // 3. audio (440Hz WAV, input_audio shape)
        let body = serde_json::json!({
            "model": self.model,
            "messages": [{"role": "user", "content": [
                {"type": "input_audio", "input_audio": {"data": AUDIO_B64, "format": "wav"}},
                {"type": "text", "text": "What does this audio sound like?"},
            ]}],
            "max_tokens": 256,
        });
        match self.client.post(&url).headers(headers.clone()).json(&body).send() {
            Ok(r) if r.status().is_success() => {
                let j: serde_json::Value = r.json().unwrap_or(serde_json::Value::Null);
                let txt = reply_text(&j);
                let hit = reply_contains_any(&txt, &[&["audio","sound","\u{58f0}\u{97f3}","beep","tone","sine","wave","440"]]);
                let v = hit.is_some();
                caps.audio = Some(v);
                self.emit(ProbeEvent::info("audio", if v {"ok"} else {"fail"}, &format!("hit={:?}", hit)));
            }
            Ok(r) => { caps.audio = Some(false); self.emit(ProbeEvent::fail("audio", &format!("status={}", r.status().as_u16()))); }
            Err(e) => { caps.audio = Some(false); self.emit(ProbeEvent::fail("audio", &format!("err={}", e))); }
        }

        // 4. video (mp4 stub)
        let mp4_url = format!("data:video/mp4;base64,{}", VIDEO_B64);
        let body = serde_json::json!({
            "model": self.model,
            "messages": [{"role": "user", "content": [
                {"type": "video_url", "video_url": {"url": mp4_url}},
                {"type": "text", "text": "Describe this video briefly."},
            ]}],
            "max_tokens": 256,
        });
        match self.client.post(&url).headers(headers.clone()).json(&body).send() {
            Ok(r) if r.status().is_success() => {
                let j: serde_json::Value = r.json().unwrap_or(serde_json::Value::Null);
                let txt = reply_text(&j);
                let hit = reply_contains_any(&txt, &[&["video","\u{89c6}\u{9891}","frame","play","image","mp4"]]);
                let v = hit.is_some();
                caps.video = Some(v);
                self.emit(ProbeEvent::info("video", if v {"ok"} else {"fail"}, &format!("hit={:?}", hit)));
            }
            Ok(r) => { caps.video = Some(false); self.emit(ProbeEvent::fail("video", &format!("status={}", r.status().as_u16()))); }
            Err(e) => { caps.video = Some(false); self.emit(ProbeEvent::fail("video", &format!("err={}", e))); }
        }


        // 5. function (one tool, tool_choice=required, check tool_calls present)
        let body = serde_json::json!({
            "model": self.model,
            "messages": [{"role": "user", "content": "What is the weather in Tokyo? Use get_weather."}],
            "tools": [{"type": "function", "function": {
                "name": "get_weather",
                "description": "Get current weather for a city",
                "parameters": {
                    "type": "object",
                    "properties": {"city": {"type": "string"}},
                    "required": ["city"],
                },
            }}],
            "tool_choice": "required",
            "max_tokens": 256,
        });
        match self.client.post(&url).headers(headers.clone()).json(&body).send() {
            Ok(r) if r.status().is_success() => {
                let j: serde_json::Value = r.json().unwrap_or(serde_json::Value::Null);
                let v = has_tool_calls(&j);
                caps.function = Some(v);
                self.emit(ProbeEvent::info("function", if v {"ok"} else {"fail"}, &format!("tool_calls={}", v)));
            }
            Ok(r) => { caps.function = Some(false); self.emit(ProbeEvent::fail("function", &format!("status={}", r.status().as_u16()))); }
            Err(e) => { caps.function = Some(false); self.emit(ProbeEvent::fail("function", &format!("err={}", e))); }
        }

        // 6. reasoning (reasoning_effort=medium, check reasoning_tokens > 0)
        let body = serde_json::json!({
            "model": self.model,
            "reasoning_effort": "medium",
            "messages": [{"role": "user", "content": "What is 13 * 17? Think step by step."}],
            "max_tokens": 1024,
        });
        match self.client.post(&url).headers(headers.clone()).json(&body).send() {
            Ok(r) if r.status().is_success() => {
                let j: serde_json::Value = r.json().unwrap_or(serde_json::Value::Null);
                let rt = usage_reasoning_tokens(&j);
                let v = rt > 0;
                caps.reasoning = Some(v);
                self.emit(ProbeEvent::info("reasoning", if v {"ok"} else {"fail"}, &format!("reason_tokens={}", rt)));
            }
            Ok(r) => { caps.reasoning = Some(false); self.emit(ProbeEvent::fail("reasoning", &format!("status={}", r.status().as_u16()))); }
            Err(e) => { caps.reasoning = Some(false); self.emit(ProbeEvent::fail("reasoning", &format!("err={}", e))); }
        }


        // 7-11. tool types: each tested individually with tools:[{type:...}]
        let tool_specs: &[(&str, serde_json::Value)] = &[
            ("web_search", serde_json::json!({"type": "web_search"})),
            ("file_search", serde_json::json!({"type": "file_search"})),
            ("computer_use", serde_json::json!({"type": "computer_use", "provider": "windows"})),
            ("tool_search", serde_json::json!({"type": "tool_search"})),
            ("mcp", serde_json::json!({"type": "mcp"})),
        ];
        for (name, tdef) in tool_specs {
            let body = serde_json::json!({
                "model": self.model,
                "messages": [{"role": "user", "content": "hi"}],
                "tools": [tdef],
                "tool_choice": "auto",
                "max_tokens": 64,
            });
            let v = match self.client.post(&url).headers(headers.clone()).json(&body).send() {
                Ok(r) if r.status().is_success() => {
                    self.emit(ProbeEvent::ok(name, "status=200"));
                    true
                }
                Ok(r) => {
                    self.emit(ProbeEvent::fail(name, &format!("status={}", r.status().as_u16())));
                    false
                }
                Err(e) => {
                    self.emit(ProbeEvent::fail(name, &format!("err={}", e)));
                    false
                }
            };
            match *name {
                "web_search" => caps.web_search = Some(v),
                "file_search" => caps.file_search = Some(v),
                "computer_use" => caps.computer_use = Some(v),
                "tool_search" => caps.tool_search = Some(v),
                "mcp" => caps.mcp = Some(v),
                _ => {}
            }
        }

        caps
    }

    pub fn take_events(&mut self) -> Vec<ProbeEvent> {
        std::mem::take(&mut self.events)
    }
}

