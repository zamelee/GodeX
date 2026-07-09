"""
minnimax.chat /v1/messages (Anthropic Messages API) capability probe.

Tests each model for:
  1. Plain text chat
  2. Single tool call
  3. Multi-turn with tool_result feedback
  4. Parallel tool calls (multiple in one response)
  5. Image (vision) input
  6. Streaming behavior (does it actually stream?)

Outputs:
  probes/anthropic-probe-{model}.json  full raw per-test
  probes/anthropic-probe-summary.json matrix
"""
import json, os, sys, time, urllib.request, urllib.error
from pathlib import Path

API_KEY = os.environ.get("MINIMAX_API_KEY")
if not API_KEY:
    print("MINIMAX_API_KEY not set", file=sys.stderr); sys.exit(1)

BASE = "https://minnimax.chat/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
MODELS = ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"]

OUT_DIR = Path("probes"); OUT_DIR.mkdir(exist_ok=True)

def call(messages, *, model, tools=None, max_tokens=512, stream=False, system=None):
    body = {"model": model, "max_tokens": max_tokens, "messages": messages}
    if tools: body["tools"] = tools
    if system: body["system"] = system
    headers = {
        "x-api-key": API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
    }
    if stream: headers["accept"] = "text/event-stream"
    req = urllib.request.Request(BASE, data=json.dumps(body).encode(), headers=headers, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
            return {"status": resp.status, "body": data.decode("utf-8", errors="replace"),
                    "elapsed_ms": int((time.time()-t0)*1000),
                    "content_type": resp.headers.get("Content-Type", "")}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "body": e.read().decode("utf-8", errors="replace"),
                "elapsed_ms": int((time.time()-t0)*1000), "error": str(e)}
    except Exception as e:
        return {"status": None, "body": "", "elapsed_ms": int((time.time()-t0)*1000), "error": str(e)}

TOOL_GET_WEATHER = {
    "name": "get_weather",
    "description": "Get the current weather for a location.",
    "input_schema": {
        "type": "object",
        "properties": {"location": {"type": "string"}},
        "required": ["location"]
    }
}
TOOL_LIST_PAGES = {
    "name": "list_browser_pages",
    "description": "List currently open browser tabs.",
    "input_schema": {"type": "object", "properties": {}, "required": []}
}

# 1x1 transparent PNG
TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

def safe_text(obj):
    if not obj: return None
    for c in obj.get("content", []):
        if c.get("type") == "text": return c.get("text")
    return None

def safe_tool_uses(obj):
    if not obj: return []
    return [c for c in obj.get("content", []) if c.get("type") == "tool_use"]

def parse_json_safe(s):
    try: return json.loads(s)
    except: return None

summary = {}

for model in MODELS:
    print(f"\n=== {model} ===")
    summary[model] = {}
    raw = []

    # T1 plain chat
    r = call([{"role": "user", "content": "回复 OK 即可"}], model=model, max_tokens=20)
    raw.append({"test": "plain_chat", **r})
    obj = parse_json_safe(r["body"])
    text = safe_text(obj)
    ok = r["status"] == 200 and text is not None
    summary[model]["plain_chat"] = {"ok": ok, "status": r["status"], "text": text}
    print(f"  T1 plain_chat: status={r['status']} ok={ok} text={text!r}")

    # T2 single tool call
    r = call(
        [{"role": "user", "content": "东京现在天气怎么样?请调用工具"}],
        model=model, tools=[TOOL_GET_WEATHER], max_tokens=300,
    )
    raw.append({"test": "tool_call", **r})
    obj = parse_json_safe(r["body"])
    tu = safe_tool_uses(obj)
    stop_reason = obj.get("stop_reason") if obj else None
    summary[model]["tool_call"] = {
        "ok": r["status"] == 200 and len(tu) >= 1,
        "status": r["status"],
        "stop_reason": stop_reason,
        "tool_use_count": len(tu),
        "tool_use_names": [b.get("name") for b in tu],
        "first_input": tu[0].get("input") if tu else None,
    }
    print(f"  T2 tool_call: status={r['status']} stop_reason={stop_reason} tool_uses={len(tu)}")

    # T3 multi-turn with tool_result
    if tu:
        msgs = [
            {"role": "user", "content": "东京现在天气怎么样?请调用工具"},
            {"role": "assistant", "content": tu},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tu[0]["id"], "content": "东京: 22°C, 晴, 湿度 60%"}]},
        ]
        r = call(msgs, model=model, tools=[TOOL_GET_WEATHER], max_tokens=300)
        raw.append({"test": "tool_result_feedback", **r})
        obj = parse_json_safe(r["body"])
        text = safe_text(obj)
        ok = r["status"] == 200 and text is not None
        summary[model]["tool_result_feedback"] = {
            "ok": ok, "status": r["status"],
            "text_snippet": (text[:120] + "...") if text and len(text) > 120 else text,
        }
        print(f"  T3 tool_result: status={r['status']} ok={ok}")

    # T4 parallel tool calls
    r = call(
        [{"role": "user", "content": "查询北京、上海、深圳的天气,并告诉我当前打开了哪些浏览器标签"}],
        model=model, tools=[TOOL_GET_WEATHER, TOOL_LIST_PAGES], max_tokens=500,
    )
    raw.append({"test": "parallel_tools", **r})
    obj = parse_json_safe(r["body"])
    tu = safe_tool_uses(obj)
    summary[model]["parallel_tools"] = {
        "ok": r["status"] == 200 and len(tu) >= 2,
        "status": r["status"],
        "tool_use_count": len(tu),
        "names": [b.get("name") for b in tu],
    }
    print(f"  T4 parallel: status={r['status']} tool_uses={len(tu)}")

    # T5 image input
    r = call(
        [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": TINY_PNG_B64}},
            {"type": "text", "text": "这张图是什么颜色?"}
        ]}],
        model=model, max_tokens=100,
    )
    raw.append({"test": "image_input", **r})
    obj = parse_json_safe(r["body"])
    text = safe_text(obj)
    summary[model]["image_input"] = {
        "ok": r["status"] == 200 and text is not None,
        "status": r["status"],
        "text": text,
        "error_msg": obj.get("error", {}).get("message") if obj and obj.get("error") else None,
    }
    print(f"  T5 image: status={r['status']} text={(text or '')[:50]!r}")

    # T6 streaming behavior - does it actually stream?
    r = call([{"role": "user", "content": "数到5"}], model=model, max_tokens=30, stream=True)
    raw.append({"test": "streaming", **r})
    sse_events = []
    for line in r["body"].splitlines():
        if line.startswith("event: "):
            sse_events.append(line[7:].strip())
    is_actually_sse = "text/event-stream" in r.get("content_type", "")
    is_json_with_sse_headers = r["status"] == 200 and not is_actually_sse and r["body"].strip().startswith("{")
    summary[model]["streaming"] = {
        "ok": r["status"] == 200,
        "status": r["status"],
        "content_type": r.get("content_type"),
        "is_actually_sse": is_actually_sse,
        "is_full_json_not_streamed": is_json_with_sse_headers,
        "sse_event_types_seen": sse_events[:10],
    }
    print(f"  T6 stream: status={r['status']} ct={r.get('content_type')} sse={is_actually_sse} json_full={is_json_with_sse_headers}")

    Path(OUT_DIR, f"anthropic-probe-{model}.json").write_text(
        json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")

Path(OUT_DIR, "anthropic-probe-summary.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

print("\n=== SUMMARY ===")
print(json.dumps(summary, ensure_ascii=False, indent=2))
