# Handoff — Path A/D + Anthropic Provider (2026-07-09)

> Status: **Step 1 in progress** (Path A streamable_http dry-run)
> Goal: determine whether streamable_http MCP transport bypasses codex.exe dispatcher bug; fall back to Path D if not; plan Anthropic provider either way.

---

## 1. Background

### Problem
Every Codex++ stdio MCP server returns `"unsupported call"` for any tool invocation:
- `mcp__chrome_devtools__list_pages` -> unsupported
- `mcp__node_repl__js` -> unsupported
- Both `chrome:control-chrome` and `browser:control-in-app-browser` skills dead because they depend on broken `node_repl__js`

### Root cause (identified previously)
`D:\VibeCodingSystem\CodexDesktop-Rebuild\resources\codex.exe` (no source available) routes `mcp__<server>__<tool>` calls to the `unsupported custom_tool_call` handler instead of `mcp_tool_call`. String `unsupported custom tool call: ` confirmed inside the binary.

### Path 4 (fast-patch) — already tried, partial
- In-app plugins (browser@openai-bundled, chrome@openai-bundled, computer-use@openai-bundled) repaired
- Chrome native messaging manifest fixed
- `SKY_CUA_NATIVE_PIPE` stale config removed
- `@oai/sky` .pnpm binding junction fix applied
- **Did NOT fix codex.exe dispatcher bug**

---

## 2. Process state (snapshot 2026-07-09 ~10:xx)

| PID | Process | Role | Action |
|---|---|---|---|
| 3756 | godex4.exe | Backup LLM gateway, port 5678 | KEEP - do not touch |
| 16976 | godex5.exe | Active LLM gateway, port 5679 | KEEP - user requested |
| 11120 | codex-plus-plus-manager | Codex++ launcher | KEEP |
| 20132 | codex-plus-plus | Codex++ wrapper | KEEP (user will restart when ready) |
| 1756/9516/... | Codex / codex | Codex processes | KEEP |
| 6800 | chrome (port 9222) | User pre-launched Chrome for debug | KEEP |
| (others) | chrome | Leaked chrome processes | Will NOT clean up (out of scope) |

### URLs
- `http://127.0.0.1:5679/v1/models` - GodeX Codex-compatible models endpoint (healthy)
- `http://127.0.0.1:5679/v1/responses` - GodeX Responses endpoint (healthy)
- `http://127.0.0.1:9222/json/version` - Chrome DevTools Protocol HTTP (healthy, Chrome/150.0.7871.101)
- `ws://127.0.0.1:9222/devtools/browser/<uuid>` - Chrome CDP WebSocket

### Fork vs upstream
- Fork (zamelee/GodeX) ahead of origin by 30+ commits
- Fork behind origin by 100+ commits (upstream active - needs periodic cherry-pick check)

---

## 3. Path decision

| Path | Description | Verdict |
|---|---|---|
| A | Standalone chrome-browser-mcp streamable_http process on :9224, Codex connects via url=... | TRYING (Step 1) |
| B | Patch codex.exe binary | High risk, no source. Deferred. |
| 3 | Switch upstream to Claude/Anthropic /v1/messages | Doesnt fix dispatcher bug. Planned as separate workstream to improve GodeX-upstream tool chain once A/D succeeds. |
| 4 | Fast-patch (in-app plugins) | Done. Didnt fix dispatcher. |
| D | GodeX Responses API exposes browser tools as native function tools (bypasses MCP dispatcher entirely) | FALLBACK if A fails |

### Strategy
- Step 1 (now): dry-run Path A. ~30 min. Verify whether streamable_http MCP bypasses dispatcher.
  - Pass -> keep standalone server, optionally integrate later
  - Fail -> immediately pivot to Path D
- Step 2 (parallel/follow-up): Anthropic provider for `minnimax.chat` /v1/messages (x-api-key auth). Improves tool round-trip regardless of A/D outcome.
- Step 3 (after Step 1): Path D implementation if A failed.

---

## 4. Action log (chronological)

### 2026-07-09 - Initial environment recon

- Verified godex5 healthy on :5679 (/v1/models returns 3 MiniMax models)
- Verified Chrome CDP on :9222 (/json/version returns Browser/150.0.7871.101)
- Verified chrome-browser-mcp assets:
  - dist/index_new.js exists (4959 bytes)
  - dist/chrome.js exists (4291 bytes - handles CDP connect/launch)
  - node_modules/@modelcontextprotocol/sdk@1.29.0 installed (dist/esm/server/streamableHttp.js present)
  - node_modules/playwright, express, zod all installed
- Verified Node.js v24.13.0 at D:\AiSystem\nvm\npm\nodejs\node.exe

### 2026-07-09 - Decision

User chose Path A (streamable_http). Created D:\Documents\VibeCoding\GodeX\handoffs\ for this handoff doc.

---

## 5. Step 1 - Path A dry-run (pending execution)

### 1.1 Plan
- Launch chrome-browser-mcp/dist/index_new.js with MCP_PORT=9224, CDP_PORT=9222
- Uses StreamableHTTPServerTransport + McpServer.registerTool (proper MCP)
- Connects to existing Chrome on :9222 via chromium.connectOverCDP (does NOT spawn new Chrome)
- 13 tools: open_url / navigate / screenshot / click / type_text / get_text / wait_for / evaluate / scroll_to / list_pages / get_active_tab / switch_tab / get_element_info

### 1.2 Risks identified in advance
- sessionIdGenerator: undefined (no sessions) - Codex client may require sessions
- No notifications/cancelled handler
- No GET/SSE handler (only POST /mcp)
- Chrome reconnect logic missing in dist/index_new.js

### 1.3 Expected outcome
- POST /mcp with initialize JSON-RPC returns 200 with serverInfo.name = "chrome-browser-mcp"
- POST /mcp with tools/list returns 13 tools
- POST /mcp with tools/call name=list_pages returns list of tabs (text content)

---

## 6. Future steps (parking lot)

- Path D implementation: declare browser tools as Responses function tools in GodeX, intercept function_call, execute via Chrome CDP, return function_call_output
- Anthropic provider: src/providers/anthropic/ with x-api-key auth, /v1/messages endpoint, native tool_use block handling
- Cherry-pick upstream: 73dc7f9 feat: add built-in web search (#144) and any dispatcher-related fixes
- Codex++ plugin name resolution bug: try to investigate why it resolves browser: to sites/0.1.16 instead of browser/26.616.81150 (separate from MCP dispatcher bug)
- Chrome process leak cleanup (~11 leaked chrome processes)

---

## 7. Quick commands

```
# Verify godex5 still healthy
curl http://127.0.0.1:5679/health

# Check Codex++ MCP list (after restart)
& "D:\VibeCodingSystem\CodexDesktop-Rebuild\resources\codex.exe" mcp list --json

# Check Chrome CDP
(Invoke-WebRequest http://127.0.0.1:9222/json/version -UseBasicParsing).Content
```
### 2026-07-09 ~10:23 — Step 1.1 launch chrome-browser-mcp streamable_http

**Action**:
```
node D:\Documents\VibeCoding\GodeX\chrome-browser-mcp\dist\index_new.js
env: MCP_PORT=9224, CDP_PORT=9222
```

**Initial attempt**: process started (pid 14580), printed `[chrome] 连接已有 Chrome 调试端口 9222`, then **exited silently** before `app.listen`. Cause: stdout pipe buffer pressure from synchronous ReadLine caused process to block / exit. Lesson: always redirect to file when using `RedirectStandardOutput`.

**Second attempt**: redirected stdout/stderr to `.mcp.out.log` / `.mcp.err.log` via System.Diagnostics.Process. Process stable, pid in [2504, 6268, 14824, 20928] (one of them).

### 2026-07-09 ~10:24 — Step 1.2 MCP handshake verification

**Tool**: PowerShell `Invoke-WebRequest` (curl equivalent).

| Step | Request | Status | Notes |
|---|---|---|---|
| GET /health | n/a | connection refused | expected — server has no /health route |
| POST /mcp (no Accept header) | initialize | **HTTP 406 NotAcceptable** | MCP requires `Accept: application/json, text/event-stream`. EXPECTED. |
| POST /mcp (correct headers) | initialize | **HTTP 200 SSE** | serverInfo=`chrome-browser-mcp@0.1.0`, capabilities.tools.listChanged=true |
| POST /mcp | notifications/initialized | **HTTP 202** (empty body) | correct per spec |
| POST /mcp | tools/list | **HTTP 200** | returned 13 tools (open_url, navigate, screenshot, click, type_text, get_text, wait_for, evaluate, scroll_to, list_pages, get_active_tab, switch_tab, get_element_info) |
| POST /mcp | tools/call list_pages | **HTTP 200** | returned real Chrome tabs: `[{"title":"Codex - Chrome 应用商店","url":"chromewebstore..."},{"title":"Example Domain","url":"https://example.com/"}]` |

**Conclusion**: chrome-browser-mcp streamable_http server is **fully functional and standards-compliant**. Successfully proxies Chrome CDP via MCP streamable_http on :9224.

### 2026-07-09 ~10:25 — Step 1.3 Codex url support verified

`codex mcp add --help` confirmed Codex has native `--url <URL>` flag for streamable HTTP MCP servers. Excerpt:
```
Usage: codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)
      --url <URL>
          URL for a streamable HTTP MCP server
```

**Uncertainty #1 (Codex url support)**: RESOLVED — Codex supports it officially.
**Uncertainty #2 (chrome-browser-mcp server works)**: RESOLVED — list_pages returns real tabs.

### 2026-07-09 ~10:25 — Step 1.4 Register godex-cdp in Codex

**Action**:
```
& "D:\VibeCodingSystem\CodexDesktop-Rebuild\resources\codex.exe" mcp add godex-cdp --url "http://127.0.0.1:9224/mcp"
```

**Result**: `Added global MCP server 'godex-cdp'.`

**Verification** (`codex mcp list`):
```
Name             Status   Auth
chrome-devtools  enabled  Unsupported  (stdio, npx chrome-devtools-mcp@latest)
node_repl        enabled  Unsupported  (stdio, broken dispatcher)
godex-cdp        enabled  Unsupported  (streamable_http, http://127.0.0.1:9224/mcp)
```

`codex mcp get godex-cdp`:
```
godex-cdp
  enabled: true
  transport: streamable_http
  url: http://127.0.0.1:9224/mcp
  bearer_token_env_var: -
  http_headers: -
  env_http_headers: -
```

### 2026-07-09 ~10:25 — Step 1.5 Status

**Pending user action**: restart Codex++ to activate new `godex-cdp` MCP server. Codex++ caches MCP list at startup; config.toml changes only apply after restart.

**Tools after restart**: `mcp__godex-cdp__list_pages`, `mcp__godex-cdp__navigate`, `mcp__godex-cdp__screenshot`, etc. (13 tools).

**Unknown #3 (does streamable_http bypass dispatcher bug?)**: To be tested in Codex++ after restart. If works → Path A fully proven. If still "unsupported call" → bug is transport-agnostic, pivot to Path D.

---

## 8. chrome-browser-mcp process management

**Currently running** (pid TBD, in node process list):
- chrome-browser-mcp streamable_http server on port 9224
- Connected to Chrome CDP on port 9222 (existing user Chrome)
- Logs: `D:\Documents\VibeCoding\GodeX\chrome-browser-mcp\.mcp.out.log`, `.mcp.err.log`

**Restart command** (if process dies):
```
$env:MCP_PORT=9224; $env:CDP_PORT=9222
& "D:\AiSystem\nvm\nodejs\node.exe" "D:\Documents\VibeCoding\GodeX\chrome-browser-mcp\dist\index_new.js"
```
(in background, log redirect via System.Diagnostics.Process)

---

## 9. What to test after Codex++ restart

```
用 godex-cdp 的 list_pages 工具看看现在浏览器打开了哪些标签
```

If Codex++ successfully lists tabs (Codex 商店 + Example Domain), Path A is proven end-to-end.

Test commands (in order of value):
1. `mcp__godex-cdp__list_pages` — verify tool call routing
2. `mcp__godex-cdp__navigate url=https://news.ycombinator.com` — verify write tool
3. `mcp__godex-cdp__screenshot` — verify image response handling
4. `mcp__godex-cdp__evaluate js='document.title'` — verify JS exec

If ANY of these work without "unsupported call", the dispatcher bug is transport-specific and streamable_http is the fix.

### 2026-07-09 ~10:30 — Step 1.6 stable relaunch

Previous server (pid 20928) crashed after test requests due to **stdout buffer fill** — synchronous PowerShell `ReadLine` drained only first 3 lines, then shell timed out, leaving pipe to fill up and node process to block. Killed.

**Fix**: launch via `Start-Process -RedirectStandardOutput <file>` (native PS redirection, writes directly to file — no pipe pressure).

**New server**: pid **9984**, alive on port 9224.

### 2026-07-09 ~10:31 — Step 1.7 stable sanity tests (3 consecutive requests)

| # | Request | HTTP | Result |
|---|---|---|---|
| 1 | initialize | 200 | serverInfo=chrome-browser-mcp@0.1.0 |
| 2 | tools/list | 200 | 13 tools returned |
| 3 | tools/call list_pages | 200 | Real tabs: `[Codex 商店, Example Domain]` |

**Conclusion**: Path A server-side is **fully proven**. Stays up across multiple requests. Logs are streaming to `.mcp.out.log` / `.mcp.err.log` without buffer issues.

### 2026-07-09 ~10:32 — Step 1.8 Codex config registered

`codex mcp add godex-cdp --url "http://127.0.0.1:9224/mcp"` succeeded.

Final Codex MCP list:
- chrome-devtools (stdio, broken dispatcher) — broken
- node_repl (stdio, broken dispatcher) — broken
- **godex-cdp (streamable_http, http://127.0.0.1:9224/mcp)** — NEW, awaiting user restart of Codex++

---

## 10. CURRENT STATE (2026-07-09 ~10:32) — ready for user test

**Active servers**:
- godex4.exe (pid 3756) on :5678 — KEEP
- godex5.exe (pid 16976) on :5679 — KEEP (active conversation backend)
- chrome-browser-mcp (pid 9984) on :9224 — streamable_http MCP, KEEP
- Chrome (pid 6800) on :9222 — user's debug Chrome, KEEP
- Codex++ manager + children — KEEP

**Registered Codex MCP** (config.toml written):
- godex-cdp (streamable_http, http://127.0.0.1:9224/mcp) — needs Codex++ restart to activate

**Next user action**: **restart Codex++** (close it, then reopen). Then in a new conversation, ask:
```
用 godex-cdp 的 list_pages 工具看看现在浏览器打开了哪些标签
```
Or more directly (model decides):
```
用 mcp__godex-cdp__list_pages
```

**Expected outcome**:
- PASS: model receives tool result showing the 2 tabs (Codex 商店 + Example Domain). Path A proven end-to-end.
- FAIL (still "unsupported call"): dispatcher bug is transport-agnostic. Pivot to Path D.

---

## 11. Tools that will be available after restart

When Codex++ reconnects to godex-cdp, model will see these `mcp__godex-cdp__*` tools:
- `open_url` (url: string)
- `navigate` (url: string)
- `screenshot` (no args → image)
- `click` (selector: string)
- `type_text` (selector, text)
- `get_text` (selector)
- `wait_for` (selector, timeout?)
- `evaluate` (js: string)
- `scroll_to` (selector)
- **`list_pages`** (no args → tab list)
- `get_active_tab` (no args → active tab)
- `switch_tab` (url_pattern: string)
- `get_element_info` (selector)

### 2026-07-09 ~10:28 — Step 1.9 user-side test in Codex++ (RESULT: FAIL)

User restarted Codex++, asked model to call `mcp__godex_cdp__list_pages` (Codex normalized the hyphen to underscore).

**Result**: Codex scheduler returned `unsupported call` for both `mcp__godex_cdp__list_pages` and `mcp__godex_cdp__get_active_tab`.

**Diagnostic by Codex++ (correct)**:
- Direct HTTP `POST /mcp tools/list` returns 13 tools (server OK)
- Direct HTTP `POST /mcp tools/call list_pages` returns 200 with real Chrome tabs (2 tabs)
- Codex's tool dispatcher rejects `mcp__godex_cdp__*` calls with "unsupported call"

### 2026-07-09 ~10:30 — CRITICAL FINDING (Path A verdict)

**The codex.exe dispatcher bug is transport-agnostic.** Both stdio MCP (chrome-devtools, node_repl) AND streamable_http MCP (godex-cdp) hit the same `unsupported call` failure for ANY `mcp__<server>__<tool>` call.

This proves the bug is in how codex.exe ROUTES the tool name pattern `mcp__<server>__<tool>` internally, NOT in how it talks to the MCP server. The string `unsupported custom tool call: ` in `core\src\tools\registry.rs` is the rejection message — codex.exe treats every `mcp__*` call as `custom_tool_call` instead of `mcp_tool_call`.

### 2026-07-09 ~10:30 — PATH DECISION

- Path A: DEAD (dispatcher bug bypasses not transport-specific)
- Path B (patch codex.exe binary): deferred, too risky without source
- Path D (GodeX Responses API exposes browser tools as native function tools): **NEXT**

Strategy: bypass `mcp__*` prefix entirely by declaring browser tools as `type: "function"` in GodeX Responses API. Codex routes function calls through a different code path that is NOT affected by the dispatcher bug.

### 2026-07-09 ~10:30 — Side note: Anthropic provider now MORE relevant

Since path A didn't work, we're going Path D. With Path D, model emits `function_call` items which GodeX must reconstruct from upstream Chat API tool_calls (delta reassembly, fragile) OR from Anthropic native `tool_use` blocks (cleaner). **Adding Anthropic provider in parallel maximizes Path D's robustness.**

---

## 12. Path D implementation plan (NEXT)

### Goal
Make Codex's `mcp__chrome_devtools__list_pages` calls work by **not using mcp__ prefix at all**. Instead, declare browser tools as native Responses API `function` tools in GodeX, intercept model-emitted `function_call` items, execute via Chrome CDP, return as `function_call_output`.

### Required changes in GodeX

#### 12.1 New module: `src/tools/browser-function-tools/`
- `declarations.ts` — export 13 function tool definitions (matching chrome-browser-mcp's tool schemas, but as Responses `function` type)
- `executor.ts` — implements `function_call` -> Chrome CDP -> `function_call_output`
- `cdp-client.ts` — WebSocket client to ws://127.0.0.1:9222/devtools/browser/...

#### 12.2 Bridge integration
- `src/bridge/tools/tool-plan.ts` — add `planBrowserFunctionDeclarations()` returning the 13 declarations; merge into request tools
- `src/bridge/tools/call-restorer.ts` — recognize browser function calls (by tool name prefix `godex_chrome_*`) and route to local executor instead of upstream
- `src/responses/` — when Codex sends `function_call_output` back, recognize it and respond with next model turn

#### 12.3 Naming convention
Use `godex_chrome_<verb>` prefix to avoid collision:
- `godex_chrome_list_pages`
- `godex_chrome_navigate`
- `godex_chrome_screenshot`
- ... etc

#### 12.4 Bridge response flow
1. Codex sends `POST /v1/responses` with `tools: [..., godex_chrome_*, ...]`
2. GodeX bridges to upstream (Chat API or Anthropic) — translates function tools
3. Model emits `function_call name=godex_chrome_list_pages`
4. GodeX intercepts (in sync or stream pipeline):
   - If name has `godex_chrome_*` prefix -> execute locally via Chrome CDP
   - Else -> pass through to upstream as normal tool call
5. Returns `function_call_output` to Codex as part of the response
6. Codex continues the loop (model may call more functions or finish)

#### 12.5 Effort estimate
- Declarations + executor + CDP client: ~1-2 hours
- Bridge integration (tool-plan, call-restorer): ~1-2 hours  
- Response pipeline interception: ~2-4 hours
- Testing + debugging: ~2-4 hours
- **Total: 1-2 working days**

### Path D parallel workstream: Anthropic provider

Adding Anthropic provider to GodeX (`src/providers/anthropic/`) makes Path D's upstream tool chain more reliable:
- Native `tool_use` content blocks (no delta reassembly)
- Cleaner schema (input_schema direct, not wrapped in function.parameters)
- ~2-4 days work; can be done in parallel

---

## 13. Recommendation

Implement Path D as primary, in parallel with Anthropic provider. Both share the goal of making GodeX's tool pipeline robust. After Path D works, ALL MCP-related bugs are solved and we have a foundation for declaring any local tool as a function tool.

---

## 14. minnimax.chat /v1/messages probe results (2026-07-09 ~10:47)

**Method**: curl probes from PowerShell using $env:MINIMAX_API_KEY

### Probe 1: minimal request
- POST https://minnimax.chat/v1/messages
- Headers: x-api-key, anthropic-version=2023-06-01
- Body: { model: "MiniMax-M3", max_tokens: 100, messages: [{role:user, content:"Reply PONG"}] }
- Response: HTTP 200
- Body shape: Anthropic MessagesResponse, wrapped with extra `base_resp: {status_code:0, status_msg:""}` at top level
- All Anthropic fields present: id, type=message, role=assistant, content[{type:text}], stop_reason=end_turn, usage{cache_creation_input_tokens, cache_read_input_tokens, input_tokens, output_tokens, service_tier}

### Probe 2: tools (model emits tool_use)
- Same endpoint, added tools: [{name: get_weather, description, input_schema: {type:object, properties: {city: string}, required: [city]}}]
- Prompt: "What's the weather in Shanghai?"
- Response: HTTP 200
- content array has 2 blocks:
  - {type: text, text: "I'll check..."}
  - {type: tool_use, id: "call_019f44c5c30d7501af18f9ed", name: "get_weather", input: {city: "Shanghai"}}
- stop_reason: tool_use
- id format: `call_<uuid>` (Anthropic style, 28 chars hex suffix)

### Probe 3: stream=true (SSE)
- Same endpoint, stream=true
- Full Anthropic event chain received:
  - event: message_start (data: {type:message_start, message:{...}})
  - event: ping (data: {type:ping})
  - event: content_block_start (index=0, type=text, text="")
  - event: content_block_delta (index=0, type=text_delta, text="1\n") x2
  - event: content_block_stop (index=0)
  - event: message_delta (delta:{stop_reason:end_turn}, usage:{...})
  - event: message_stop
- Content-Type: text/event-stream (inferred from event: lines)

### Probe 4: tool_result injection
- Multi-turn with prior assistant tool_use + user tool_result
- Body: messages = [user Q, assistant content[text, tool_use id=call_test_001], user content[tool_result tool_use_id=call_test_001, content="..."]]
- Response: HTTP 200
- Model synthesizes: "The current weather in Shanghai is **22°C, sunny with 60% humidity**..."
- stop_reason: end_turn

### Verdict
**minnimax.chat /v1/messages is fully Anthropic-compatible for tool use.** M3 backend correctly follows Anthropic's tool_use protocol including streaming SSE events and tool_result content blocks.

**Implication**: Adding Anthropic provider to GodeX is HIGH-VALUE. Path D's function tools can use Anthropic upstream for cleaner tool round-trip (clean tool_use blocks with stable ids, no Chat API delta reassembly needed).

---

## 15. Open decision (user input needed)

User's conditional: "if /v1/messages does not support tools, cut Anthropic provider workstream." Since tools DO work, the cut condition does not trigger. User must explicitly approve Anthropic provider implementation.

Pending decision: proceed with Anthropic provider (in parallel with Path D)?

### 2026-07-09 ~10:50 — User decisions

1. **Anthropic provider**: SKIP for now. Probe results archived in handoff; can revisit after Path D stabilizes.
2. **Path D upstream**: Use existing `minimax` (OpenAI-compatible) spec. No new provider work.
3. **Path D executor backend**: REUSE chrome-browser-mcp (pid 9984, http://127.0.0.1:9224/mcp). GodeX does NOT directly speak CDP; instead it proxies function_call -> HTTP /mcp tools/call.

### Implication: simplified executor
- GodeX executor = thin HTTP proxy to chrome-browser-mcp
- ~50-80 lines of code in `src/tools/browser-function-tools/executor.ts`
- ~150-200 lines for 13 function tool declarations in `declarations.ts`
- Bridge patches in tool-plan + call-restorer: ~150-200 lines
- Total A1+A2 estimated at ~400-500 lines of new code

---

## 16. Revised plan (final)

**Phase A1 — Path D skeleton** (provider-agnostic, NOT touching GodeX upstream config):
- New: `src/tools/browser-function-tools/declarations.ts` — 13 `godex_chrome_*` function tool defs
- New: `src/tools/browser-function-tools/executor.ts` — function_call -> HTTP POST to chrome-browser-mcp -> function_call_output
- New: `src/tools/browser-function-tools/cdp-client.ts` — HTTP client to chrome-browser-mcp (thin, not full CDP)
- New: `src/tools/browser-function-tools/index.ts` — public surface
- Tests: `src/tools/browser-function-tools/*.test.ts` — unit tests for declarations + executor
- Build godex6, verify it starts

**Phase A2 — Path D bridge integration**:
- Edit: `src/bridge/tools/tool-plan.ts` — add browser function tool declarations to planTools output
- Edit: `src/bridge/tools/call-restorer.ts` — recognize `godex_chrome_*` calls, route to local executor
- Edit: `src/responses/sync` and `src/responses/stream` — insert local execution branch on `function_call name=godex_chrome_*`
- Tests: `src/bridge/tools/tool-plan.test.ts` (extend existing), `src/bridge/tools/call-restorer.test.ts` (extend)
- Build godex6, run `bun run check`

**Phase A3 — Integration test**:
- Update config.toml: `mcp_servers.godex-cdp` removed (we replaced it), or kept as fallback
- Run Codex++ -> godex6 -> chrome-browser-mcp end-to-end
- Verify `mcp__godex_cdp__list_pages` still works (Path A backend)
- Verify new `function_call name=godex_chrome_list_pages` works (Path D frontend)

**Deferred (parking lot)**:
- Anthropic provider (probe results archived; can resume if Path D proves unreliable on tool calls via Chat API)
- Cherry-pick upstream: `73dc7f9 feat: add built-in web search (#144)`
- Codex++ plugin name resolution bug (browser: prefix resolving to sites/0.1.16)
- Chrome process leak cleanup

## Path D Auto-Inject — Completed 2026-07-09 ~12:18

Commit: `93e21e9` (pushed to `fork/main`)

### What changed

- `src/bridge/tools/tool-plan.ts` — `planTools()` now auto-injects the 13
  `godex_chrome_*` declarations whenever the caller did not pass any tools.
  Dedup by `providerName` so caller wins on conflict. Each injected
  declaration is tagged `execution: "godex_managed"`. Opt-out per-call via
  `planTools({ browserFunctionInject: false })` or process-wide via
  `GODEX_DISABLE_BROWSER_FUNCTION_INJECT=1`.
- `src/bridge/tools/tool-plan.test.ts` — 3 new tests in a new
  `Path D browser function auto-inject` describe block. The block uses
  `beforeEach`/`afterEach` to toggle the env var.
- `test-setup.ts` (new) + `bunfig.toml` (new) — preload that disables
  auto-inject globally for the test process, so the 800+ existing tests
  that assert on exact tool shape stay green without per-file boilerplate.
- `tsconfig.json` — added `chrome-browser-mcp/` to `exclude`. The
  subproject has 51 pre-existing TypeScript errors unrelated to GodeX.
  `bun run check` now returns 0 typecheck errors.

### Verification

- `bun test src/bridge/tools/tool-plan.test.ts`: 34/0 (31 existing + 3 new)
- `bun test src/e2e`: 65/0/9 skip
- `bun run test`: 850/0
- `bun run check`: typecheck 0 errors, lint clean, test 850/0

### End-to-end test (non-streaming, no tools in request)

POST `http://127.0.0.1:5680/v1/responses` with model
`minnimax.chat/MiniMax-M3` and NO `tools` field in the body.

Test 1 — list_pages:

```json
{
  "input": [{"type":"message","role":"user","content":"用 godex_chrome_list_pages 看现在开了哪些标签"}]
}
```

Model output (final message, in Chinese):

> 当前打开了 **2 个标签页**，都是同一个页面：Example Domain / https://example.com/ ...

Function calls in the response: `godex_chrome_list_pages` with `arguments: "{}"`.
The call was executed by the BrowserFunctionLoop, returned the 2 tabs, and
fed back to the model as a `function_call_output` item. **This proves
auto-inject fired and the model saw the tools without the caller having
to declare them.**

Test 2 — navigate + screenshot (image content part consumption):

```json
{
  "input": [{"type":"message","role":"user","content":"用 godex_chrome_navigate 打开 https://example.com，再用 godex_chrome_screenshot 截图。最后告诉我页面长什么样。"}]
}
```

Model output (in Chinese) — model described the page after seeing the
screenshot image:

> 页面已经成功打开并截图了。这是经典的 **example.com** 页面，整体非常简洁：
>
> - 📄 **标题**：「Example Domain」（黑色加粗，位于页面左上方位置）
> - 📝 **正文段落**：写着「This domain is for use in documentation examples...」
> - 🔗 **链接**：一个蓝色的下划线链接「Learn more」（了解更多），指向 IANA 的相关说明
>
> **视觉风格：**
> - 纯白背景
> - 文字采用无衬线字体（看起来像 Helvetica/Arial）
> - 内容整体偏左对齐
> - 没有任何图片、按钮或其他交互元素

This confirms:
1. Auto-inject: model called `godex_chrome_navigate` and `godex_chrome_screenshot`
   without the request declaring them.
2. Image content parts: `godex_chrome_screenshot` returned base64 PNG,
   the bridge wrapped it as `input_image` content part, the model received
   the image and visually described the page.

### End-to-end test (streaming, no tools in request)

POST `http://127.0.0.1:5680/v1/responses?stream=true`. The stream emits
15 events covering the first turn (reasoning + function_call to
`godex_chrome_list_pages`), then `response.completed`. **The
BrowserFunctionLoop does not run in the streaming path** — the function
call is delivered to the client, but no second turn is triggered to feed
the result back to the model. The response.completed output has empty
`output_text`.

This is a known limitation, flagged earlier. For Path D with auto-inject,
**the non-streaming endpoint is the working path**. Codex++ would need to
either:
- Use the non-streaming endpoint for browser automation, or
- Buffer the streaming function_call and re-issue as a non-streaming
  follow-up turn, or
- We add a streaming-aware BrowserFunctionLoop (separate task).

### Live process state (current)

| pid  | process | port | role                                      |
|------|---------|------|-------------------------------------------|
| 3756 | godex4  | 5678 | user's primary LLM gateway — KEEP         |
| 16976| godex5  | 5679 | LLM gateway — KEEP                        |
| 11196| godex6  | 5680 | **Path D test gateway (auto-inject ON)**  |
| 14412| node    | 9224 | chrome-browser-mcp backend — KEEP         |
| 6800 | chrome  | 9222 | user's Chrome debug instance — KEEP       |

### Next steps (resume order)

1. **Streaming BrowserFunctionLoop** — extend the streaming pipeline to
   detect function_call items, execute them, and re-issue a follow-up
   turn with the function_call_output appended. This makes Path D work
   in streaming mode too.
2. **Cherry-pick Ahoo-Wang upstream changes** that don't conflict with
   Path D (e.g. newer tool planning, provider fixes). Re-verify auto-
   inject still works after each pick.
3. **Expose `GODEX_CHROME_*` tool surface as a Codex tool surface** if
   Codex++ wants to call godex_chrome_* directly without going through
   the bridge (i.e. expose the godex-cdp MCP server too).
