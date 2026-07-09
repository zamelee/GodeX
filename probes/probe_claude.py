#!/usr/bin/env python3
"""Probe MiniMax model behavior via Claude/Anthropic format vs Chat API.

Compares direct API behavior on:
  - Chat Completions format:  https://minnimax.chat/v1/chat/completions
  - Claude/Anthropic format: https://minnimax.chat/v1/messages

Goal: determine whether both formats work the same, and whether the model
treats MCP-style mcp__server__tool naming consistently across formats.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx

API_KEY = os.environ.get("MINIMAX_API_KEY")
CHAT_URL = "https://minnimax.chat/v1/chat/completions"
CLAUDE_URL = "https://minnimax.chat/v1/messages"

MODELS = ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M3"]
PROBES_DIR = Path(__file__).resolve().parent
TIMEOUT_SECONDS = 120.0

# Chat Completions tools (function.parameters shape)
CHAT_WEATHER = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string", "description": "City name"}},
            "required": ["city"],
            "additionalProperties": False,
        },
    },
}
CHAT_MCP_NAVIGATE = {
    "type": "function",
    "function": {
        "name": "mcp__chrome_devtools__navigate_page",
        "description": "Navigate the browser to a URL",
        "parameters": {
            "type": "object",
            "properties": {"url": {"type": "string", "description": "URL"}},
            "required": ["url"],
            "additionalProperties": True,
        },
    },
}

# Claude/Anthropic tools (input_schema shape)
CLAUDE_WEATHER = {
    "name": "get_weather",
    "description": "Get the current weather for a city",
    "input_schema": {
        "type": "object",
        "properties": {"city": {"type": "string", "description": "City name"}},
        "required": ["city"],
    },
}
CLAUDE_MCP_NAVIGATE = {
    "name": "mcp__chrome_devtools__navigate_page",
    "description": "Navigate the browser to a URL",
    "input_schema": {
        "type": "object",
        "properties": {"url": {"type": "string", "description": "URL"}},
        "required": ["url"],
    },
}


def T01_baseline(model):
    chat = {"model": model, "messages": [{"role": "user", "content": "用一句话介绍你自己"}], "max_tokens": 200, "temperature": 0}
    claude = {"model": model, "max_tokens": 200, "messages": [{"role": "user", "content": "用一句话介绍你自己"}]}
    return chat, claude

def T02_basic_function(model):
    chat = {"model": model, "messages": [{"role": "user", "content": "What's the weather in Tokyo? Use the tool."}], "tools": [CHAT_WEATHER], "tool_choice": "auto", "temperature": 0}
    claude = {"model": model, "max_tokens": 500, "messages": [{"role": "user", "content": "What's the weather in Tokyo? Use the tool."}], "tools": [CLAUDE_WEATHER]}
    return chat, claude

def T03_mcp_naming(model):
    chat = {"model": model, "messages": [{"role": "user", "content": "Use the tool to navigate to https://example.com"}], "tools": [CHAT_MCP_NAVIGATE], "tool_choice": "auto", "temperature": 0}
    claude = {"model": model, "max_tokens": 500, "messages": [{"role": "user", "content": "Use the tool to navigate to https://example.com"}], "tools": [CLAUDE_MCP_NAVIGATE]}
    return chat, claude


def redact(value):
    keys = {"api_key", "authorization", "x-api-key", "anthropic-api-key"}
    if isinstance(value, dict):
        return {(k if k.lower() not in keys else k): ("<redacted>" if k.lower() in keys else redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(x) for x in value]
    return value


def safe_filename(s):
    return s.replace("/", "_").replace("\\", "_").replace(":", "-")


async def run_chat(client, payload):
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    start = time.perf_counter()
    try:
        resp = await client.post(CHAT_URL, json=payload, headers=headers)
        body = resp.json()
    except Exception as e:
        return {"status_code": 0, "duration_ms": int((time.perf_counter()-start)*1000), "error": f"{type(e).__name__}: {e}"}
    duration_ms = int((time.perf_counter() - start) * 1000)
    # extract tool_calls
    calls = []
    for choice in (body.get("choices") or []):
        for c in (choice.get("message", {}).get("tool_calls") or []):
            fn = c.get("function") or {}
            calls.append({"name": fn.get("name"), "arguments": fn.get("arguments")})
    return {"status_code": resp.status_code, "duration_ms": duration_ms, "response_body": body, "tool_calls": calls}


async def run_claude(client, payload):
    headers = {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    start = time.perf_counter()
    try:
        resp = await client.post(CLAUDE_URL, json=payload, headers=headers)
        body = resp.json()
    except Exception as e:
        return {"status_code": 0, "duration_ms": int((time.perf_counter()-start)*1000), "error": f"{type(e).__name__}: {e}"}
    duration_ms = int((time.perf_counter() - start) * 1000)
    # extract tool_use blocks
    calls = []
    for block in (body.get("content") or []):
        if block.get("type") == "tool_use":
            calls.append({"id": block.get("id"), "name": block.get("name"), "input": block.get("input")})
    return {"status_code": resp.status_code, "duration_ms": duration_ms, "response_body": body, "tool_calls": calls}


def find_assistant_text(chat_body):
    msg = (chat_body.get("choices") or [{}])[0].get("message", {})
    return msg.get("content", "")


def find_assistant_text_claude(claude_body):
    parts = []
    for block in (claude_body.get("content") or []):
        if block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "".join(parts)


SPECS = [
    ("T01", "baseline", T01_baseline),
    ("T02", "basic_function", T02_basic_function),
    ("T03", "mcp_naming", T03_mcp_naming),
]


async def main():
    if not API_KEY:
        print("ERROR: MINIMAX_API_KEY env var not set.", file=sys.stderr)
        return 2
    timestamp = datetime.now(timezone.utc).isoformat()
    print(f"[claude-probe] starting at {timestamp}")
    print(f"[claude-probe] Chat URL  : {CHAT_URL}")
    print(f"[claude-probe] Claude URL: {CLAUDE_URL}")
    print(f"[claude-probe] models    : {MODELS}")

    summary_rows = []
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
        for model in MODELS:
            print(f"\n[claude-probe] === {model} ===")
            for test_id, test_name, test_fn in SPECS:
                chat_payload, claude_payload = test_fn(model)
                model_dir = PROBES_DIR / safe_filename(f"{model}__claude_compare")
                model_dir.mkdir(parents=True, exist_ok=True)
                log = {
                    "test_id": test_id, "test_name": test_name, "model": model,
                    "timestamp": timestamp,
                    "chat_request": chat_payload, "claude_request": claude_payload,
                    "chat_result": None, "claude_result": None,
                }
                chat_res = await run_chat(client, chat_payload)
                claude_res = await run_claude(client, claude_payload)
                log["chat_result"] = chat_res
                log["claude_result"] = claude_res
                log_path = model_dir / f"{test_id}_{test_name}.json"
                log_path.write_text(json.dumps(redact(log), indent=2, ensure_ascii=False), encoding="utf-8")
                chat_calls = chat_res.get("tool_calls") or []
                claude_calls = claude_res.get("tool_calls") or []
                chat_text = find_assistant_text(chat_res.get("response_body") or {})
                claude_text = find_assistant_text_claude(claude_res.get("response_body") or {})
                summary_rows.append({
                    "test_id": test_id, "model": model,
                    "chat_status": chat_res.get("status_code"),
                    "claude_status": claude_res.get("status_code"),
                    "chat_tool_count": len(chat_calls),
                    "claude_tool_count": len(claude_calls),
                    "chat_tool_names": [c.get("name") for c in chat_calls],
                    "claude_tool_names": [c.get("name") for c in claude_calls],
                    "chat_text_len": len(chat_text or ""),
                    "claude_text_len": len(claude_text or ""),
                })
                print(f"  [{test_id}] chat={chat_res.get('status_code')}/{len(chat_calls)}tc  claude={claude_res.get('status_code')}/{len(claude_calls)}tc")

    summary = {
        "timestamp": timestamp,
        "chat_url": CHAT_URL,
        "claude_url": CLAUDE_URL,
        "models": MODELS,
        "results": summary_rows,
    }
    out = PROBES_DIR / "claude_compare_summary.json"
    out.write_text(json.dumps(redact(summary), indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[claude-probe] summary -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
