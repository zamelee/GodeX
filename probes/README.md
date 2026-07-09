# Probe output

Each per-test execution writes a JSON file capturing the **full** request
payload, full response body, selected response headers, HTTP status, and
duration. `summary.json` aggregates one row per (model, test, path) with
the key facts surfaced (`tool_calls_count`, `call[*].name`, etc.).

## Quick look

- `summary.json` — read this first
- `MiniMax-M*/T0*_<name>_<path>.json` — full payloads for each test

## Tests

| ID | What it probes | Why it matters |
|----|----------------|----------------|
| T01 | baseline text completion | Confirms API key + network |
| T02 | basic function calling | Confirms function name is preserved |
| T03 | function named `mcp__chrome_devtools__list_pages` | KEY TEST: does the model keep the `mcp__` prefix? |
| T04 | three MCP tools at once | Does the model pick the right one? |
| T05 | multi-turn: tool_call -> tool_result -> continue | Does the model accept synthetic results and continue? |
| T06 | streaming variant of T03 | Inspect SSE chunks for tool_call deltas |
| T07 | Responses API native `type:"mcp"` via GodeX | Does upstream pass through, reject, or misrender? |

## Paths

- `direct` — POST to `https://api.minimaxi.com/v1/chat/completions`
- `godex`  — POST to `http://127.0.0.1:5678/v1/responses` (GodeX must be running)
