# Phase B Design Draft: AnthropicMessages Pipeline (2026-07-10)

## Goal

Make `minnimax.chat` (and any other provider that exposes Anthropic-format `/v1/messages`) work end-to-end through GodeX. After Phase B:

- A provider configured with `protocol: MESSAGES_PROTOCOL` routes through the AnthropicMessages pipeline instead of Chat Completions.
- Codex++ receives the same Responses API event shapes it does today (zero Codex-side changes).
- Tool calling (`godex_chrome_*`, web_search, etc.) works via Anthropic's native `tool_use`/`tool_result` blocks instead of Chat's `tool_calls`/`tool` role.
- The user picks per provider in YAML: `apitype: AnthropicMessages` (or `OpenAIChatCompletions`).

Phase B does NOT touch the bridge public surface (only fills in the stub). Phase B does NOT change existing Chat provider behavior.

---

## 1. Anthropic Messages API primer (the upstream wire format)

### Endpoint

```
POST {base_url}/v1/messages
Headers:
  x-api-key: {api_key}
  anthropic-version: 2023-06-01
  content-type: application/json
```

### Request body (non-streaming)

```json
{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 1024,
  "system": "You are a helpful assistant.",   // optional, separate from messages
  "messages": [
    { "role": "user",      "content": "Hello" },
    { "role": "assistant", "content": [
        { "type": "text", "text": "Hi!" },
        { "type": "tool_use", "id": "toolu_01A", "name": "get_weather", "input": {"city": "Tokyo"} }
    ]},
    { "role": "user", "content": [
        { "type": "tool_result", "tool_use_id": "toolu_01A", "content": "sunny, 23C" }
    ]}
  ],
  "tools": [
    {
      "name": "get_weather",
      "description": "Get the current weather",
      "input_schema": { "type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"] }
    }
  ],
  "tool_choice": { "type": "auto" },   // or {"type":"any"} or {"type":"tool","name":"..."}
  "stream": false                        // optional
}
```

### Response (non-streaming)

```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text",      "text": "The weather in Tokyo is sunny, 23C." },
    { "type": "tool_use",  "id": "toolu_02B", "name": "get_weather", "input": {"city": "Paris"} }
  ],
  "stop_reason": "end_turn",     // or "tool_use" | "max_tokens" | "stop_sequence"
  "usage": {
    "input_tokens": 100,
    "output_tokens": 25,
    "cache_read_input_tokens": 0
  }
}
```

### Streaming SSE events

```
event: message_start
data: {"type":"message_start","message":{...full message object...}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"The "}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"weather..."}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":25}}

event: message_stop
data: {"type":"message_stop"}
```

For tool_use blocks, deltas are `{"type":"input_json_delta","partial_json":"{\"ci"}`.

---

## 2. Codex Responses API -> Anthropic Messages (request side translation)

### 2.1 Top-level fields

| Responses API | Anthropic Messages | Notes |
|---|---|---|
| `model` | `model` | direct |
| `max_output_tokens` | `max_tokens` | Anthropic REQUIRES this; default 1024 if absent |
| `instructions` | `system` | separate field, not in `messages` array |
| `input` (string or array) | `messages` (array) | needs content-block shaping (see 2.3) |
| `tools` | `tools` | shape differs (see 2.2) |
| `tool_choice` | `tool_choice` | shape differs (see 2.2) |
| `stream` | `stream` | direct |
| `temperature`, `top_p` | `temperature`, `top_p` | direct (Anthropic clamps to >= 0 / <= 1) |
| `metadata` | `metadata.user_id` | Anthropic user_id shape is `{user_id: "..."}` |
| `previous_response_id` | (none) | resolved by GodeX session layer before request |
| `truncation`, `parallel_tool_calls` | (none) | ignored / degrade-warn |

### 2.2 Tools

Codex Responses API tool shape:
```json
{
  "type": "function",
  "name": "get_weather",
  "description": "...",
  "parameters": {"type":"object","properties":{...},"required":[...]},
  "strict": true
}
```

Anthropic Messages tool shape:
```json
{
  "name": "get_weather",
  "description": "...",
  "input_schema": {"type":"object","properties":{...},"required":[...]}
}
```

Mapping: `parameters` -> `input_schema`. `strict` -> drop (Anthropic doesn't have it). `type` -> drop.

Codex Responses API `tool_choice`:
- `"auto"` -> `{"type":"auto"}`
- `"any"` -> `{"type":"any"}`
- `"none"` -> omit `tool_choice` field (Anthropic convention)
- `{type:"function", name:"X"}` -> `{"type":"tool","name":"X"}`
- `{type:"custom", name:"X"}` -> Anthropic has no custom-tool equivalent; degrade-warn

### 2.3 Input -> messages

Codex Responses API `input` can be:
- A plain string: wrap as `{"role":"user","content": <string>}`
- An array of items, each of which has `type` field. Codex types: `message` (text/image/file), `function_call`, `function_call_output`, `reasoning`.

Anthropic `messages` is `[{role, content}, ...]`. `content` is either a string or an array of content blocks. Content block types: `text`, `image`, `tool_use`, `tool_result`, `tool_search_result` (newer).

Mapping table for Codex -> Anthropic content blocks:

| Codex item type | Anthropic content block |
|---|---|
| `message` (role=user, text content) | `{"type":"text","text":"..."}` |
| `message` (role=user, image content) | `{"type":"image","source":{"type":"base64","media_type":"...","data":"..."}}` |
| `message` (role=assistant, text content) | `{"type":"text","text":"..."}` (in an assistant message) |
| `reasoning` | `{"type":"text","text":"<reasoning summary>"}` (Anthropic doesn't have native reasoning blocks; we surface as text for now -- see OQ3) |
| `function_call` | `{"type":"tool_use","id":"<call_id>","name":"<name>","input":<arguments>}` |
| `function_call_output` | `{"type":"tool_result","tool_use_id":"<call_id>","content":<output_string>}` (inside a user-role message) |

Open Question OQ1 (BridgeMessage.role): Codex `function_call_output` is a separate item with no `role`. To map to Anthropic, we wrap consecutive `function_call_output` items in a single user message with multiple `tool_result` blocks. The current `BridgeMessage` (alias for Chat's `tool` role) doesn't match this. **Phase B decision**: introduce a `BridgeContentBlock` neutral type with `type: "tool_use" | "tool_result" | "text" | "image"` and rewrite input-normalizer to emit blocks. Chat builder translates blocks -> Chat shape; Anthropic builder translates blocks -> Anthropic shape.

### 2.4 Session / previous_response_id

Codex passes `previous_response_id`. GodeX session layer resolves this into the full conversation history (via SQLite). The result is an `input_items` array that gets normalized into Responses-API items, then translated to Anthropic messages per 2.3. No Anthropic-specific session handling needed.

---

## 3. Anthropic Messages -> Codex Responses API (response side translation)

### 3.1 Sync response

| Anthropic | Codex Responses API |
|---|---|
| `id` | `id` (we re-prefix with `resp_` for Codex compatibility) |
| `role: "assistant"` | top-level `role` field (Codex puts role in output items, not at top level) |
| `content` array | `output` array, each element gets `type` based on block type |
| `stop_reason: "end_turn"` | `status: "completed"` + no further action |
| `stop_reason: "tool_use"` | `status: "completed"` + Codex sees function_call items and continues the loop |
| `stop_reason: "max_tokens"` | `status: "incomplete"`, `incomplete_details.reason: "max_output_tokens"` |
| `usage.input_tokens` | `usage.input_tokens` |
| `usage.output_tokens` | `usage.output_tokens` |
| `usage.cache_read_input_tokens` | `usage.input_tokens_details.cached_tokens` |

Per content block:
- `{"type":"text","text":"..."}` -> output item `{"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"..."}]}`
- `{"type":"tool_use","id":"...","name":"...","input":{...}}` -> output item `{"type":"function_call","call_id":"<id>","name":"<name>","arguments":"<JSON string of input>"}`

### 3.2 Streaming SSE events

Anthropic SSE events -> Codex Responses API SSE events mapping:

| Anthropic event | Codex Responses API event |
|---|---|
| `message_start` | `response.created` |
| `content_block_start` (text) | `response.output_item.added` (item type=message) + `response.content_part.added` |
| `content_block_start` (tool_use) | `response.output_item.added` (item type=function_call) |
| `content_block_delta` (text_delta) | `response.output_text.delta` |
| `content_block_delta` (input_json_delta) | `response.function_call_arguments.delta` |
| `content_block_delta` (thinking_delta) | `response.reasoning_summary_text.delta` (OQ3: surface reasoning as summary) |
| `content_block_stop` | `response.output_item.done` (if last) + `response.content_part.done` |
| `message_delta` (stop_reason) | `response.incomplete` (if max_tokens) or no-op (if end_turn) |
| `message_delta` (usage.output_tokens) | embedded in `response.completed` usage at end |
| `message_stop` | `response.completed` |

This mapping is the core of the Anthropic stream transformer. Phase B implementation lives in `src/responses/anthropic-stream-transformer.ts` (new file) and is registered in `StreamPipeline` when the resolved provider is MESSAGES_PROTOCOL.

---

## 4. Tool name codec for Anthropic

Anthropic tool names must match `^[a-zA-Z0-9_-]{1,64}$`. Codex tools may have arbitrary names (e.g., `godex_chrome_list_pages` -- fine; `apply_patch` -- fine; `some.namespace/tool@v2` -- NOT fine).

The Anthropic spec uses `ToolNameCodec.toProviderName(name)` to sanitize names. For Anthropic, the codec should:
- Replace `.`, `/`, `:` with `_`
- Strip `@` and any other non-allowed chars
- Truncate to 64 chars
- Maintain a reversible mapping if possible (for response back-mapping)

If the user names a tool that violates the regex after sanitization, degrade-warn (Phase B preserves Codex's tools; this is a "we mapped it but the upstream might fail" warning).

---

## 5. Spec file design

Two new files:

### `src/providers/anthropic/spec.ts`

```typescript
export const ANTHROPIC_MESSAGES_SPEC = {
    name: "anthropic",
    protocol: MESSAGES_PROTOCOL,
    capabilities: {
        // Anthropic supports: text generation, image input, tool_use, tool_choice (auto/any/tool),
        // reasoning (via thinking param), streaming.
        parameters: {
            supported: new Set([
                "stream", "temperature", "top_p", "max_output_tokens", "max_tokens",
                "tool_choice", "system",
            ]),
        },
        tools: {
            supported: new Set(["function"]), // Anthropic only has function-type tools
        },
        toolChoice: {
            supported: new Set(["auto", "any", "tool", "none"]),
        },
        reasoning: {
            effort: "boolean", // Anthropic uses thinking.enabled/disabled, not native effort
        },
        streaming: { usage: true },
    },
    endpoint: { defaultBaseURL: "https://api.anthropic.com" },
    auth: X_API_KEY_AUTH,  // x-api-key header
    toolName: defaultToolNameCodec,  // Phase B custom impl if needed
    response: /* AnthropicResponseAccessor */,
    stream: /* AnthropicStreamAccessor */,
} as const satisfies ProviderSpec<AnthropicMessagesRequest, AnthropicMessagesResponse, AnthropicMessagesStreamEvent>;
```

### `src/providers/minimax-anthropic/spec.ts`

Same as above but with `name: "minimax-anthropic"`, `endpoint: { defaultBaseURL: "https://minnimax.chat" }`. Allows user to pick `spec: minnimax-anthropic` in YAML and get Anthropic-format calls to minnimax.chat.

---

## 6. End-to-end flow

```
Codex++  POST /v1/responses  ->  GodeX
                                       |
                                       v
                                ResponsesContext
                                       |
                                       v
                                ProviderExchange.request(ctx)
                                       |
                                       v
                                buildBridgeRequest({ spec: ctx.provider.spec, ... })
                                       |
                                       +-- spec.protocol === MESSAGES_PROTOCOL
                                       |       |
                                       |       v
                                       |   buildAnthropicMessagesRequest(input)
                                       |       |
                                       |       v
                                       |   Anthropic provider client
                                       |       POST {base_url}/v1/messages
                                       |       (translated request body, x-api-key auth)
                                       |       |
                                       |       v
                                       |   Anthropic response (JSON or SSE)
                                       |       |
                                       |       v
                                       |   Anthropic -> Responses transformer (sync or stream)
                                       |
                                       +-- spec.protocol === CHAT_COMPLETIONS_PROTOCOL
                                               | (existing path)
                                               v
                                          chat-completions-builder
```

---

## 7. Open Questions to resolve before / during Phase B

### OQ1 - BridgeMessage.role shape

**Today**: `BridgeMessage` is an alias for Chat Completions `ChatCompletionMessageParam`. Roles: `system` | `developer` | `user` | `assistant` | `tool` | `function`.

**Problem**: Anthropic has no `tool` role. Tool outputs are user-message content blocks (`tool_result`).

**Decision for Phase B**: Introduce `BridgeContentBlock` neutral type with `type: "text" | "image" | "tool_use" | "tool_result" | "reasoning"`. Rewrite input-normalizer to emit `{role, content: BridgeContentBlock[]}`. Chat builder translates blocks -> Chat shape; Anthropic builder translates blocks -> Anthropic shape.

**Cost**: input-normalizer.ts rewrite (~ 700 lines touched). BridgeMessage still works as a `{role, content}` wrapper but `content` is now always `BridgeContentBlock[]`.

**Benefit**: One canonical input shape; Chat and Anthropic pipelines stay independent.

### OQ2 - Block.type enum

Locked in OQ1: `text | image | tool_use | tool_result | reasoning`. Chat translates: `tool_use -> ChatCompletionMessageToolCall`, `tool_result -> ChatCompletionToolMessageParam`. Anthropic translates 1:1.

### OQ3 - Anthropic thinking policy

Anthropic has `thinking: {type: "enabled" | "disabled", budget_tokens: N}`. Codex Responses API has `reasoning: {effort: "none"|"minimal"|"low"|"medium"|"high"|"xhigh"}`.

**Mapping**:
- `effort: "none"` -> `thinking: {type: "disabled"}`
- `effort: "minimal"` / `"low"` / `"medium"` -> `thinking: {type: "enabled", budget_tokens: 1024}`
- `effort: "high"` -> `thinking: {type: "enabled", budget_tokens: 4096}`
- `effort: "xhigh"` -> `thinking: {type: "enabled", budget_tokens: 16384}`

Surface in response: Anthropic returns thinking content blocks with `signature` and `thinking` text. Phase B converts to Codex `reasoning` output items with `summary` and encrypted `content`. Anthropic's `signature` is opaque to Codex; we strip it (Codex doesn't validate signatures).

Default policy: opt-in via YAML (`anthropic.thinking: { default_effort: "medium" }`). If absent, omit thinking param and let Anthropic default.

---

## 8. Test plan

### Unit tests (colocated)

- `src/bridge/request/anthropic-messages-builder.test.ts`
  - Request body shape per Codex input type
  - Tools array translation (parameters -> input_schema, strict dropped)
  - tool_choice translation (auto/any/none/tool)
  - System message separation
  - max_output_tokens -> max_tokens
  - function_call_output -> tool_result wrapping
- `src/responses/anthropic-stream-transformer.test.ts`
  - Each Anthropic SSE event -> corresponding Codex event(s)
  - text_delta -> output_text.delta accumulation
  - input_json_delta -> function_call_arguments.delta accumulation
  - tool_use block completion -> function_call output item done
  - message_delta stop_reason -> response.incomplete / response.completed

### Mocked E2E

- `src/e2e/anthropic-mocked.test.ts`
  - Mock Anthropic server (returns canned response)
  - Codex sends /v1/responses request
  - GodeX routes through Anthropic pipeline
  - Verify Codex receives proper Responses shape

### Live E2E (gated by env)

- `src/e2e/minnimax-anthropic-live.test.ts`
  - Requires `MINIMAX_API_KEY`
  - Hits real minnimax.chat/v1/messages
  - Skip if env var unset

---

## 9. File-level work plan

| File | Status |
|---|---|
| `src/providers/anthropic/spec.ts` | NEW |
| `src/providers/anthropic/client.ts` | NEW |
| `src/providers/anthropic/hooks.ts` | NEW |
| `src/providers/anthropic/protocol/messages-request.ts` | NEW |
| `src/providers/anthropic/protocol/messages-response.ts` | NEW |
| `src/providers/anthropic/protocol/messages-stream.ts` | NEW |
| `src/providers/anthropic/index.ts` | NEW |
| `src/providers/minimax-anthropic/spec.ts` | NEW (thin wrapper) |
| `src/providers/minimax-anthropic/client.ts` | NEW |
| `src/providers/minimax-anthropic/index.ts` | NEW |
| `src/providers/registry.ts` | MODIFY (register 2 new providers) |
| `src/bridge/request/anthropic-messages-builder.ts` | FILL STUB (was 55 lines Phase A, target ~300 lines) |
| `src/bridge/response/anthropic-response-reconstructor.ts` | NEW (sync response -> Responses object) |
| `src/responses/anthropic-stream-transformer.ts` | NEW (Anthropic SSE -> Responses SSE) |
| `src/responses/stream-pipeline.ts` | MODIFY (route to anthropic-stream-transformer when protocol is messages) |
| `src/bridge/bridge-types.ts` | MODIFY (introduce BridgeContentBlock per OQ1) |
| `src/bridge/request/input-normalizer.ts` | MODIFY (emit content blocks instead of mixed roles) |
| `src/bridge/request/chat-completions-builder.ts` | MODIFY (translate blocks -> Chat shape) |
| `src/providers/anthropic/tool-name-codec.ts` | NEW (sanitize Codex names -> Anthropic regex) |

Approx 15 new files + 5 modifications. Estimated: 3-5 days of focused work, ~1200-1800 LOC.

---

## 10. Risk + rollback

| Risk | Mitigation |
|---|---|
| Chat provider regresses after input-normalizer rewrite | Add comprehensive mock E2E for both protocols; verify Round 11 baseline (862/0 + 65/0) still passes |
| minnimax.chat Anthropic endpoint behavior differs from canonical Anthropic | Live E2E with `MINIMAX_API_KEY`; degrade gracefully if /v1/messages returns non-Anthropic shape |
| `BridgeContentBlock` rewrite breaks BridgeMessage consumers | Keep BridgeMessage as `{role, content: Block[]}` wrapper; old Chat shape code translates at boundary, not in core types |
| Reasoning mapping loses data | Codex's reasoning model differs from Anthropic's thinking; we surface as text summary, accept some loss |
| Tool name sanitization is lossy | Use a reversible mapping table; log warning if round-trip fails |
| Stream transformer bugs (event ordering, accumulation) | Snapshot-based testing: capture Anthropic SSE, snapshot Codex SSE, diff |

Rollback: Phase B is purely additive. Anthropic provider is opt-in via YAML (`spec: anthropic` or `spec: minnimax-anthropic`). No existing Chat provider is affected. If Phase B fails, simply don't register the new specs.

---

## 11. Phase B sequencing (proposed)

Phase B1 (~1 day): OQ1 + OQ2 - introduce BridgeContentBlock, rewrite input-normalizer, refactor chat-completions-builder to translate blocks. Verify all 862 tests pass.

Phase B2 (~1 day): OQ3 - thinking mapping + reasoning surfacing.

Phase B3 (~1-2 days): Anthropic provider spec + client + hooks + protocol DTOs + tests. fill in anthropic-messages-builder.ts.

Phase B4 (~1 day): Stream transformer (anthropic SSE -> Responses SSE) + sync response reconstructor.

Phase B5 (~0.5 day): minimax-anthropic thin wrapper + register providers + YAML config docs.

Phase B6 (~0.5 day): Live E2E with minnimax.chat/v1/messages + Codex++ end-to-end smoke test.

Total: ~5-6 days focused work.

---

## 12. After Phase B (where this leads)

Once Phase B ships:
1. User can configure `minnimax.chat` provider with `apitype: AnthropicMessages` in YAML
2. Codex++ sends Responses API -> GodeX routes through Anthropic pipeline -> minnimax.chat /v1/messages -> response back through GodeX -> Responses API events to Codex++
3. `browser:control-in-app-browser`, `chrome:control-chrome`, `godex_chrome_*` should ALL start working reliably (per user's original pain point: "mcp__node_repl__js unsupported call")
4. User can switch back to `apitype: OpenAIChatCompletions` per-conversation if needed

Long-term:
- Phase C: per-provider `stream_mode` defaults (YES A decision; deferred from step 4)
- Phase D: native Anthropic `/v1/messages` from upstream Anthropic (not minnimax.chat proxy)
- Phase E: studio.exe updates per user's "先把godex调好了来" directive
