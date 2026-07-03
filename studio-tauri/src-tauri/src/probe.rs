// probe.rs - GodeX Studio model probe (3-command split)
// See handoff-draft.md for architecture decision.

use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, AUTHORIZATION, CONTENT_TYPE};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
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
    client: Client,
    cancel: Arc<AtomicBool>,
    live_emit: Option<Box<dyn Fn(ProbeEvent) + Send + Sync>>,
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
            cancel: Arc::new(AtomicBool::new(false)),
            live_emit: None,
        })
    }
    pub fn with_cancel(mut self, cancel: Arc<AtomicBool>) -> Self {
        self.cancel = cancel;
        self
    }
    pub fn with_live_emit(mut self, f: Box<dyn Fn(ProbeEvent) + Send + Sync>) -> Self {
        self.live_emit = Some(f);
        self
    }
    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
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

    fn emit(&self, ev: ProbeEvent) {
        if let Some(ref f) = self.live_emit {
            f(ev);
        }
    }
    /// Kept for backward compatibility; returns empty since events are emitted live.
    pub fn take_events(&mut self) -> Vec<ProbeEvent> {
        Vec::new()
    }
}

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


fn reply_contains_any(text: &str, kw_groups: &[&[&str]]) -> Option<String> {
    let low = text.to_lowercase();
    for grp in kw_groups {
        for kw in grp.iter() {
            if low.contains(&kw.to_lowercase()) {
                return Some(kw.to_string());
            }
        }
    }
    None
}


// image_test.png b64 (single-line)
pub const IMAGE_B64: &str = "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";

// audio_test.wav b64 (single-line)
pub const AUDIO_B64: &str = "UklGRqQ+AABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YYA+AAAAAK0VyygWN90+Nj8VOFIqjxcCAjrsx9j3yYvBgsD6xjHUlub8+9oRniXuNP09tz/oOUEtPxsFBhbwB9w6zIvCIcBExVnR8uL79/YNSiKRMt489z+BOwEw1R4DCgL0bN+wzsnDAMDJw7DObN8C9AMK1R4BMIE79z/ePJEySiL2Dfv38uJZ0UTFIcCLwjrMB9wW8AUGPxtBLeg5tz/9Pe40niXaEfz7luYx1PrGgsCLwffJx9g67AICjxdSKhU4Nj/dPhY3yyitFQAAU+o11+rII8HKwOvHrtVx6P79xhM5Jwk2dT5+PwY5zytqGQQEJu5i2hLLA8JJwBjGv9LB5Pv56g/5I8YzdT3fP7w6py4OHQUICvK23W/NIsMJwH/E/88r4f31/guUIFAxNzwAQDc8UDGUIP4L/fUr4f/Pf8QJwCLDb8223QryBQgOHacuvDrfP3U9xjP5I+oP+/nB5L/SGMZJwAPCEsti2ibuBARqGc8rBjl+P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111PqAACtFcsoFjfdPjY/FThSKo8XAgI67MfY98mLwYLA+sYx1Jbm/PvaEZ4l7jT9Pbc/6DlBLT8bBQYW8AfcOsyLwiHARMVZ0fLi+/f2DUoikTLePPc/gTsBMNUeAwoC9GzfsM7JwwDAycOwzmzfAvQDCtUeATCBO/c/3jyRMkoi9g379/LiWdFExSHAi8I6zAfcFvAFBj8bQS3oObc//T3uNJ4l2hH8+5bmMdT6xoLAi8H3ycfYOuwCAo8XUioVODY/3T4WN8sorRUAAFPqNdfqyCPBysDrx67Vcej+/cYTOScJNnU+fj8GOc8rahkEBCbuYtoSywPCScAYxr/SweT7+eoP+SPGM3U93z+8OqcuDh0FCArytt1vzSLDCcB/xP/PK+H99f4LlCBQMTc8AEA3PFAxlCD+C/31K+H/z3/ECcAiw2/Ntt0K8gUIDh2nLrw63z91PcYz+SPqD/v5weS/0hjGScADwhLLYtom7gQEahnPKwY5fj91Pgk2OSfGE/79ceiu1evHysAjwerINddT6gAArRXLKBY33T42PxU4UiqPFwICOuzH2PfJi8GCwPrGMdSW5vz72hGeJe40/T23P+g5QS0/GwUGFvAH3DrMi8IhwETFWdHy4vv39g1KIpEy3jz3P4E7ATDVHgMKAvRs37DOycMAwMnDsM5s3wL0AwrVHgEwgTv3P948kTJKIvYN+/fy4lnRRMUhwIvCOswH3BbwBQY/G0Et6Dm3P/097jSeJdoR/PuW5jHU+saCwIvB98nH2DrsAgKPF1IqFTg2P90+FjfLKK0VAABT6jXX6sgjwcrA68eu1XHo/v3GEzknCTZ1Pn4/BjnPK2oZBAQm7mLaEssDwknAGMa/0sHk+/nqD/kjxjN1Pd8/vDqnLg4dBQgK8rbdb80iwwnAf8T/zyvh/fX+C5QgUDE3PABANzxQMZQg/gv99Svh/89/xAnAIsNvzbbdCvIFCA4dpy68Ot8/dT3GM/kj6g/7+cHkv9IYxknAA8ISy2LaJu4EBGoZzysGOX4/dT4JNjknxhP+/XHortXrx8rAI8HqyDXXU+oAAK0VyygWN90+Nj8VOFIqjxcCAjrsx9j3yYvBgsD6xjHUlub8+9oRniXuNP09tz/oOUEtPxsFBhbwB9w6zIvCIcBExVnR8uL79/YNSiKRMt489z+BOwEw1R4DCgL0bN+wzsnDAMDJw7DObN8C9AMK1R4BMIE79z/ePJEySiL2Dfv38uJZ0UTFIcCLwjrMB9wW8AUGPxtBLeg5tz/9Pe40niXaEfz7luYx1PrGgsCLwffJx9g67AICjxdSKhU4Nj/dPhY3yyitFQAAU+o11+rII8HKwOvHrtVx6P79xhM5Jwk2dT5+PwY5zytqGQQEJu5i2hLLA8JJwBjGv9LB5Pv56g/5I8YzdT3fP7w6py4OHQUICvK23W/NIsMJwH/E/88r4f31/guUIFAxNzwAQDc8UDGUIP4L/fUr4f/Pf8QJwCLDb8223QryBQgOHacuvDrfP3U9xjP5I+oP+/nB5L/SGMZJwAPCEsti2ibuBARqGc8rBjl+P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111PqAACtFcsoFjfdPjY/FThSKo8XAgI67MfY98mLwYLA+sYx1Jbm/PvaEZ4l7jT9Pbc/6DlBLT8bBQYW8AfcOsyLwiHARMVZ0fLi+/f2DUoikTLePPc/gTsBMNUeAwoC9GzfsM7JwwDAycOwzmzfAvQDCtUeATCBO/c/3jyRMkoi9g379/LiWdFExSHAi8I6zAfcFvAFBj8bQS3oObc//T3uNJ4l2hH8+5bmMdT6xoLAi8H3ycfYOuwCAo8XUioVODY/3T4WN8sorRUAAFPqNdfqyCPBysDrx67Vcej+/cYTOScJNnU+fj8GOc8rahkEBCbuYtoSywPCScAYxr/SweT7+eoP+SPGM3U93z+8OqcuDh0FCArytt1vzSLDCcB/xP/PK+H99f4LlCBQMTc8AEA3PFAxlCD+C/31K+H/z3/ECcAiw2/Ntt0K8gUIDh2nLrw63z91PcYz+SPqD/v5weS/0hjGScADwhLLYtom7gQEahnPKwY5fj91Pgk2OSfGE/79ceiu1evHysAjwerINddT6gAArRXLKBY33T42PxU4UiqPFwICOuzH2PfJi8GCwPrGMdSW5vz72hGeJe40/T23P+g5QS0/GwUGFvAH3DrMi8IhwETFWdHy4vv39g1KIpEy3jz3P4E7ATDVHgMKAvRs37DOycMAwMnDsM5s3wL0AwrVHgEwgTv3P948kTJKIvYN+/fy4lnRRMUhwIvCOswH3BbwBQY/G0Et6Dm3P/097jSeJdoR/PuW5jHU+saCwIvB98nH2DrsAgKPF1IqFTg2P90+FjfLKK0VAABT6jXX6sgjwcrA68eu1XHo/v3GEzknCTZ1Pn4/BjnPK2oZBAQm7mLaEssDwknAGMa/0sHk+/nqD/kjxjN1Pd8/vDqnLg4dBQgK8rbdb80iwwnAf8T/zyvh/fX+C5QgUDE3PABANzxQMZQg/gv99Svh/89/xAnAIsNvzbbdCvIFCA4dpy68Ot8/dT3GM/kj6g/7+cHkv9IYxknAA8ISy2LaJu4EBGoZzysGOX4/dT4JNjknxhP+/XHortXrx8rAI8HqyDXXU+oAAK0VyygWN90+Nj8VOFIqjxcCAjrsx9j3yYvBgsD6xjHUlub8+9oRniXuNP09tz/oOUEtPxsFBhbwB9w6zIvCIcBExVnR8uL79/YNSiKRMt489z+BOwEw1R4DCgL0bN+wzsnDAMDJw7DObN8C9AMK1R4BMIE79z/ePJEySiL2Dfv38uJZ0UTFIcCLwjrMB9wW8AUGPxtBLeg5tz/9Pe40niXaEfz7luYx1PrGgsCLwffJx9g67AICjxdSKhU4Nj/dPhY3yyitFQAAU+o11+rII8HKwOvHrtVx6P79xhM5Jwk2dT5+PwY5zytqGQQEJu5i2hLLA8JJwBjGv9LB5Pv56g/5I8YzdT3fP7w6py4OHQUICvK23W/NIsMJwH/E/88r4f31/guUIFAxNzwAQDc8UDGUIP4L/fUr4f/Pf8QJwCLDb8223QryBQgOHacuvDrfP3U9xjP5I+oP+/nB5L/SGMZJwAPCEsti2ibuBARqGc8rBjl+P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111PqAACtFcsoFjfdPjY/FThSKo8XAgI67MfY98mLwYLA+sYx1Jbm/PvaEZ4l7jT9Pbc/6DlBLT8bBQYW8AfcOsyLwiHARMVZ0fLi+/f2DUoikTLePPc/gTsBMNUeAwoC9GzfsM7JwwDAycOwzmzfAvQDCtUeATCBO/c/3jyRMkoi9g379/LiWdFExSHAi8I6zAfcFvAFBj8bQS3oObc//T3uNJ4l2hH8+5bmMdT6xoLAi8H3ycfYOuwCAo8XUioVODY/3T4WN8sorRUAAFPqNdfqyCPBysDrx67Vcej+/cYTOScJNnU+fj8GOc8rahkEBCbuYtoSywPCScAYxr/SweT7+eoP+SPGM3U93z+8OqcuDh0FCArytt1vzSLDCcB/xP/PK+H99f4LlCBQMTc8AEA3PFAxlCD+C/31K+H/z3/ECcAiw2/Ntt0K8gUIDh2nLrw63z91PcYz+SPqD/v5weS/0hjGScADwhLLYtom7gQEahnPKwY5fj91Pgk2OSfGE/79ceiu1evHysAjwerINddT6gAArRXLKBY33T42PxU4UiqPFwICOuzH2PfJi8GCwPrGMdSW5vz72hGeJe40/T23P+g5QS0/GwUGFvAH3DrMi8IhwETFWdHy4vv39g1KIpEy3jz3P4E7ATDVHgMKAvRs37DOycMAwMnDsM5s3wL0AwrVHgEwgTv3P948kTJKIvYN+/fy4lnRRMUhwIvCOswH3BbwBQY/G0Et6Dm3P/097jSeJdoR/PuW5jHU+saCwIvB98nH2DrsAgKPF1IqFTg2P90+FjfLKK0VAABT6jXX6sgjwcrA68eu1XHo/v3GEzknCTZ1Pn4/BjnPK2oZBAQm7mLaEssDwknAGMa/0sHk+/nqD/kjxjN1Pd8/vDqnLg4dBQgK8rbdb80iwwnAf8T/zyvh/fX+C5QgUDE3PABANzxQMZQg/gv99Svh/89/xAnAIsNvzbbdCvIFCA4dpy68Ot8/dT3GM/kj6g/7+cHkv9IYxknAA8ISy2LaJu4EBGoZzysGOX4/dT4JNjknxhP+/XHortXrx8rAI8HqyDXXU+oAAK0VyygWN90+Nj8VOFIqjxcCAjrsx9j3yYvBgsD6xjHUlub8+9oRniXuNP09tz/oOUEtPxsFBhbwB9w6zIvCIcBExVnR8uL79/YNSiKRMt489z+BOwEw1R4DCgL0bN+wzsnDAMDJw7DObN8C9AMK1R4BMIE79z/ePJEySiL2Dfv38uJZ0UTFIcCLwjrMB9wW8AUGPxtBLeg5tz/9Pe40niXaEfz7luYx1PrGgsCLwffJx9g67AICjxdSKhU4Nj/dPhY3yyitFQAAU+o11+rII8HKwOvHrtVx6P79xhM5Jwk2dT5+PwY5zytqGQQEJu5i2hLLA8JJwBjGv9LB5Pv56g/5I8YzdT3fP7w6py4OHQUICvK23W/NIsMJwH/E/88r4f31/guUIFAxNzwAQDc8UDGUIP4L/fUr4f/Pf8QJwCLDb8223QryBQgOHacuvDrfP3U9xjP5I+oP+/nB5L/SGMZJwAPCEsti2ibuBARqGc8rBjl+P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111PqAACtFcsoFjfdPjY/FThSKo8XAgI67MfY98mLwYLA+sYx1Jbm/PvaEZ4l7jT9Pbc/6DlBLT8bBQYW8AfcOsyLwiHARMVZ0fLi+/f2DUoikTLePPc/gTsBMNUeAwoC9GzfsM7JwwDAycOwzmzfAvQDCtUeATCBO/c/3jyRMkoi9g379/LiWdFExSHAi8I6zAfcFvAFBj8bQS3oObc//T3uNJ4l2hH8+5bmMdT6xoLAi8H3ycfYOuwCAo8XUioVODY/3T4WN8sorRUAAFPqNdfqyCPBysDrx67Vcej+/cYTOScJNnU+fj8GOc8rahkEBCbuYtoSywPCScAYxr/SweT7+eoP+SPGM3U93z+8OqcuDh0FCArytt1vzSLDCcB/xP/PK+H99f4LlCBQMTc8AEA3PFAxlCD+C/31K+H/z3/ECcAiw2/Ntt0K8gUIDh2nLrw63z91PcYz+SPqD/v5weS/0hjGScADwhLLYtom7gQEahnPKwY5fj91Pgk2OSfGE/79ceiu1evHysAjwerINddT6gAArRXLKBY33T42PxU4UiqPFwICOuzH2PfJi8GCwPrGMdSW5vz72hGeJe40/T23P+g5QS0/GwUGFvAH3DrMi8IhwETFWdHy4vv39g1KIpEy3jz3P4E7ATDVHgMKAvRs37DOycMAwMnDsM5s3wL0AwrVHgEwgTv3P948kTJKIvYN+/fy4lnRRMUhwIvCOswH3BbwBQY/G0Et6Dm3P/097jSeJdoR/PuW5jHU+saCwIvB98nH2DrsAgKPF1IqFTg2P90+FjfLKK0VAABT6jXX6sgjwcrA68eu1XHo/v3GEzknCTZ1Pn4/BjnPK2oZBAQm7mLaEssDwknAGMa/0sHk+/nqD/kjxjN1Pd8/vDqnLg4dBQgK8rbdb80iwwnAf8T/zyvh/fX+C5QgUDE3PABANzxQMZQg/gv99Svh/89/xAnAIsNvzbbdCvIFCA4dpy68Ot8/dT3GM/kj6g/7+cHkv9IYxknAA8ISy2LaJu4EBGoZzysGOX4/dT4JNjknxhP+/XHortXrx8rAI8HqyDXXU+oAAK0VyygWN90+Nj8VOFIqjxcCAjrsx9j3yYvBgsD6xjHUlub8+9oRniXuNP09tz/oOUEtPxsFBhbwB9w6zIvCIcBExVnR8uL79/YNSiKRMt489z+BOwEw1R4DCgL0bN+wzsnDAMDJw7DObN8C9AMK1R4BMIE79z/ePJEySiL2Dfv38uJZ0UTFIcCLwjrMB9wW8AUGPxtBLeg5tz/9Pe40niXaEfz7luYx1PrGgsCLwffJx9g67AICjxdSKhU4Nj/dPhY3yyitFQAAU+o11+rII8HKwOvHrtVx6P79xhM5Jwk2dT5+PwY5zytqGQQEJu5i2hLLA8JJwBjGv9LB5Pv56g/5I8YzdT3fP7w6py4OHQUICvK23W/NIsMJwH/E/88r4f31/guUIFAxNzwAQDc8UDGUIP4L/fUr4f/Pf8QJwCLDb8223QryBQgOHacuvDrfP3U9xjP5I+oP+/nB5L/SGMZJwAPCEsti2ibuBARqGc8rBjl+P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111PqAACtFcsoFjfdPjY/FThSKo8XAgI67MfY98mLwYLA+sYx1Jbm/PvaEZ4l7jT9Pbc/6DlBLT8bBQYW8AfcOsyLwiHARMVZ0fLi+/f2DUoikTLePPc/gTsBMNUeAwoC9GzfsM7JwwDAycOwzmzfAvQDCtUeATCBO/c/3jyRMkoi9g379/LiWdFExSHAi8I6zAfcFvAFBj8bQS3oObc//T3uNJ4l2hH8+5bmMdT6xoLAi8H3ycfYOuwCAo8XUioVODY/3T4WN8sorRUAAFPqNdfqyCPBysDrx67Vcej+/cYTOScJNnU+fj8GOc8rahkEBCbuYtoSywPCScAYxr/SweT7+eoP+SPGM3U93z+8OqcuDh0FCArytt1vzSLDCcB/xP/PK+H99f4LlCBQMTc8AEA3PFAxlCD+C/31K+H/z3/ECcAiw2/Ntt0K8gUIDh2nLrw63z91PcYz+SPqD/v5weS/0hjGScADwhLLYtom7gQEahnPKwY5fj91Pgk2OSfGE/79ceiu1evHysAjwerINddT6gAArRXLKBY33T42PxU4UiqPFwICOuzH2PfJi8GCwPrGMdSW5vz72hGeJe40/T23P+g5QS0/GwUGFvAH3DrMi8IhwETFWdHy4vv39g1KIpEy3jz3P4E7ATDVHgMKAvRs37DOycMAwMnDsM5s3wL0AwrVHgEwgTv3P948kTJKIvYN+/fy4lnRRMUhwIvCOswH3BbwBQY/G0Et6Dm3P/097jSeJdoR/PuW5jHU+saCwIvB98nH2DrsAgKPF1IqFTg2P90+FjfLKK0VAABT6jXX6sgjwcrA68eu1XHo/v3GEzknCTZ1Pn4/BjnPK2oZBAQm7mLaEssDwknAGMa/0sHk+/nqD/kjxjN1Pd8/vDqnLg4dBQgK8rbdb80iwwnAf8T/zyvh/fX+C5QgUDE3PABANzxQMZQg/gv99Svh/89/xAnAIsNvzbbdCvIFCA4dpy68Ot8/dT3GM/kj6g/7+cHkv9IYxknAA8ISy2LaJu4EBGoZzysGOX4/dT4JNjknxhP+/XHortXrx8rAI8HqyDXXU+oAAK0VyygWN90+Nj8VOFIqjxcCAjrsx9j3yYvBgsD6xjHUlub8+9oRniXuNP09tz/oOUEtPxsFBhbwB9w6zIvCIcBExVnR8uL79/YNSiKRMt489z+BOwEw1R4DCgL0bN+wzsnDAMDJw7DObN8C9AMK1R4BMIE79z/ePJEySiL2Dfv38uJZ0UTFIcCLwjrMB9wW8AUGPxtBLeg5tz/9Pe40niXaEfz7luYx1PrGgsCLwffJx9g67AICjxdSKhU4Nj/dPhY3yyitFQAAU+o11+rII8HKwOvHrtVx6P79xhM5Jwk2dT5+PwY5zytqGQQEJu5i2hLLA8JJwBjGv9LB5Pv56g/5I8YzdT3fP7w6py4OHQUICvK23W/NIsMJwH/E/88r4f31/guUIFAxNzwAQDc8UDGUIP4L/fUr4f/Pf8QJwCLDb8223QryBQgOHacuvDrfP3U9xjP5I+oP+/nB5L/SGMZJwAPCEsti2ibuBARqGc8rBjl+P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111PqAACtFcsoFjfdPjY/FThSKo8XAgI67MfY98mLwYLA+sYx1Jbm/PvaEZ4l7jT9Pbc/6DlBLT8bBQYW8AfcOsyLwiHARMVZ0fLi+/f2DUoikTLePPc/gTsBMNUeAwoC9GzfsM7JwwDAycOwzmzfAvQDCtUeATCBO/c/3jyRMkoi9g379/LiWdFExSHAi8I6zAfcFvAFBj8bQS3oObc//T3uNJ4l2hH8+5bmMdT6xoLAi8H3ycfYOuwCAo8XUioVODY/3T4WN8sorRUAAFPqNdfqyCPBysDrx67Vcej+/cYTOScJNnU+fj8GOc8rahkEBCbuYtoSywPCScAYxr/SweT7+eoP+SPGM3U93z+8OqcuDh0FCArytt1vzSLDCcB/xP/PK+H99f4LlCBQMTc8AEA3PFAxlCD+C/31K+H/z3/ECcAiw2/Ntt0K8gUIDh2nLrw63z91PcYz+SPqD/v5weS/0hjGScADwhLLYtom7gQEahnPKwY5fj91Pgk2OSfGE/79ceiu1evHysAjwerINddT6gAArRXLKBY33T42PxU4UiqPFwICOuzH2PfJi8GCwPrGMdSW5vz72hGeJe40/T23P+g5QS0/GwUGFvAH3DrMi8IhwETFWdHy4vv39g1KIpEy3jz3P4E7ATDVHgMKAvRs37DOycMAwMnDsM5s3wL0AwrVHgEwgTv3P948kTJKIvYN+/fy4lnRRMUhwIvCOswH3BbwBQY/G0Et6Dm3P/097jSeJdoR/PuW5jHU+saCwIvB98nH2DrsAgKPF1IqFTg2P90+FjfLKK0VAABT6jXX6sgjwcrA68eu1XHo/v3GEzknCTZ1Pn4/BjnPK2oZBAQm7mLaEssDwknAGMa/0sHk+/nqD/kjxjN1Pd8/vDqnLg4dBQgK8rbdb80iwwnAf8T/zyvh/fX+C5QgUDE3PABANzxQMZQg/gv99Svh/89/xAnAIsNvzbbdCvIFCA4dpy68Ot8/dT3GM/kj6g/7+cHkv9IYxknAA8ISy2LaJu4EBGoZzysGOX4/dT4JNjknxhP+/XHortXrx8rAI8HqyDXXU+oAAK0VyygWN90+Nj8VOFIqjxcCAjrsx9j3yYvBgsD6xjHUlub8+9oRniXuNP09tz/oOUEtPxsFBhbwB9w6zIvCIcBExVnR8uL79/YNSiKRMt489z+BOwEw1R4DCgL0bN+wzsnDAMDJw7DObN8C9AMK1R4BMIE79z/ePJEySiL2Dfv38uJZ0UTFIcCLwjrMB9wW8AUGPxtBLeg5tz/9Pe40niXaEfz7luYx1PrGgsCLwffJx9g67AICjxdSKhU4Nj/dPhY3yyitFQAAU+o11+rII8HKwOvHrtVx6P79xhM5Jwk2dT5+PwY5zytqGQQEJu5i2hLLA8JJwBjGv9LB5Pv56g/5I8YzdT3fP7w6py4OHQUICvK23W/NIsMJwH/E/88r4f31/guUIFAxNzwAQDc8UDGUIP4L/fUr4f/Pf8QJwCLDb8223QryBQgOHacuvDrfP3U9xjP5I+oP+/nB5L/SGMZJwAPCEsti2ibuBARqGc8rBjl+P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111PqAACtFcsoFjfdPjY/FThSKo8XAgI67MfY98mLwYLA+sYx1Jbm/PvaEZ4l7jT9Pbc/6DlBLT8bBQYW8AfcOsyLwiHARMVZ0fLi+/f2DUoikTLePPc/gTsBMNUeAwoC9GzfsM7JwwDAycOwzmzfAvQDCtUeATCBO/c/3jyRMkoi9g379/LiWdFExSHAi8I6zAfcFvAFBj8bQS3oObc//T3uNJ4l2hH8+5bmMdT6xoLAi8H3ycfYOuwCAo8XUioVODY/3T4WN8sorRUAAFPqNdfqyCPBysDrx67Vcej+/cYTOScJNnU+fj8GOc8rahkEBCbuYtoSywPCScAYxr/SweT7+eoP+SPGM3U93z+8OqcuDh0FCArytt1vzSLDCcB/xP/PK+H99f4LlCBQMTc8AEA3PFAxlCD+C/31K+H/z3/ECcAiw2/Ntt0K8gUIDh2nLrw63z91PcYz+SPqD/v5weS/0hjGScADwhLLYtom7gQEahnPKwY5fj91Pgk2OSfGE/79ceiu1evHysAjwerINddT6gAArRXLKBY33T42PxU4UiqPFwICOuzH2PfJi8GCwPrGMdSW5vz72hGeJe40/T23P+g5QS0/GwUGFvAH3DrMi8IhwETFWdHy4vv39g1KIpEy3jz3P4E7ATDVHgMKAvRs37DOycMAwMnDsM5s3wL0AwrVHgEwgTv3P948kTJKIvYN+/fy4lnRRMUhwIvCOswH3BbwBQY/G0Et6Dm3P/097jSeJdoR/PuW5jHU+saCwIvB98nH2DrsAgKPF1IqFTg2P90+FjfLKK0VAABT6jXX6sgjwcrA68eu1XHo/v3GEzknCTZ1Pn4/BjnPK2oZBAQm7mLaEssDwknAGMa/0sHk+/nqD/kjxjN1Pd8/vDqnLg4dBQgK8rbdb80iwwnAf8T/zyvh/fX+C5QgUDE3PABANzxQMZQg/gv99Svh/89/xAnAIsNvzbbdCvIFCA4dpy68Ot8/dT3GM/kj6g/7+cHkv9IYxknAA8ISy2LaJu4EBGoZzysGOX4/dT4JNjknxhP+/XHortXrx8rAI8HqyDXXU+oAAK0VyygWN90+Nj8VOFIqjxcCAjrsx9j3yYvBgsD6xjHUlub8+9oRniXuNP09tz/oOUEtPxsFBhbwB9w6zIvCIcBExVnR8uL79/YNSiKRMt489z+BOwEw1R4DCgL0bN+wzsnDAMDJw7DObN8C9AMK1R4BMIE79z/ePJEySiL2Dfv38uJZ0UTFIcCLwjrMB9wW8AUGPxtBLeg5tz/9Pe40niXaEfz7luYx1PrGgsCLwffJx9g67AICjxdSKhU4Nj/dPhY3yyitFQAAU+o11+rII8HKwOvHrtVx6P79xhM5Jwk2dT5+PwY5zytqGQQEJu5i2hLLA8JJwBjGv9LB5Pv56g/5I8YzdT3fP7w6py4OHQUICvK23W/NIsMJwH/E/88r4f31/guUIFAxNzwAQDc8UDGUIP4L/fUr4f/Pf8QJwCLDb8223QryBQgOHacuvDrfP3U9xjP5I+oP+/nB5L/SGMZJwAPCEsti2ibuBARqGc8rBjl+P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111PqAACtFcsoFjfdPjY/FThSKo8XAgI67MfY98mLwYLA+sYx1Jbm/PvaEZ4l7jT9Pbc/6DlBLT8bBQYW8AfcOsyLwiHARMVZ0fLi+/f2DUoikTLePPc/gTsBMNUeAwoC9GzfsM7JwwDAycOwzmzfAvQDCtUeATCBO/c/3jyRMkoi9g379/LiWdFExSHAi8I6zAfcFvAFBj8bQS3oObc//T3uNJ4l2hH8+5bmMdT6xoLAi8H3ycfYOuwCAo8XUioVODY/3T4WN8sorRUAAFPqNdfqyCPBysDrx67Vcej+/cYTOScJNnU+fj8GOc8rahkEBCbuYtoSywPCScAYxr/SweT7+eoP+SPGM3U93z+8OqcuDh0FCArytt1vzSLDCcB/xP/PK+H99f4LlCBQMTc8AEA3PFAxlCD+C/31K+H/z3/ECcAiw2/Ntt0K8gUIDh2nLrw63z91PcYz+SPqD/v5weS/0hjGScADwhLLYtom7gQEahnPKwY5fj91Pgk2OSfGE/79ceiu1evHysAjwerINddT6gAArRXLKBY33T42PxU4UiqPFwICOuzH2PfJi8GCwPrGMdSW5vz72hGeJe40/T23P+g5QS0/GwUGFvAH3DrMi8IhwETFWdHy4vv39g1KIpEy3jz3P4E7ATDVHgMKAvRs37DOycMAwMnDsM5s3wL0AwrVHgEwgTv3P948kTJKIvYN+/fy4lnRRMUhwIvCOswH3BbwBQY/G0Et6Dm3P/097jSeJdoR/PuW5jHU+saCwIvB98nH2DrsAgKPF1IqFTg2P90+FjfLKK0VAABT6jXX6sgjwcrA68eu1XHo/v3GEzknCTZ1Pn4/BjnPK2oZBAQm7mLaEssDwknAGMa/0sHk+/nqD/kjxjN1Pd8/vDqnLg4dBQgK8rbdb80iwwnAf8T/zyvh/fX+C5QgUDE3PABANzxQMZQg/gv99Svh/89/xAnAIsNvzbbdCvIFCA4dpy68Ot8/dT3GM/kj6g/7+cHkv9IYxknAA8ISy2LaJu4EBGoZzysGOX4/dT4JNjknxhP+/XHortXrx8rAI8HqyDXXU+oAAK0VyygWN90+Nj8VOFIqjxcCAjrsx9j3yYvBgsD6xjHUlub8+9oRniXuNP09tz/oOUEtPxsFBhbwB9w6zIvCIcBExVnR8uL79/YNSiKRMt489z+BOwEw1R4DCgL0bN+wzsnDAMDJw7DObN8C9AMK1R4BMIE79z/ePJEySiL2Dfv38uJZ0UTFIcCLwjrMB9wW8AUGPxtBLeg5tz/9Pe40niXaEfz7luYx1PrGgsCLwffJx9g67AICjxdSKhU4Nj/dPhY3yyitFQAAU+o11+rII8HKwOvHrtVx6P79xhM5Jwk2dT5+PwY5zytqGQQEJu5i2hLLA8JJwBjGv9LB5Pv56g/5I8YzdT3fP7w6py4OHQUICvK23W/NIsMJwH/E/88r4f31/guUIFAxNzwAQDc8UDGUIP4L/fUr4f/Pf8QJwCLDb8223QryBQgOHacuvDrfP3U9xjP5I+oP+/nB5L/SGMZJwAPCEsti2ibuBARqGc8rBjl+P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111PqAACtFcsoFjfdPjY/FThSKo8XAgI67MfY98mLwYLA+sYx1Jbm/PvaEZ4l7jT9Pbc/6DlBLT8bBQYW8AfcOsyLwiHARMVZ0fLi+/f2DUoikTLePPc/gTsBMNUeAwoC9GzfsM7JwwDAycOwzmzfAvQDCtUeATCBO/c/3jyRMkoi9g379/LiWdFExSHAi8I6zAfcFvAFBj8bQS3oObc//T3uNJ4l2hH8+5bmMdT6xoLAi8H3ycfYOuwCAo8XUioVODY/3T4WN8sorRUAAFPqNdfqyCPBysDrx67Vcej+/cYTOScJNnU+fj8GOc8rahkEBCbuYtoSywPCScAYxr/SweT7+eoP+SPGM3U93z+8OqcuDh0FCArytt1vzSLDCcB/xP/PK+H99f4LlCBQMTc8AEA3PFAxlCD+C/31K+H/z3/ECcAiw2/Ntt0K8gUIDh2nLrw63z91PcYz+SPqD/v5weS/0hjGScADwhLLYtom7gQEahnPKwY5fj91Pgk2OSfGE/79ceiu1evHysAjwerINddT6gAArRXLKBY33T42PxU4UiqPFwICOuzH2PfJi8GCwPrGMdSW5vz72hGeJe40/T23P+g5QS0/GwUGFvAH3DrMi8IhwETFWdHy4vv39g1KIpEy3jz3P4E7ATDVHgMKAvRs37DOycMAwMnDsM5s3wL0AwrVHgEwgTv3P948kTJKIvYN+/fy4lnRRMUhwIvCOswH3BbwBQY/G0Et6Dm3P/097jSeJdoR/PuW5jHU+saCwIvB98nH2DrsAgKPF1IqFTg2P90+FjfLKK0VAABT6jXX6sgjwcrA68eu1XHo/v3GEzknCTZ1Pn4/BjnPK2oZBAQm7mLaEssDwknAGMa/0sHk+/nqD/kjxjN1Pd8/vDqnLg4dBQgK8rbdb80iwwnAf8T/zyvh/fX+C5QgUDE3PABANzxQMZQg/gv99Svh/89/xAnAIsNvzbbdCvIFCA4dpy68Ot8/dT3GM/kj6g/7+cHkv9IYxknAA8ISy2LaJu4EBGoZzysGOX4/dT4JNjknxhP+/XHortXrx8rAI8HqyDXXU+oAAK0VyygWN90+Nj8VOFIqjxcCAjrsx9j3yYvBgsD6xjHUlub8+9oRniXuNP09tz/oOUEtPxsFBhbwB9w6zIvCIcBExVnR8uL79/YNSiKRMt489z+BOwEw1R4DCgL0bN+wzsnDAMDJw7DObN8C9AMK1R4BMIE79z/ePJEySiL2Dfv38uJZ0UTFIcCLwjrMB9wW8AUGPxtBLeg5tz/9Pe40niXaEfz7luYx1PrGgsCLwffJx9g67AICjxdSKhU4Nj/dPhY3yyitFQAAU+o11+rII8HKwOvHrtVx6P79xhM5Jwk2dT5+PwY5zytqGQQEJu5i2hLLA8JJwBjGv9LB5Pv56g/5I8YzdT3fP7w6py4OHQUICvK23W/NIsMJwH/E/88r4f31/guUIFAxNzwAQDc8UDGUIP4L/fUr4f/Pf8QJwCLDb8223QryBQgOHacuvDrfP3U9xjP5I+oP+/nB5L/SGMZJwAPCEsti2ibuBARqGc8rBjl+P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111PqAACtFcsoFjfdPjY/FThSKo8XAgI67MfY98mLwYLA+sYx1Jbm/PvaEZ4l7jT9Pbc/6DlBLT8bBQYW8AfcOsyLwiHARMVZ0fLi+/f2DUoikTLePPc/gTsBMNUeAwoC9GzfsM7JwwDAycOwzmzfAvQDCtUeATCBO/c/3jyRMkoi9g379/LiWdFExSHAi8I6zAfcFvAFBj8bQS3oObc//T3uNJ4l2hH8+5bmMdT6xoLAi8H3ycfYOuwCAo8XUioVODY/3T4WN8sorRUAAFPqNdfqyCPBysDrx67Vcej+/cYTOScJNnU+fj8GOc8rahkEBCbuYtoSywPCScAYxr/SweT7+eoP+SPGM3U93z+8OqcuDh0FCArytt1vzSLDCcB/xP/PK+H99f4LlCBQMTc8AEA3PFAxlCD+C/31K+H/z3/ECcAiw2/Ntt0K8gUIDh2nLrw63z91PcYz+SPqD/v5weS/0hjGScADwhLLYtom7gQEahnPKwY5fj91Pgk2OSfGE/79ceiu1evHysAjwerINddT6gAArRXLKBY33T42PxU4UiqPFwICOuzH2PfJi8GCwPrGMdSW5vz72hGeJe40/T23P+g5QS0/GwUGFvAH3DrMi8IhwETFWdHy4vv39g1KIpEy3jz3P4E7ATDVHgMKAvRs37DOycMAwMnDsM5s3wL0AwrVHgEwgTv3P948kTJKIvYN+/fy4lnRRMUhwIvCOswH3BbwBQY/G0Et6Dm3P/097jSeJdoR/PuW5jHU+saCwIvB98nH2DrsAgKPF1IqFTg2P90+FjfLKK0VAABT6jXX6sgjwcrA68eu1XHo/v3GEzknCTZ1Pn4/BjnPK2oZBAQm7mLaEssDwknAGMa/0sHk+/nqD/kjxjN1Pd8/vDqnLg4dBQgK8rbdb80iwwnAf8T/zyvh/fX+C5QgUDE3PABANzxQMZQg/gv99Svh/89/xAnAIsNvzbbdCvIFCA4dpy68Ot8/dT3GM/kj6g/7+cHkv9IYxknAA8ISy2LaJu4EBGoZzysGOX4/dT4JNjknxhP+/XHortXrx8rAI8HqyDXXU+oAAK0VyygWN90+Nj8VOFIqjxcCAjrsx9j3yYvBgsD6xjHUlub8+9oRniXuNP09tz/oOUEtPxsFBhbwB9w6zIvCIcBExVnR8uL79/YNSiKRMt489z+BOwEw1R4DCgL0bN+wzsnDAMDJw7DObN8C9AMK1R4BMIE79z/ePJEySiL2Dfv38uJZ0UTFIcCLwjrMB9wW8AUGPxtBLeg5tz/9Pe40niXaEfz7luYx1PrGgsCLwffJx9g67AICjxdSKhU4Nj/dPhY3yyitFQAAU+o11+rII8HKwOvHrtVx6P79xhM5Jwk2dT5+PwY5zytqGQQEJu5i2hLLA8JJwBjGv9LB5Pv56g/5I8YzdT3fP7w6py4OHQUICvK23W/NIsMJwH/E/88r4f31/guUIFAxNzwAQDc8UDGUIP4L/fUr4f/Pf8QJwCLDb8223QryBQgOHacuvDrfP3U9xjP5I+oP+/nB5L/SGMZJwAPCEsti2ibuBARqGc8rBjl+P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111PqAACtFcsoFjfdPjY/FThSKo8XAgI67MfY98mLwYLA+sYx1Jbm/PvaEZ4l7jT9Pbc/6DlBLT8bBQYW8AfcOsyLwiHARMVZ0fLi+/f2DUoikTLePPc/gTsBMNUeAwoC9GzfsM7JwwDAycOwzmzfAvQDCtUeATCBO/c/3jyRMkoi9g379/LiWdFExSHAi8I6zAfcFvAFBj8bQS3oObc//T3uNJ4l2hH8+5bmMdT6xoLAi8H3ycfYOuwCAo8XUioVODY/3T4WN8sorRUAAFPqNdfqyCPBysDrx67Vcej+/cYTOScJNnU+fj8GOc8rahkEBCbuYtoSywPCScAYxr/SweT7+eoP+SPGM3U93z+8OqcuDh0FCArytt1vzSLDCcB/xP/PK+H99f4LlCBQMTc8AEA3PFAxlCD+C/31K+H/z3/ECcAiw2/Ntt0K8gUIDh2nLrw63z91PcYz+SPqD/v5weS/0hjGScADwhLLYtom7gQEahnPKwY5fj91Pgk2OSfGE/79ceiu1evHysAjwerINddT6gAArRXLKBY33T42PxU4UiqPFwICOuzH2PfJi8GCwPrGMdSW5vz72hGeJe40/T23P+g5QS0/GwUGFvAH3DrMi8IhwETFWdHy4vv39g1KIpEy3jz3P4E7ATDVHgMKAvRs37DOycMAwMnDsM5s3wL0AwrVHgEwgTv3P948kTJKIvYN+/fy4lnRRMUhwIvCOswH3BbwBQY/G0Et6Dm3P/097jSeJdoR/PuW5jHU+saCwIvB98nH2DrsAgKPF1IqFTg2P90+FjfLKK0VAABT6jXX6sgjwcrA68eu1XHo/v3GEzknCTZ1Pn4/BjnPK2oZBAQm7mLaEssDwknAGMa/0sHk+/nqD/kjxjN1Pd8/vDqnLg4dBQgK8rbdb80iwwnAf8T/zyvh/fX+C5QgUDE3PABANzxQMZQg/gv99Svh/89/xAnAIsNvzbbdCvIFCA4dpy68Ot8/dT3GM/kj6g/7+cHkv9IYxknAA8ISy2LaJu4EBGoZzysGOX4/dT4JNjknxhP+/XHortXrx8rAI8HqyDXXU+oAAK0VyygWN90+Nj8VOFIqjxcCAjrsx9j3yYvBgsD6xjHUlub8+9oRniXuNP09tz/oOUEtPxsFBhbwB9w6zIvCIcBExVnR8uL79/YNSiKRMt489z+BOwEw1R4DCgL0bN+wzsnDAMDJw7DObN8C9AMK1R4BMIE79z/ePJEySiL2Dfv38uJZ0UTFIcCLwjrMB9wW8AUGPxtBLeg5tz/9Pe40niXaEfz7luYx1PrGgsCLwffJx9g67AICjxdSKhU4Nj/dPhY3yyitFQAAU+o11+rII8HKwOvHrtVx6P79xhM5Jwk2dT5+PwY5zytqGQQEJu5i2hLLA8JJwBjGv9LB5Pv56g/5I8YzdT3fP7w6py4OHQUICvK23W/NIsMJwH/E/88r4f31/guUIFAxNzwAQDc8UDGUIP4L/fUr4f/Pf8QJwCLDb8223QryBQgOHacuvDrfP3U9xjP5I+oP+/nB5L/SGMZJwAPCEsti2ibuBARqGc8rBjl+P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111PqAACtFcsoFjfdPjY/FThSKo8XAgI67MfY98mLwYLA+sYx1Jbm/PvaEZ4l7jT9Pbc/6DlBLT8bBQYW8AfcOsyLwiHARMVZ0fLi+/f2DUoikTLePPc/gTsBMNUeAwoC9GzfsM7JwwDAycOwzmzfAvQDCtUeATCBO/c/3jyRMkoi9g379/LiWdFExSHAi8I6zAfcFvAFBj8bQS3oObc//T3uNJ4l2hH8+5bmMdT6xoLAi8H3ycfYOuwCAo8XUioVODY/3T4WN8sorRUAAFPqNdfqyCPBysDrx67Vcej+/cYTOScJNnU+fj8GOc8rahkEBCbuYtoSywPCScAYxr/SweT7+eoP+SPGM3U93z+8OqcuDh0FCArytt1vzSLDCcB/xP/PK+H99f4LlCBQMTc8AEA3PFAxlCD+C/31K+H/z3/ECcAiw2/Ntt0K8gUIDh2nLrw63z91PcYz+SPqD/v5weS/0hjGScADwhLLYtom7gQEahnPKwY5fj91Pgk2OSfGE/79ceiu1evHysAjwerINddT6gAArRXLKBY33T42PxU4UiqPFwICOuzH2PfJi8GCwPrGMdSW5vz72hGeJe40/T23P+g5QS0/GwUGFvAH3DrMi8IhwETFWdHy4vv39g1KIpEy3jz3P4E7ATDVHgMKAvRs37DOycMAwMnDsM5s3wL0AwrVHgEwgTv3P948kTJKIvYN+/fy4lnRRMUhwIvCOswH3BbwBQY/G0Et6Dm3P/097jSeJdoR/PuW5jHU+saCwIvB98nH2DrsAgKPF1IqFTg2P90+FjfLKK0VAABT6jXX6sgjwcrA68eu1XHo/v3GEzknCTZ1Pn4/BjnPK2oZBAQm7mLaEssDwknAGMa/0sHk+/nqD/kjxjN1Pd8/vDqnLg4dBQgK8rbdb80iwwnAf8T/zyvh/fX+C5QgUDE3PABANzxQMZQg/gv99Svh/89/xAnAIsNvzbbdCvIFCA4dpy68Ot8/dT3GM/kj6g/7+cHkv9IYxknAA8ISy2LaJu4EBGoZzysGOX4/dT4JNjknxhP+/XHortXrx8rAI8HqyDXXU+oAAK0VyygWN90+Nj8VOFIqjxcCAjrsx9j3yYvBgsD6xjHUlub8+9oRniXuNP09tz/oOUEtPxsFBhbwB9w6zIvCIcBExVnR8uL79/YNSiKRMt489z+BOwEw1R4DCgL0bN+wzsnDAMDJw7DObN8C9AMK1R4BMIE79z/ePJEySiL2Dfv38uJZ0UTFIcCLwjrMB9wW8AUGPxtBLeg5tz/9Pe40niXaEfz7luYx1PrGgsCLwffJx9g67AICjxdSKhU4Nj/dPhY3yyitFQAAU+o11+rII8HKwOvHrtVx6P79xhM5Jwk2dT5+PwY5zytqGQQEJu5i2hLLA8JJwBjGv9LB5Pv56g/5I8YzdT3fP7w6py4OHQUICvK23W/NIsMJwH/E/88r4f31/guUIFAxNzwAQDc8UDGUIP4L/fUr4f/Pf8QJwCLDb8223QryBQgOHacuvDrfP3U9xjP5I+oP+/nB5L/SGMZJwAPCEsti2ibuBARqGc8rBjl+P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111PqAACtFcsoFjfdPjY/FThSKo8XAgI67MfY98mLwYLA+sYx1Jbm/PvaEZ4l7jT9Pbc/6DlBLT8bBQYW8AfcOsyLwiHARMVZ0fLi+/f2DUoikTLePPc/gTsBMNUeAwoC9GzfsM7JwwDAycOwzmzfAvQDCtUeATCBO/c/3jyRMkoi9g379/LiWdFExSHAi8I6zAfcFvAFBj8bQS3oObc//T3uNJ4l2hH8+5bmMdT6xoLAi8H3ycfYOuwCAo8XUioVODY/3T4WN8sorRUAAFPqNdfqyCPBysDrx67Vcej+/cYTOScJNnU+fj8GOc8rahkEBCbuYtoSywPCScAYxr/SweT7+eoP+SPGM3U93z+8OqcuDh0FCArytt1vzSLDCcB/xP/PK+H99f4LlCBQMTc8AEA3PFAxlCD+C/31K+H/z3/ECcAiw2/Ntt0K8gUIDh2nLrw63z91PcYz+SPqD/v5weS/0hjGScADwhLLYtom7gQEahnPKwY5fj91Pgk2OSfGE/79ceiu1evHysAjwerINddT6gAArRXLKBY33T42PxU4UiqPFwICOuzH2PfJi8GCwPrGMdSW5vz72hGeJe40/T23P+g5QS0/GwUGFvAH3DrMi8IhwETFWdHy4vv39g1KIpEy3jz3P4E7ATDVHgMKAvRs37DOycMAwMnDsM5s3wL0AwrVHgEwgTv3P948kTJKIvYN+/fy4lnRRMUhwIvCOswH3BbwBQY/G0Et6Dm3P/097jSeJdoR/PuW5jHU+saCwIvB98nH2DrsAgKPF1IqFTg2P90+FjfLKK0VAABT6jXX6sgjwcrA68eu1XHo/v3GEzknCTZ1Pn4/BjnPK2oZBAQm7mLaEssDwknAGMa/0sHk+/nqD/kjxjN1Pd8/vDqnLg4dBQgK8rbdb80iwwnAf8T/zyvh/fX+C5QgUDE3PABANzxQMZQg/gv99Svh/89/xAnAIsNvzbbdCvIFCA4dpy68Ot8/dT3GM/kj6g/7+cHkv9IYxknAA8ISy2LaJu4EBGoZzysGOX4/dT4JNjknxhP+/XHortXrx8rAI8HqyDXXU+oAAK0VyygWN90+Nj8VOFIqjxcCAjrsx9j3yYvBgsD6xjHUlub8+9oRniXuNP09tz/oOUEtPxsFBhbwB9w6zIvCIcBExVnR8uL79/YNSiKRMt489z+BOwEw1R4DCgL0bN+wzsnDAMDJw7DObN8C9AMK1R4BMIE79z/ePJEySiL2Dfv38uJZ0UTFIcCLwjrMB9wW8AUGPxtBLeg5tz/9Pe40niXaEfz7luYx1PrGgsCLwffJx9g67AICjxdSKhU4Nj/dPhY3yyitFQAAU+o11+rII8HKwOvHrtVx6P79xhM5Jwk2dT5+PwY5zytqGQQEJu5i2hLLA8JJwBjGv9LB5Pv56g/5I8YzdT3fP7w6py4OHQUICvK23W/NIsMJwH/E/88r4f31/guUIFAxNzwAQDc8UDGUIP4L/fUr4f/Pf8QJwCLDb8223QryBQgOHacuvDrfP3U9xjP5I+oP+/nB5L/SGMZJwAPCEsti2ibuBARqGc8rBjl+P3U+CTY5J8YT/v1x6K7V68fKwCPB6sg111Pq";

// video_test.mp4 b64 (single-line)
pub const VIDEO_B64: &str = "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";

// -------- probe_ctx: x2 -> x4 -> bisect from claimed going UP --------
impl ProbeClient {
    pub fn probe_ctx(&mut self, claimed: u64) -> Option<u64> {
        self.emit(ProbeEvent::info("ctx", "start", &format!("claimed={}", claimed)));
        let url = self.url();
        let headers = self.headers();
        let model = self.model.clone();
        let build_body = |tokens: u64| -> serde_json::Value {
            let content_len = ((tokens as f64) * 0.75) as usize;
            let content = "A".repeat(content_len.max(100));
            serde_json::json!({
                "model": model,
                "messages": [{"role": "user", "content": content}],
                "max_tokens": 32,
            })
        };
        // Continuous exponential up: claimed, claimed*2, claimed*4, claimed*8, ... until fail or ceiling
        let ceiling = 10_000_000u64; // 10M tokens hard cap
        let mut last_ok = claimed;
        let mut test = claimed;
        loop {
            if self.is_cancelled() {
                self.emit(ProbeEvent::info("ctx", "cancelled", &format!("at test={}", test)));
                break;
            }
            let r = self.client.post(&url).headers(headers.clone()).json(&build_body(test)).send();
            match r {
                Ok(resp) if resp.status().is_success() => {
                    self.emit(ProbeEvent::info("ctx", "ok", &format!("test={} status=200", test)));
                    last_ok = test;
                    let next = test.saturating_mul(2);
                    if next > ceiling || next == test {
                        self.emit(ProbeEvent::info("ctx", "ceiling", &format!("hit ceiling={}", ceiling)));
                        break;
                    }
                    test = next;
                }
                Ok(resp) => {
                    let s = resp.status().as_u16();
                    self.emit(ProbeEvent::info("ctx", "fail", &format!("test={} status={}", test, s)));
                    if test <= claimed { return Some(last_ok); }
                    // Bisect [last_ok, test]
                    let mut lo = last_ok;
                    let mut hi = test;
                    while hi.saturating_sub(lo) > 1024 {
                        let mid = (lo + hi) / 2;
                        let r2 = self.client.post(&url).headers(headers.clone()).json(&build_body(mid)).send();
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
        let model = self.model.clone();
        let build_body = |mt: u64| -> serde_json::Value {
            serde_json::json!({
                "model": model,
                "messages": [{"role": "user", "content": "OK"}],
                "max_tokens": mt,
            })
        };
        // Continuous exponential up: claimed, claimed*2, claimed*4, ... until fail or ceiling
        let ceiling = 1_000_000u64; // 1M tokens hard cap (output is usually smaller than ctx)
        let mut last_ok = claimed;
        let mut test = claimed;
        loop {
            if self.is_cancelled() {
                self.emit(ProbeEvent::info("max_tokens", "cancelled", &format!("at test={}", test)));
                break;
            }
            let r = self.client.post(&url).headers(headers.clone()).json(&build_body(test)).send();
            match r {
                Ok(resp) if resp.status().is_success() => {
                    self.emit(ProbeEvent::info("max_tokens", "ok", &format!("mt={} status=200", test)));
                    last_ok = test;
                    let next = test.saturating_mul(2);
                    if next > ceiling || next == test {
                        self.emit(ProbeEvent::info("max_tokens", "ceiling", &format!("hit ceiling={}", ceiling)));
                        break;
                    }
                    test = next;
                }
                Ok(resp) => {
                    let s = resp.status().as_u16();
                    self.emit(ProbeEvent::info("max_tokens", "fail", &format!("mt={} status={}", test, s)));
                    if test <= claimed { return Some(last_ok); }
                    let mut lo = last_ok;
                    let mut hi = test;
                    while hi.saturating_sub(lo) > 512 {
                        let mid = (lo + hi) / 2;
                        let r2 = self.client.post(&url).headers(headers.clone()).json(&build_body(mid)).send();
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
        if self.is_cancelled() {
            self.emit(ProbeEvent::info("text", "cancelled", "user cancelled"));
            return caps;
        }

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
        if self.is_cancelled() {
            self.emit(ProbeEvent::info("image", "cancelled", "user cancelled"));
            return caps;
        }

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
        if self.is_cancelled() {
            self.emit(ProbeEvent::info("audio", "cancelled", "user cancelled"));
            return caps;
        }

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
        if self.is_cancelled() {
            self.emit(ProbeEvent::info("video", "cancelled", "user cancelled"));
            return caps;
        }

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
                // Real video support = reply mentions the actual content (red frame).
                // Just "video" alone = fake-positive (model echoes the prompt).
                let red_hit = reply_contains_any(&txt, &[&["red","\u{7ea2}\u{8272}","saturated","crimson","scarlet"]]);
                let echo_hit = reply_contains_any(&txt, &[&["video","\u{89c6}\u{9891}","frame","play","image","mp4"]]);
                let v = red_hit.is_some();
                caps.video = Some(v);
                self.emit(ProbeEvent::info("video", if v {"ok"} else {"fail"}, &format!("red={:?} echo={:?}", red_hit, echo_hit)));
            }
            Ok(r) => { caps.video = Some(false); self.emit(ProbeEvent::fail("video", &format!("status={}", r.status().as_u16()))); }
            Err(e) => { caps.video = Some(false); self.emit(ProbeEvent::fail("video", &format!("err={}", e))); }
        }


        // 5. function (one tool, tool_choice=required, check tool_calls present)
        if self.is_cancelled() {
            self.emit(ProbeEvent::info("function", "cancelled", "user cancelled"));
            return caps;
        }

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
        if self.is_cancelled() {
            self.emit(ProbeEvent::info("reasoning", "cancelled", "user cancelled"));
            return caps;
        }

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
            if self.is_cancelled() {
                self.emit(ProbeEvent::info(*name, "cancelled", "user cancelled"));
                return caps;
            }
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

}

