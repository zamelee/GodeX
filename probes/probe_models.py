#!/usr/bin/env python3
"""Probe MiniMax model behavior on direct API + via GodeX."""
from __future__ import annotations
import asyncio, json, os, sys, time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
import httpx

API_KEY = os.environ.get("MINIMAX_API_KEY")
BASE_URL = os.environ.get("MINIMAX_BASE_URL", "https://minnimax.chat/v1")
GODEX_URL = os.environ.get("GODEX_URL", "http://127.0.0.1:5678/v1")
GODEX_API_KEY = os.environ.get("GODEX_API_KEY", "probe-no-auth")
MODELS = ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M3"]
PROBES_DIR = Path(__file__).resolve().parent
TIMEOUT_SECONDS = 120.0

DIRECT_MODEL_NAME = {m: m for m in MODELS}
GODEX_MODEL_NAME = {
    "MiniMax-M2.7": "minnimax.chat/MiniMax-M2.7",
    "MiniMax-M2.7-highspeed": "minnimax.chat/MiniMax-M2.7-highspeed",
    "MiniMax-M3": "minnimax.chat/MiniMax-M3",
}

# Tool schemas shared across tests
WEATHER_TOOL = {"type":"function","function":{"name":"get_weather","description":"获取指定城市的当前天气","parameters":{"type":"object","properties":{"city":{"type":"string","description":"城市名"}},"required":["city"],"additionalProperties":False}}}

MCP_LIST_PAGES_TOOL = {"type":"function","function":{"name":"mcp__chrome_devtools__list_pages","description":"List all pages open in the browser.","parameters":{"type":"object","properties":{},"additionalProperties":True}}}

MCP_NAVIGATE_TOOL = {"type":"function","function":{"name":"mcp__chrome_devtools__navigate_page","description":"Navigate the browser to a URL.","parameters":{"type":"object","properties":{"url":{"type":"string","description":"The URL to navigate to."}},"required":["url"],"additionalProperties":True}}}

MCP_SNAPSHOT_TOOL = {"type":"function","function":{"name":"mcp__chrome_devtools__take_snapshot","description":"Take an accessibility tree snapshot.","parameters":{"type":"object","properties":{},"additionalProperties":True}}}

RESPONSES_MCP_TOOL = {"type":"mcp","server_label":"chrome-devtools","server_url":"http://127.0.0.1:9222","allowed_tools":["list_pages"],"headers":{}}

RESPONSES_MCP_TOOL_MULTI = {"type":"mcp","server_label":"chrome-devtools","server_url":"http://127.0.0.1:9222","allowed_tools":["list_pages","navigate_page"],"headers":{}}


# Responses API format tools (used for godex path)
WEATHER_TOOL_GODEX = {"type":"function","name":"get_weather","description":"获取指定城市的当前天气","parameters":{"type":"object","properties":{"city":{"type":"string","description":"城市名"}},"required":["city"],"additionalProperties":False},"strict":True}
MCP_LIST_PAGES_TOOL_GODEX = {"type":"function","name":"mcp__chrome_devtools__list_pages","description":"List all pages open in the browser.","parameters":{"type":"object","properties":{},"additionalProperties":True},"strict":False}
MCP_NAVIGATE_TOOL_GODEX = {"type":"function","name":"mcp__chrome_devtools__navigate_page","description":"Navigate the browser to a URL.","parameters":{"type":"object","properties":{"url":{"type":"string","description":"The URL to navigate to."}},"required":["url"],"additionalProperties":True},"strict":False}
MCP_SNAPSHOT_TOOL_GODEX = {"type":"function","name":"mcp__chrome_devtools__take_snapshot","description":"Take an accessibility tree snapshot.","parameters":{"type":"object","properties":{},"additionalProperties":True},"strict":False}


# ---------------------------------------------------------------------------
# Test definitions
# ---------------------------------------------------------------------------

def T01_baseline(model):
    """T01: simple text completion, no tools."""
    direct = {"model":DIRECT_MODEL_NAME[model],"messages":[{"role":"user","content":"用一句话介绍你自己（不超过 30 字）。"}],"max_tokens":100,"temperature":0.0}
    godex = {"model":GODEX_MODEL_NAME[model],"input":"用一句话介绍你自己（不超过 30 字）。","max_output_tokens":100,"temperature":0.0}
    return direct, godex

def T02_basic_function(model):
    """T02: plain function calling. Confirms name preservation."""
    direct = {"model":DIRECT_MODEL_NAME[model],"messages":[{"role":"user","content":"北京今天天气怎么样？请调用工具查一下。"}],"tools":[WEATHER_TOOL],"tool_choice":"auto","temperature":0.0}
    godex = {"model":GODEX_MODEL_NAME[model],"input":"北京今天天气怎么样？请调用工具查一下。","tools":[WEATHER_TOOL],"tool_choice":"auto","temperature":0.0}
    godex["tools"] = [WEATHER_TOOL_GODEX]
    return direct, godex

def T03_mcp_naming(model):
    """T03: KEY TEST. function named mcp__server__tool. Does model emit tool_call with that exact name?"""
    direct = {"model":DIRECT_MODEL_NAME[model],"messages":[{"role":"user","content":"请调用工具列出 Chrome 浏览器当前打开的所有标签页。"}],"tools":[MCP_LIST_PAGES_TOOL],"tool_choice":"auto","temperature":0.0}
    godex = {"model":GODEX_MODEL_NAME[model],"input":"请调用工具列出 Chrome 浏览器当前打开的所有标签页。","tools":[MCP_LIST_PAGES_TOOL],"tool_choice":"auto","temperature":0.0}
    godex["tools"] = [MCP_LIST_PAGES_TOOL_GODEX]
    return direct, godex

def T04_multi_mcp(model):
    """T04: multiple MCP tools. Does model pick the right one with right name?"""
    tools = [MCP_LIST_PAGES_TOOL, MCP_NAVIGATE_TOOL, MCP_SNAPSHOT_TOOL]
    direct = {"model":DIRECT_MODEL_NAME[model],"messages":[{"role":"user","content":"打开 https://example.com 这个网址。"}],"tools":tools,"tool_choice":"auto","temperature":0.0}
    godex = {"model":GODEX_MODEL_NAME[model],"input":"打开 https://example.com 这个网址。","tools":[MCP_LIST_PAGES_TOOL_GODEX, MCP_NAVIGATE_TOOL_GODEX, MCP_SNAPSHOT_TOOL_GODEX],"tool_choice":"auto","temperature":0.0}
    return direct, godex

def T05_multi_turn(model):
    """T05: ask model to navigate, then we feed back a synthetic tool result. Tests multi-turn loop."""
    tools = [MCP_NAVIGATE_TOOL]
    direct = {"model":DIRECT_MODEL_NAME[model],"messages":[{"role":"user","content":"请打开 https://example.com"}],"tools":tools,"tool_choice":"auto","temperature":0.0}
    godex = {"model":GODEX_MODEL_NAME[model],"input":"请打开 https://example.com","tools":[MCP_NAVIGATE_TOOL_GODEX],"tool_choice":"auto","temperature":0.0}
    return direct, godex

def T06_streaming_tool(model):
    """T06: streaming variant of T03. Examines SSE chunks for tool_call deltas."""
    direct = {"model":DIRECT_MODEL_NAME[model],"messages":[{"role":"user","content":"请调用工具列出 Chrome 浏览器当前打开的所有标签页。"}],"tools":[MCP_LIST_PAGES_TOOL],"tool_choice":"auto","stream":True,"temperature":0.0}
    godex = {"model":GODEX_MODEL_NAME[model],"input":"请调用工具列出 Chrome 浏览器当前打开的所有标签页。","tools":[MCP_LIST_PAGES_TOOL],"tool_choice":"auto","stream":True,"temperature":0.0}
    godex["tools"] = [MCP_LIST_PAGES_TOOL_GODEX]
    return direct, godex

def T07_native_mcp_godex_only(model):
    """T07: Responses API native mcp type via GodeX. Direct Chat Completions cannot accept this type."""
    godex = {"model":GODEX_MODEL_NAME[model],"input":"请列出当前 Chrome 浏览器打开的页面。","tools":[RESPONSES_MCP_TOOL]}
    return None, godex



def T08_native_mcp_collapsed(model):
    """T08: Responses API native mcp type with MULTIPLE allowed_tools.
    Expect GodeX to:
      1) expand into N function declarations on the upstream wire (mcp__server__tool names)
      2) reconstruct the upstream tool_call back as Responses mcp_call output items
    Direct Chat Completions cannot accept the native mcp type, so this is godex-only."""
    godex = {"model":GODEX_MODEL_NAME[model],"input":"please first list the chrome tabs then open https://example.com","tools":[RESPONSES_MCP_TOOL_MULTI]}
    return None, godex


# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------

REDACT_KEYS = {"api_key", "authorization", "x-api-key"}

def redact(value):
    """Recursively redact anything that looks like a secret."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if k.lower() in REDACT_KEYS:
                out[k] = "<redacted>"
            else:
                out[k] = redact(v)
        return out
    if isinstance(value, list):
        return [redact(x) for x in value]
    return value

def safe_filename(s):
    return s.replace("/", "_").replace("\\", "_").replace(":", "-")

def write_log(model, test_id, test_name, path, log):
    model_dir = PROBES_DIR / safe_filename(model)
    model_dir.mkdir(parents=True, exist_ok=True)
    file_path = model_dir / f"{test_id}_{test_name}_{path}.json"
    file_path.write_text(json.dumps(redact(log), indent=2, ensure_ascii=False), encoding="utf-8")
    return file_path

def find_assistant_tool_calls(chat_resp):
    choices = chat_resp.get("choices") or []
    if not choices:
        return []
    msg = choices[0].get("message") or {}
    return msg.get("tool_calls") or []

def build_followup_chat(initial, tool_results):
    followup = json.loads(json.dumps(initial))
    followup["messages"] = list(initial["messages"]) + [
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [{
                "id": tr["call_id"],
                "type": "function",
                "function": {"name": tr["name"], "arguments": tr["arguments"]},
            } for tr in tool_results],
        },
        *[{
            "role": "tool",
            "tool_call_id": tr["call_id"],
            "content": tr["content"],
        } for tr in tool_results]
    ]
    return followup


# ---------------------------------------------------------------------------
# HTTP runners
# ---------------------------------------------------------------------------

async def run_non_stream(client, url, headers, payload):
    start = time.perf_counter()
    resp = await client.post(url, json=payload, headers=headers)
    duration_ms = int((time.perf_counter() - start) * 1000)
    try:
        body = resp.json()
    except Exception:
        body = {"_raw_text": resp.text}
    return {
        "status_code": resp.status_code,
        "duration_ms": duration_ms,
        "response_headers": dict(resp.headers),
        "response_body": body,
    }

async def run_stream(client, url, headers, payload):
    start = time.perf_counter()
    chunks = []
    raw_lines = []
    status_code = 0
    response_headers = {}
    async with client.stream("POST", url, json=payload, headers=headers) as resp:
        status_code = resp.status_code
        response_headers = dict(resp.headers)
        async for line in resp.aiter_lines():
            raw_lines.append(line)
            if not line.startswith("data:"):
                continue
            data = line[len("data:"):].strip()
            if not data or data == "[DONE]":
                continue
            try:
                chunks.append(json.loads(data))
            except json.JSONDecodeError:
                chunks.append({"_unparsed": data})
    duration_ms = int((time.perf_counter() - start) * 1000)
    return {
        "status_code": status_code,
        "duration_ms": duration_ms,
        "response_headers": response_headers,
        "stream_chunks": chunks,
        "stream_raw_lines": raw_lines,
    }

async def run_chat_completions(client, payload):
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    url = f"{BASE_URL.rstrip(chr(47))}/chat/completions"
    if payload.get("stream"):
        result = await run_stream(client, url, headers, payload)
    else:
        result = await run_non_stream(client, url, headers, payload)
    return {"endpoint": url, **result}

async def run_godex_responses(client, payload):
    headers = {"Authorization": f"Bearer {GODEX_API_KEY}", "Content-Type": "application/json"}
    url = f"{GODEX_URL.rstrip(chr(47))}/responses"
    if payload.get("stream"):
        result = await run_stream(client, url, headers, payload)
    else:
        result = await run_non_stream(client, url, headers, payload)
    return {"endpoint": url, **result}


# ---------------------------------------------------------------------------
# Per-test execution
# ---------------------------------------------------------------------------

SPECS = [
    ("T01", "baseline", T01_baseline, False),
    ("T02", "basic_function", T02_basic_function, False),
    ("T03", "mcp_naming", T03_mcp_naming, False),
    ("T04", "multi_mcp", T04_multi_mcp, False),
    ("T05", "multi_turn_loop", T05_multi_turn, True),
    ("T06", "streaming_tool_delta", T06_streaming_tool, False),
    ("T07", "native_mcp_godex", T07_native_mcp_godex_only, False),
    ("T08", "native_mcp_collapsed", T08_native_mcp_collapsed, False),
]

def quick_findings(test_id, response):
    out = []
    if not response:
        return ["no response captured"]
    body = response.get("response_body") or {}
    if test_id == "T01":
        text = (body.get("choices") or [{}])[0].get("message", {}).get("content", "")
        if isinstance(text, list):
            text = "".join(p.get("text", "") for p in text if isinstance(p, dict))
        out.append(f"reply_chars={len(text or '')}")
        out.append(f"reply_preview={(text or '')[:60]!r}")
    elif test_id in ("T02", "T03", "T04", "T05"):
        calls = find_assistant_tool_calls(body)
        out.append(f"tool_calls_count={len(calls)}")
        for i, c in enumerate(calls):
            fn = c.get("function") or {}
            name = fn.get("name")
            args = fn.get("arguments")
            out.append(f"call[{i}].name={name!r}")
            out.append(f"call[{i}].arguments={args!r}")
    elif test_id == "T06":
        chunks = response.get("stream_chunks") or []
        tool_delta_chunks = []
        for c in chunks:
            choices = c.get("choices") or [{}]
            for ch in choices:
                if "tool_calls" in (ch.get("delta") or {}):
                    tool_delta_chunks.append(c)
                    break
        out.append(f"total_chunks={len(chunks)}")
        out.append(f"tool_delta_chunks={len(tool_delta_chunks)}")
        if tool_delta_chunks:
            first = tool_delta_chunks[0]
            choices = first.get("choices") or [{}]
            delta = (choices[0].get("delta") or {}) if choices else {}
            tcs = delta.get("tool_calls") or []
            if tcs:
                fn = tcs[0].get("function") or {}
                out.append(f"first_tool_delta.name={fn.get('name')!r}")
                out.append(f"first_tool_delta.args={fn.get('arguments')!r}")
    elif test_id == "T07":
        out.append(f"output_type={type(body.get('output')).__name__}")
        out.append(f"error={body.get('error')}")
    elif test_id == "T08":
        out.append(f"output_type={type(body.get('output')).__name__}")
        out.append(f"error={body.get('error')}")
        output = body.get("output") or []
        mcp_calls = [it for it in output if isinstance(it, dict) and it.get("type") == "mcp_call"]
        function_calls = [it for it in output if isinstance(it, dict) and it.get("type") == "function_call"]
        out.append(f"mcp_call_count={len(mcp_calls)}")
        out.append(f"function_call_count={len(function_calls)}")
        for i, call in enumerate(mcp_calls):
            out.append(f"mcp_call[{i}].server_label={call.get('server_label')!r}")
            out.append(f"mcp_call[{i}].name={call.get('name')!r}")
            out.append(f"mcp_call[{i}].arguments={call.get('arguments')!r}")
            out.append(f"mcp_call[{i}].status={call.get('status')!r}")
    return out

async def execute_test(client, spec, model, timestamp):
    test_id, test_name, test_fn, multi_turn = spec
    direct_payload, godex_payload = test_fn(model)
    rows = []

    for path, payload, runner in (
        ("direct", direct_payload, run_chat_completions),
        ("godex", godex_payload, run_godex_responses),
    ):
        if payload is None:
            continue
        log = {
            "test_id": test_id,
            "test_name": test_name,
            "model": model,
            "path": path,
            "timestamp": timestamp,
            "request_payload": payload,
            "response": None,
            "followups": [],
            "error": None,
        }
        try:
            response = await runner(client, payload)
            log["response"] = response

            if multi_turn and path == "direct" and (response.get("response_body") or {}).get("choices"):
                calls = find_assistant_tool_calls(response["response_body"])
                if calls:
                    tool_results = [
                        {
                            "call_id": c.get("id", f"call_{i}"),
                            "name": (c.get("function") or {}).get("name", "?"),
                            "arguments": (c.get("function") or {}).get("arguments", "{}"),
                            "content": "OK, navigation complete. Page title: Example Domain.",
                        }
                        for i, c in enumerate(calls)
                    ]
                    followup_payload = build_followup_chat(payload, tool_results)
                    followup = await runner(client, followup_payload)
                    log["followups"].append({
                        "note": "synthetic tool result fed back as user/tool turn",
                        "request_payload": followup_payload,
                        "response": followup,
                    })
        except Exception as exc:
            log["error"] = f"{type(exc).__name__}: {exc}"

        write_log(model, test_id, test_name, path, log)

        status = "error" if log["error"] else "success"
        findings = quick_findings(test_id, log["response"]) if not log["error"] else [log["error"]]
        rows.append({
            "test_id": test_id,
            "model": model,
            "path": path,
            "status": status,
            "duration_ms": (log["response"] or {}).get("duration_ms", 0),
            "findings": findings,
        })
    return rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main():
    if not API_KEY:
        print("ERROR: MINIMAX_API_KEY env var not set.", file=sys.stderr)
        return 2

    timestamp = datetime.now(timezone.utc).isoformat()
    print(f"[probe] starting at {timestamp}")
    print(f"[probe] direct base url : {BASE_URL}")
    print(f"[probe] GodeX base url  : {GODEX_URL}")
    print(f"[probe] models          : {MODELS}")

    summary_rows = []
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
        for model in MODELS:
            print(f"\n[probe] === {model} ===")
            for spec in SPECS:
                rows = await execute_test(client, spec, model, timestamp)
                summary_rows.extend(rows)
                for row in rows:
                    marker = "OK" if row["status"] == "success" else "ERR"
                    print(f"  [{marker}] {row['test_id']}/{row['path']:<6} {row['duration_ms']:>6}ms")

    summary = {
        "timestamp": timestamp,
        "direct_base_url": BASE_URL,
        "godex_base_url": GODEX_URL,
        "models": MODELS,
        "tests": summary_rows,
    }
    summary_path = PROBES_DIR / "summary.json"
    summary_path.write_text(json.dumps(redact(summary), indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[probe] summary written to {summary_path}")
    print(f"[probe] per-test logs under {PROBES_DIR}/<model>/")
    return 0

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
