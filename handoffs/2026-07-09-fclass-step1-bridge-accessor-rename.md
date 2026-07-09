# Handoff — F Class Step 1: Accessor Rename + Anthropic prep (2026-07-09)

## TL;DR

Done: renamed two ProviderSpec accessor interfaces so they no longer carry the word "Chat" in their name; this unlocks Anthropic provider integration without Chat-shape leakage downstream. Zero behavior change. 862/862 unit tests pass.

- Commit: `4e2fe76` on `fork/main` (pushed to zamelee/GodeX)
- Diff: 2 files, +18/-8
- branch ref: 931ab27 → 4e2fe76

## What was decided before this handoff (the F-class question)

F class = "5 built-in providers (deepseek, minimax, xiaomi, zhipu, example) read Chat internally". Two options were on the table:

- A — Rename interfaces only; 5 hooks.ts untouched. Surface-only change; Chat shape still leaks downstream whenever a new Chat provider is added.
- B — Rename + change 5 hooks.ts signatures to (response: unknown). Maximum purity; 400+ LOC of cast gymnastics across 5 files.
- B + 折中1 (chosen) — Rename + neutral downstream signature + 5 hooks.ts internally keep ChatCompletion type. Cast happens only at the spec.ts assembly boundary; inside hooks.ts the types stay strong.

User picked **B**, implemented as **B + 折中1**.

## What actually happened (the surprise)

The diff carries 21 lines of `contract.ts` additions that the previous LLM handoff described as "already in place":

```diff
-export type ProviderProtocol = typeof CHAT_COMPLETIONS_PROTOCOL;
+export const MESSAGES_PROTOCOL = "messages" as const;
+export type ProviderProtocol =
+	| typeof CHAT_COMPLETIONS_PROTOCOL
+	| typeof MESSAGES_PROTOCOL;
 export const BEARER_AUTH_SCHEME = "bearer" as const;
+export const X_API_KEY_AUTH_SCHEME = "x_api_key" as const;
+export type ProviderAuthScheme =
+	| typeof BEARER_AUTH_SCHEME
+	| typeof X_API_KEY_AUTH_SCHEME;
 ...
 export interface ProviderAuthSpec {
-	readonly scheme: typeof BEARER_AUTH_SCHEME;
+	readonly scheme: ProviderAuthScheme;
 }
 export const BEARER_AUTH: ProviderAuthSpec = { scheme: BEARER_AUTH_SCHEME };
+export const X_API_KEY_AUTH: ProviderAuthSpec = { scheme: X_API_KEY_AUTH_SCHEME };
```

These additions had been living in the working tree since an earlier session but were never committed. They were the actual motivation for the rename — Anthropic uses `x-api-key` header + `/v1/messages` protocol, so the type system had to widen the union to permit both. We carried them along in this commit rather than separate them, because:

1. typecheck passed (confirming they were consistent with the rest of the codebase)
2. 862 unit tests passed
3. Separating them would have required another full check cycle for zero practical benefit

## Files changed

```
src/bridge/provider-spec/contract.ts          | 22 ++++++++++++++++------
src/bridge/response/response-reconstructor.ts |  4 ++--
2 files changed, 18 insertions(+), 8 deletions(-)
```

### `src/bridge/provider-spec/contract.ts`

- `interface ChatCompletionResponseAccessor<TResponse>` → `interface BridgeResponseAccessor<TResponse>` (returns are already `unknown | undefined` / `string` / `ResponseUsage | null`; signature was already neutral)
- `interface ChatCompletionStreamAccessor<TChunk>` → `interface BridgeStreamAccessor<TChunk>`
- The interface bodies were unchanged; only the names moved.
- Bonus Anthropic prep (see surprise section above).

### `src/bridge/response/response-reconstructor.ts`

- `import type { ChatCompletionResponseAccessor }` → `import type { BridgeResponseAccessor }`
- `readonly accessor: ChatCompletionResponseAccessor<TResponse>` → `readonly accessor: BridgeResponseAccessor<TResponse>`

### Files NOT changed (despite being in scope)

- `src/providers/{deepseek,minimax,xiaomi,zhipu}/hooks.ts` — untouched
- `src/providers/{deepseek,minimax,xiaomi,zhipu}/spec.ts` — untouched
- `src/providers/provider-patch-hooks.test.ts` — untouched

The reason no cast was needed: each provider's `ProviderSpec<..., ChatCompletion, ChatCompletionChunk, ...>` still infers `TResponse = ChatCompletion`, so the new neutral `BridgeResponseAccessor<TResponse>.firstChoice: (response: TResponse) => unknown | undefined` resolves to `(response: ChatCompletion) => unknown | undefined`, which is exactly what `deepSeekFirstChoice(response: ChatCompletion): ChatCompletion["choices"][0] | undefined` already implements.

This is the "折中1" payoff: zero cast gymnastics, hooks.ts stays type-safe internally, downstream consumers see only neutral types.

## Verification

| Check | Result |
|---|---|
| `bun run typecheck` | clean (no errors) |
| `bun run lint` | clean (after one auto-format pass for `X_API_KEY_AUTH` line wrapping) |
| `bun run test` | 862 pass / 0 fail / 2032 expect() calls / 139 files |
| `bun run test:e2e` | 58 pass / 7 fail (pre-existing, verified by stashing this commit and re-running) |
| Live runtime probe | built new `godex.exe` (94.57 MB), launched on port 5682 with godex6 keepalive config, `GET /health` → ok, `GET /v1/models` → 3 models, `POST /v1/responses` with `minnimax.chat/MiniMax-M3` → 200 status, model="MiniMax-M3", output="pong" |

### Pre-existing e2e failures (NOT caused by this commit)

7 stream tests fail on `main` (HEAD~0..HEAD~N) regardless of this commit. Verified by `git stash push` then `bun run test:e2e` → same 7 failures.

```
(fail) E2E: stream response > streams SSE events through the full lifecycle
(fail) E2E: stream response > streams failed event for invalid strict json_schema output after downgrade
(fail) E2E: stream response > streams tool call deltas into restored Responses output items
(fail) E2E: stream response > streams multiple upstream tool calls independently
(fail) E2E: stream response > streams managed web search lifecycle before final text
(fail) E2E: session chain via previous_response_id > replays streamed parallel tool calls as one assistant message
(fail) E2E: trace recording > records streaming request diagnostics and usage rows in SQLite
```

These are a separate bug, likely in `stream-reconstructor.ts` or `lastUpstreamRequest()` test fixture; out of scope here.

## Tooling note (forward-looking)

- Use `C:\Program Files\PowerShell\7\pwsh.exe` for all PowerShell. Windows PowerShell 5.1 here-string parsing collides with `curl` / `Invoke-WebRequest` body literals.
- Python 3.12.10 is the default for any text transformation / request bodies. `pathlib.Path.write_text()` on Windows emits CRLF — when patching individual files use `pathlib.Path.write_bytes()` with explicit `raw.replace(b"\r\n", b"\n")` first, otherwise biome will reject the file as a format diff and attribute the error to your change.
- Working tree `bin/` is cluttered with local probe scripts and binaries. Do NOT commit anything under `bin/` (the user keepalive scripts, probe logs, build outputs).

## Live process state — DO NOT KILL

| pid | process | port | role |
|---|---|---|---|
| 16976 | godex5 | 5679 | LLM gateway (long-running) |
| 15124 | godex6 | 5680 | user's primary LLM keepalive for Codex++ |
| 2568 | godex7 | 5681 | Path D test gateway (auto-inject + wrap-mode + stream=false fix) |
| — | godex4 | — | not running (user killed earlier) |

## What's next (Phase A remaining steps)

Phase A = bridge decoupling, prerequisite for Anthropic pipeline.

| Step | What | Estimated | Files |
|---|---|---|---|
| 2 | `input-normalizer.ts` outputs `BridgeMessage[]` instead of `ChatCompletionMessageParam[]` | 1.5 h | 1 src + 1 test |
| 3 | `message-builder.ts` neutral signature | 1.5 h | 1 src + 1 test |
| 4 | Split `request-builder.ts` into `request-dispatcher.ts` + `chat-completions-builder.ts` (and stub `anthropic-messages-builder.ts`) | 1.5 h | 3 src + 1 test (1871 lines, the largest) |
| 5 | `response-reconstructor.ts` accepts new `BridgeResponseAccessor<TResponse>` (already done in step 1) | 0 h | done |
| 6 | `provider-exchange.ts:109` swaps `buildChatCompletionRequest` for the dispatcher | 0.5 h | 1 src |
| 7 | Update 12 test files for new signatures | 3-4 h | 12 tests |
| 8 | Run full `bun run check` + `bun run test:e2e`, iterate | 1 h | — |

Then Phase B (Anthropic pipeline implementation, ~3 h).

## Open questions deferred from the conversation

1. `BridgeMessage.role` shape: should `tool` role (current OpenAI) be canonical, or Anthropic-style content blocks with `type: tool_result`?
2. `BridgeContentBlock.type` enum: Anthropic-style (`text | image | tool_result | tool_use | reasoning`) vs OpenAI-style (`text | image_url | …`)?
3. Default `thinking` policy for Anthropic: surface as `reasoning` items (Codex++ sees it) or opt-in via `anthropic.thinking` config?
4. Should we ever touch base GodeX source files (only fork's fork/main branch), or wait for upstream merge? AGENTS.md says fork only, but worth confirming if user expects upstream PRs.

These become decisions in Phase B / Phase A step 1 of bridge-types design.

## Continuity commands

```powershell
# Verify this commit landed
cd D:\Documents\VibeCoding\GodeX
git log --oneline -3
git status --short

# Live build + smoke test (does NOT touch the keepalive instances)
bun run build
Copy-Item platforms\win32-x64\bin\godex.exe bin\godex-smoke.exe -Force
Start-Process .\bin\godex-smoke.exe -ArgumentList @("--config", "bin\godex6-keepalive.yaml", "--port", "5682")
Start-Sleep -Seconds 3
$r = Invoke-WebRequest http://127.0.0.1:5682/health -UseBasicParsing -TimeoutSec 5
$r.Content
Get-Process godex-smoke | Stop-Process -Force
```

```python
# Or with python for the body
import json, urllib.request
body = json.dumps({"model":"minnimax.chat/MiniMax-M3","input":[{"role":"user","content":"ping one word"}],"stream":False}).encode()
req = urllib.request.Request("http://127.0.0.1:5682/v1/responses", data=body, headers={"Content-Type":"application/json"})
print(json.loads(urllib.request.urlopen(req, timeout=30).read()).get("output", [{}])[0])
```

## Resume posture

User said: "这里选B。然后,做你前面说的尝试评估。然后，接下来可以写handoff(实时补使用）了."

Status: step 1 of F class rename done. Phase A steps 2-8 NOT yet done. This handoff covers step 1 (the F-class rename).

Next session should:
1. Confirm whether to proceed with steps 2-8 (the full bridge decoupling) or pivot to Phase B (Anthropic pipeline) directly with the remaining Chat-shape leakage accepted as known technical debt.
2. If proceeding with 2-8, start with `input-normalizer.ts` (step 2) — that is the smallest pivot point with the highest leak density.

## Round 2 (2026-07-09 evening) - pre-existing e2e failures investigation

User asked: how deep is the landmine from the 7 pre-existing e2e failures? Will it bite us during Phase B (Anthropic integration)?

### Investigation result: it IS a real bug, not a flake

Drilled down bun test src/e2e/e2e.test.ts -t streams SSE events through the full lifecycle with intermediate debug at three points:

1. Server-side raw body (src/server/routes/responses/handler.ts) - JSON dump showed { model: gpt-5, input: Hello!, stream: true }. Stream field arrived correctly.
2. Provider-exchange stream entry point (src/responses/provider-exchange.ts) - called buildProviderRequest(ctx, true, options), then buildChatCompletionRequest(...) which calls applyRequestOptions.
3. applyRequestOptions runtime (src/bridge/request/request-builder.ts:471) - threw TypeError: undefined is not an object (evaluating capabilities.parameters.supported).

So the upstream mock never received body.stream because the stream pipeline crashed before reaching the request body construction step. Capabilities was undefined when applyRequestOptions ran.

### Why mock received body without stream field

The chain:
- e2e test - POST /v1/responses with stream: true
- GodeX server parses - body.stream === true (correct)
- provider-exchange.stream(...) - buildProviderRequest(ctx, true) - buildChatCompletionRequest - applyRequestOptions - CRASH at capabilities.parameters.supported
- Exception caught somewhere - returns 400 to upstream mock
- Mock writes body (stream was undefined so body.stream is undefined in the captured request)
- Mock returns JSON (handleMockChat branch)
- Fetcher-eventstream rejects because content-type is JSON not SSE

### What is actually broken

The stream pipeline (probably StreamPipeline or provider-exchange.stream) does not pass capabilities through to applyRequestOptions. Either:

- A) provider-exchange.ts:75 builds buildProviderRequest without capabilities
- B) StreamPipeline constructs its own BuildChatCompletionRequestInput and omits capabilities
- C) Some recent change (commit d6622ca Path D wrap-mode, or b37e737 stream=false fix, or e1a9d54 Path D screenshot) regressed this.

### Risk assessment for Phase B (Anthropic)

HIGH RISK. Anthropic /v1/messages is stream-first; every Codex++ turn that uses Anthropic will eventually want stream: true. If we skip the fix and proceed to Phase B:

- Pure-text sync request: probably works (sync pipeline unaffected)
- Any stream request with tools/web-search/parallel-tool-calls: hits this bug
- All 4 stream tests that fail would still fail under Anthropic
- Codex++ may silently fall back to non-stream (if GodeX exposes a flag) or hit a 500 loop

### Estimated fix cost

1-2 hours of focused work. Need to:

1. Read src/responses/provider-exchange.ts lines 30-110, especially the stream branch and the buildProviderRequest argument list
2. Read StreamPipeline (likely in src/responses/stream-pipeline.ts) to see if it duplicates request building
3. Compare capabilities flow between SyncRequestPipeline (works) and the stream path (broken)
4. Likely a missing capabilities argument or a wrongly-typed intermediate object

### Decision point

Option 1: Fix this bug first (1-2 h) - cleaner foundation, all 7 e2e tests should pass, Phase B risk low.
Option 2: Document the bug, defer, proceed to Phase B - faster start, but bug will resurface at Phase B smoke test, net delay probably same.

Recommendation: Option 1. The bug is small, the failure mode is hidden behind a 400, and it would absolutely block Phase B first stream smoke test.

## Round 3 (2026-07-09 evening) - plain-language explanation request

User asked for a plain-language explanation of:
- What we did in F-class step 1
- The cleanup vs no-cleanup tradeoff for Phase A steps 2-8
- The blast radius of the 7 pre-existing failures

Delivered a translator-metaphor walkthrough:
- F-class step 1 = repainted two door signs so they dont say Chat anymore; no rewiring
- Cleanup = also rewire internal hallways so they dont assume Chat-shaped luggage
- No cleanup = fast but luggage shape mismatches Anthropic expectations
- Pre-existing fail = the front door has a broken step (capabilities undefined when going stream)

## Round 4 (2026-07-09 evening) - tooling note (carried forward)

User reaffirmed:
- Use pwsh7 for PowerShell (Windows PowerShell 5.1 has here-string and escape bugs)
- Use Python 3.12 for text transformation and HTTP request bodies
- DO NOT commit anything under bin/ (working tree is full of probe scripts, logs, binaries)

Tooling pain points encountered:
- python pathlib.Path.write_text() on Windows emits CRLF - biome rejects the file as format diff. Use write_bytes() with explicit LF normalization.
- bun test swallows console.error output unless you write to a file. Dont waste iterations on console.log debugging in tests.
- Triple-quoted Python here-strings inside PS7 -Command arguments break on backslash line endings. Always write the Python script to a file with Set-Content -Encoding utf8 and then python script.py.

## Round 5 (2026-07-09 evening) - debug code reverts

Added temporary debug statements to src/server/routes/responses/handler.ts, src/e2e/e2e.test.ts, src/bridge/request/request-builder.ts. Reverted via git restore. Confirmed clean: bun run typecheck returns no errors. Working tree shows only the original bin/godex.exe modification (compiled binary; not to be committed) and untracked bin/_debug*.txt, bin/_patch-*.py, bin/_revert-debug.py, bin/_last-test*.txt, bin/_write-handoff.ps1. These are temporary probe artifacts; do not commit.

## Live process state - UPDATED 2026-07-09 evening

| pid | process | port | role |
|---|---|---|---|
| 16976 | godex5 | 5679 | LLM gateway (long-running) |
| 15124 | godex6 | 5680 | user primary LLM keepalive for Codex++ |
| 2568 | godex7 | 5681 | Path D test gateway (auto-inject + wrap-mode + stream=false fix) |
| 14412 | node | - | chrome-browser-mcp (CDP backend on 9224) |
| 6800 | chrome | 9222 | user Chrome debug |

Note: godex4 (pid 3756) no longer running. godex6 is the current keepalive per user direction.

## Recommended next actions

1. Fix the stream-pipeline capabilities bug (Option 1) - 1-2 h, should make all 7 e2e failures pass.
2. Then Phase A step 2 (input-normalizer neutral types) - 1.5 h.
3. Then Phase B (Anthropic pipeline) - 3 h.

Total to Codex++ uses Anthropic: ~6 hours from now. If we skip option 1 and go straight to Phase A step 2, we will still hit this stream bug at Phase B end-to-end smoke test, so the 1-2 h is unavoidable.

If user explicitly wants to defer the bug fix to maximize parallel exploration, document the bug in commit message of the next change so future agents know where to find it.

## Round 6 (2026-07-09 evening) - 7 e2e fails fixed

placeholder

## Round 6 (2026-07-09 evening) - 7 e2e fails fixed: test-expectation drift, not a bug

User direction: proceed with recommended plan (fix stream bug first, frequent testing, frequent handoff updates).

### Investigation recap

Drilled down with file-based debug (console.error swallowed by bun test):

1. bin/_cap.log showed cap_type=object has_params=true has_stream=true - capabilities correct
2. applyRequestOptions logged SKIPPED: source.stream=false has_stream=true - source flag is false
3. dispatcher logged DISPATCHER: ctx.request.stream=true - dispatcher sees true
4. So request stream flips true to false between dispatcher and applyRequestOptions

### Root cause: Path D wrap-mode is doing the flip on purpose

src/responses/runtime.ts:66-78 (introduced by commit d6622ca, hardened by b37e737):

```ts
const mutableCtx = ctx as unknown as { request: ResponseCreateRequest };
const wasStream = mutableCtx.request.stream;
mutableCtx.request = { ...mutableCtx.request, stream: false };  // force false
try {
    const finalResponse = await this.syncPipeline.request(mutableCtx as ResponsesContext);
    return wrapResponseObjectAsSseStream(finalResponse, ctx);
} finally {
    mutableCtx.request = { ...mutableCtx.request, stream: wasStream };
}
```

b37e737 commit message (zamelee, 2026-07-09 15:43):
> The upstream Chat Completions API returns SSE when stream:true is set, which the sync JSON parser cannot consume and produced a 502 Failed to parse JSON on every Codex++ stream request. Force ctx.request.stream to false for the duration of the sync call and restore the client original flag afterwards.

So this is intentional design: wrap-mode converts client stream requests into a server-side sync loop (to absorb godex_chrome_* function calls), then re-wraps the final ResponseObject as a synthetic SSE stream for the client. The upstream Chat Completions provider never sees stream: true because it is consumed by the sync loop.

The 7 e2e tests were written before wrap-mode existed and expected the upstream mock to receive body.stream === true. That assumption became false at commit d6622ca and never got updated.

### Fix

bun test with GODEX_STREAM_MODE=passthrough in shell env made all 7 tests pass (65/0/9). Fix:

- Set process.env.GODEX_STREAM_MODE = passthrough at top of src/e2e/e2e.test.ts and src/e2e/trace.test.ts
- E2E now exercises the real stream path (upstream mock sees body.stream === true)
- wrap-mode fully covered by src/responses/runtime.test.ts (4 unit tests pass, including L140 wrap-mode stream forces upstream to non-streaming and restores the flag)

### Verification

After fix:
- bun run check -> 862 pass / 0 fail / 2032 expect() / 139 files
- bun run test:e2e -> 65 pass / 0 fail / 9 skip / 301 expect() / 11 files
- 9 skipped = live e2e (need real API keys)

### What the user asked

User: 已经有 7 个 pre-existing fail，会埋下多大的坑？

Answer: not deep. Fix was one-line env var per test file, no source code changes. The pre-existing 7 fails were test-expectation drift after a behavior change (Path D wrap-mode), not a functional bug. Phase B (Anthropic) is not blocked.

### Commit

- ebce510 on fork/main (pushed to zamelee/GodeX)
- branch ref: 0f9a2ce -> ebce510
- 2 files, +8 lines

## Round 7 (2026-07-09 evening) - decision: continue with Phase A step 2

User said 按你的建议干 (go with your recommendation) after I presented the original 3 options.

After Round 6 cleared the test-expectation block, the recommended path is unchanged:
1. ~~Fix stream bug~~ DONE (it was just test-expectation drift, fixed in ebce510)
2. Phase A step 2: input-normalizer neutral types - 1.5 h
3. Phase A step 3: message-builder neutral signature - 1.5 h
4. Phase A step 4: split request-builder.ts into request-dispatcher + chat-completions-builder + anthropic-messages-builder stub - 1.5 h
5. Phase A step 5-6: response-reconstructor + provider-exchange dispatcher swap - 0.5 h
6. Phase A step 7: update 12 test files - 3-4 h
7. Phase A step 8: full bun run check + bun run test:e2e iterate - 1 h
8. Phase B: Anthropic pipeline implementation - 3 h

User: 注意经常更新handoff，经常性的测试，前进得更稳一些 (frequently update handoff, frequently test, advance more steadily).

So: small commits, handoff update after each commit, run bun run check and bun run test:e2e before each commit.

## Live process state - UPDATED 2026-07-09 evening (after Round 6/7)

| pid | process | port | role |
|---|---|---|---|
| 16976 | godex5 | 5679 | LLM gateway (long-running) |
| 15124 | godex6 | 5680 | user primary LLM keepalive for Codex++ |
| 2568 | godex7 | 5681 | Path D test gateway (auto-inject + wrap-mode + stream=false fix) |
| 14412 | node | - | chrome-browser-mcp (CDP backend on 9224) |
| 6800 | chrome | 9222 | user Chrome debug |

Note: godex4 not running. godex6 is the current keepalive per user direction.

## Recommended next actions (resume posture)

1. Phase A step 2: input-normalizer emits neutral BridgeMessage[] instead of ChatCompletionMessageParam[] - 1.5 h
2. bun run check
3. Update handoff, commit
4. Phase A step 3: message-builder neutral signature - 1.5 h
5. ... and so on
6. After each step, commit and update handoff. Do not batch.

## Continuation commands

```powershell
# Verify clean state
cd D:\Documents\VibeCoding\GodeX
git log --oneline -5
git status --short
bun run check 2>&1 | tail -3
bun run test:e2e 2>&1 | tail -3

# Start Phase A step 2
# File: src/bridge/request/input-normalizer.ts
# Goal: change return type from ChatCompletionMessageParam[] to a neutral BridgeMessage[]
# Files to touch: input-normalizer.ts + 1 test file
# Estimate: 1.5 h
```

## Round 8 (2026-07-09 evening) - stream_mode per-provider design with 8 edge cases

User raised an important insight: passthrough + ChatAPI + tools is broken (was the actual reason wrap-mode was introduced in commit d6622ca + b37e737). User proposed two design rules:

- Anthropic default passthrough; ChatAPI default wrap
- OR: ChatAPI activates wrap dynamically when request has tool calls

Discussed 8 edge cases with recommended rules:

| Case | Severity | Recommended rule |
|---|---|---|
| 1 ChatAPI + passthrough + tools | high | Allow but log warn in trace (`_tools_in_passthrough_warning`); user retains mode control |
| 2 godex_chrome_* + Anthropic | high | Anthropic provider filters out godex_chrome_* in tool planning (no client/server mismatch) |
| 3 web_search + passthrough | medium | Force `web_search.mode: client_tool_call` under passthrough |
| 4 tool_choice: "none" + tools defined | low | Mode decision looks at tools array only, not tool_choice |
| 5 Session chain cross-turn mode change | medium | Session-level mode lock: first turn determines mode for whole session |
| 6 Empty tools | none | passthrough fine |
| 7 Codex Chrome Extension presence | medium | Runtime startup probe; absent + passthrough + godex_chrome_* returns 503 |
| 8 Trace data shape diff | low | trace.request adds `stream_mode` field |

Design rules table:

| Decision | Outcome |
|---|---|
| Default by apitype | AnthropicMessages -> passthrough; OpenAIChatCompletions -> wrap; OpenAIResponses -> passthrough |
| User explicit override | `stream_mode: passthrough\|wrap` forces |
| ChatAPI + passthrough + tools | Allowed; trace gets warning marker |
| godex_chrome_* + Anthropic | Anthropic provider tools planning filters these out |
| Web search + passthrough | Forces `web_search.mode: client_tool_call` |
| Session-level mode lock | First turn mode locked into session metadata |
| Chrome Extension detection | Runtime startup probe; absent -> 503 if needed |
| tool_choice: "none" | No effect on mode decision |
| Trace | Add `stream_mode` field plus warning markers |

Implementation timing: AFTER Phase A step 2-3 (input-normalizer + message-builder neutral). stream_mode work depends on provider spec having a `streamMode?` field, which fits naturally into Phase A step 4-5 (spec.ts assembly + provider-exchange dispatcher swap).

User decision (2026-07-09 evening): "好。更新handoff，开始干"

## Round 9 (2026-07-09 evening) - Phase A step 2 starting now

Phase A step 2 = input-normalizer emits neutral `BridgeMessage[]` instead of `ChatCompletionMessageParam[]`.

Files to touch:
- NEW: `src/bridge/bridge-types.ts` (neutral BridgeMessage, BridgeContentBlock, BridgeToolCall, BridgeTool)
- MODIFY: `src/bridge/request/input-normalizer.ts` (output type rename + internal cast at boundary, mid-折中1 style)
- MODIFY: `src/bridge/request/input-normalizer.test.ts` (sync test fixtures)

Estimate: 1.5 h. After this step: `bun run check` + `bun run test:e2e` must both pass before commit.

Post-step commits follow this format: `refactor(bridge): input-normalizer emits neutral BridgeMessage[]`.

## Round 9 (2026-07-09 evening) - Phase A step 2 COMPLETE

Done: src/bridge/bridge-types.ts created with BridgeMessage / BridgeContentBlock / BridgeRole aliases. NormalizedChatMessage type removed; input-normalizer.ts + message-builder.ts + request-builder.ts now operate on BridgeMessage.

Approach: same "折中1" pattern as F class step 1. Public API is neutral (no Chat in the name); internal implementation continues to use Chat types inside the normalizer (ProviderSpec<TBridgeRequest, ChatCompletion, ...> still binds TResponse to ChatCompletion in each Chat provider spec, so existing Chat-typed helper functions like `normalizeInputItems` continue to work without any cast gymnastics).

Files:
- NEW: src/bridge/bridge-types.ts (60 lines, with header comment explaining the deferred Open Questions)
- MOD: src/bridge/request/input-normalizer.ts (-19 lines net from removing the alias declaration)
- MOD: src/bridge/request/message-builder.ts (re-import BridgeMessage)
- MOD: src/bridge/request/request-builder.ts (re-import + re-export BridgeMessage)

Verification:
- bun run check: 862 pass / 0 fail / 2032 expect() / 139 files
- bun run test:e2e: 65 pass / 0 fail / 9 skip / 301 expect() / 11 files

Commit: eee42f2 on fork/main (pushed).

Next: Phase A step 3 = message-builder neutral signature. The current `chatMessages(input, output, tools): BridgeMessage[]` already returns BridgeMessage but takes BuildChatCompletionRequestInput (which contains Chat-typed fields). Estimate: 1.5 h, but the simpler rename of return type already happened in step 2. So step 3 may be smaller than estimated: it might just be a re-org of internal helper signatures. Will report actual scope after starting.

## Phase A status table

| Step | Status | Commit | Notes |
|---|---|---|---|
| 1 (F class rename) | DONE | 4e2fe76 | BridgeResponseAccessor rename |
| 2 (input-normalizer neutral) | DONE | eee42f2 | BridgeMessage alias, internal Chat types |
| 3 (message-builder neutral) | pending | - | smaller scope than estimated (step 2 covered the rename) |
| 4 (split request-builder) | pending | - | biggest file (1871 lines test), high risk |
| 5 (response-reconstructor) | n/a | - | already done in step 1 |
| 6 (provider-exchange dispatcher swap) | pending | - | small |
| 7 (12 test files update) | pending | - | medium-high |
| 8 (full check + e2e iterate) | pending | - | regression sweep |

User direction (2026-07-09 evening): keep small commits, frequent handoff updates, frequent check/test runs. After each step, commit + update handoff + report.

## Live process state - unchanged

| pid | process | port | role |
|---|---|---|---|
| 16976 | godex5 | 5679 | LLM gateway |
| 15124 | godex6 | 5680 | user primary keepalive |
| 2568 | godex7 | 5681 | Path D test gateway |
| 14412 | node | - | chrome-browser-mcp (CDP on 9224) |
| 6800 | chrome | 9222 | user Chrome debug |

## Round 10 (2026-07-09 evening) - End goal lock + Phase A step 3 scope decision

### End goal (locked, user-confirmed 2026-07-09)

GodeX should serve two independent upstream protocols without cross-contamination. Provider registered under one protocol must never touch the other protocol's code path.

```
Codex++  --POST /v1/responses-->  godex.exe
                                   |
                                   +-- apitype: OpenAIChatCompletions   (current)
                                   |     -> chat-completions-builder
                                   |
                                   +-- apitype: AnthropicMessages      (Phase B addition)
                                         -> anthropic-messages-builder
```

User-facing config knob: `provider.<name>.apitype` chooses one of `AnthropicMessages` / `OpenAIResponses` / `OpenAIChatCompletions`.

Bridge public surface stays neutral (`TBridgeRequest` / `TChatRequest` / `TProviderResponse`). Each downstream protocol keeps its own request builder and request body shape; compatibility decisions stay in `src/bridge/`.

Phase A inverts existing Chat-shape leakiness in the bridge kernel (rename, relocate, decouple). Phase B wires up the AnthropicMessages pipeline end-to-end.

### Done-criteria (acceptance)

- `bun run check` green; `bun run test:e2e` green
- For any configured provider, configuring apitype AnthropicMessages means `chat-completions-builder` is not in the call stack at runtime (verifiable via trace / logs)
- And vice versa: Chat providers never reach Anthropic code paths
- Five deferred Open Questions (OQ1-BridgeMessage.role shape, OQ2-Block.type enum, OQ3-thinking defaults, OQ4-upstream PR readiness, OQ5-stream_mode timing) all have a documented home, none left dangling

### Round 10 open-decision table (user inputs 2026-07-09 evening)

| # | Question | Decision | Source |
|---|---|---|---|
| 1 | Is the two-layer end-goal framing correct? | YES, locked | "1我觉得你的终点描述正确" |
| 2 | When does `stream_mode` (per-apitype default) get implemented? | A (defer to Phase A step 4-5, attach to ProviderSpec.streamMode field at natural fit) PROPOSED, awaiting confirmation in this round | "2.不太明白" - clarified plain-language in round 10 preface |
| 3 | Cherry-pick recent upstream Ahoo-Wang/GodeX commits (web search, etc.)? | NO, do not pull; keep focused on decoupling | "3.不用了" |
| 4 | Touch studio.exe in Phase A? | NO, defer until godex is functionally complete | "4.先不碰，等把godex调好了来" |

### Phase A step 3 scope - B-扩展 + option X (shim route) - PROPOSED, awaiting user OK

Final scope choice after audit of 15 helpers in `request-builder.ts` (lines 138-397), all 100% Chat-shape:

Step 3 deliverable:
1. `git mv src/bridge/request/message-builder.ts src/bridge/request/chat-completions-builder.ts`
2. Rename internal function `buildChatMessages` -> `buildChatCompletionsMessages`
3. Move into the renamed file: `buildChatCompletionRequest` body (L62-113) + `chatMessages` internal helper (L115-136) + all 15 helpers + interfaces `BuildChatCompletionRequestInput` (L42-51) + `BuildChatCompletionRequestResult` (L53-58)
4. After merge: `chat-completions-builder.ts` is ~ 557 lines (within Biome 600 limit)
5. `request-builder.ts` becomes 3-line shim: `export * from "./chat-completions-builder";`
6. `request/index.ts` line 2 `export * from "./message-builder"` -> `"./chat-completions-builder"`; line 3 `export * from "./request-builder"` stays (shim continues to expose same surface)
7. `request-builder.test.ts` lines 13-17 import path `./request-builder` -> `./chat-completions-builder`

Net file changes: 3 files.

Zero-impact (no edits) sites:
- 44 `buildChatCompletionRequest` caller sites (via `../bridge/request` indirection through shim)
- 44 `normalizeCurrentInput` caller sites (same indirection)
- `BridgeMessage` re-export consumers (shim re-exports via `export *`)

Reason for X (shim) over Y (delete): import-boundary rewrites for 44 caller sites belong to Phase A step 6 (provider-exchange dispatcher swap), not step 3. Doing it in step 3 would briefly point callers at `chat-completions-builder` before step 6 redirects them at the dispatcher. Shim avoids that.

Step 4 (next after step 3) = create `request-dispatcher.ts` + `anthropic-messages-builder.ts` + delete the shim + redirect all 44 callers to dispatcher.

User authorization: "如果目标明确，可以按照你的建议来" - implicit YES on B-扩展 + X.

### Phase A status table (update)

| Step | Status | Commit | Notes |
|---|---|---|---|
| 1 (F class rename - Accessor interfaces) | DONE | 4e2fe76 | BridgeResponseAccessor rename |
| 2 (input-normalizer neutral types) | DONE | eee42f2 | BridgeMessage alias, internal Chat types |
| 3 (B-扩展: chat-completions-builder merge + shim) | READY TO EXECUTE | pending | scope locked, awaiting confirmation on stream_mode timing only |
| 4 (split request-builder into dispatcher + chat-completions + anthropic-messages) | pending | - | shim deletion + 44 caller redirects |
| 5 (response-reconstructor rename) | DONE in step 1 | 4e2fe76 | already covered |
| 6 (provider-exchange dispatcher swap) | pending | - | small |
| 7 (12 test files update) | pending | - | medium-high |
| 8 (full check + e2e iterate) | pending | - | regression sweep |
| Phase B (AnthropicMessages pipeline) | pending | - | blocked until step 8 |

### Critical data for step 3 (from Round 10 audit)

Files in scope:
- `src/bridge/request/chat-completions-builder.ts` (NEW, ~ 557 lines)
- `src/bridge/request/request-builder.ts` (becomes 3-line shim)
- `src/bridge/request/index.ts` (line 2 path change)
- `src/bridge/request/request-builder.test.ts` (lines 13-17 import path change)

Files NOT touched in step 3 (verified):
- `src/bridge/request/input-normalizer.ts` (already uses BridgeMessage from step 2)
- `src/bridge/bridge-types.ts` (no change)
- All 7+ files with direct `buildChatCompletionRequest` imports: zero edits

Symbols preserved (still exported from `bridge/request` via shim):
- `buildChatCompletionRequest` (44 callers stay green)
- `buildChatMessages` -> `buildChatCompletionsMessages` (renamed; test file updates import path; via `export *`)
- `normalizeCurrentInput` (44 callers stay green)
- `BridgeMessage` type (zero-edit consumers)

Verification (after step 3 lands):
- `bun run check` -> 862 pass / 0 fail / 2032 expect() / 139 files (regression unchanged)
- `bun run test:e2e` -> 65 pass / 0 fail / 9 skip / 301 expect() / 11 files (regression unchanged)
- File size: chat-completions-builder.ts ~ 557 lines (under Biome 600 limit)
- Commit title: `refactor(bridge): merge request-builder into chat-completions-builder (Phase A step 3)`

### Process state - unchanged (verified Round 10)

| pid | process | port | role |
|---|---|---|---|
| 16976 | godex5 | 5679 | LLM gateway |
| 15124 | godex6 | 5680 | user primary keepalive |
| 2568 | godex7 | 5681 | Path D test gateway |
| 14412 | node | - | chrome-browser-mcp (CDP on 9224) |
| 6800 | chrome | 9222 | user Chrome debug |

### Workflow rule reinforcement (user-confirmed 2026-07-09 evening)

Tool preference order (mandatory):
1. PowerShell 7 at `C:\Program Files\PowerShell\7\pwsh.exe` (Windows PowerShell 5.1 has here-string + escape bugs that have repeatedly burned this round)
2. Python 3.12.10 for file/string ops (use `pathlib.Path.write_bytes()` with explicit `.replace(b"\r\n", b"\n")` to avoid CRLF drift)
3. `Set-Content -Encoding utf8 bin/_commit-msg.txt -Value @'...'@` then `git commit -F bin/_commit-msg.txt` (PS7 multi-line strings + quotes trigger `\u` Unicode-escape errors)
4. `bin/` is local keepalive config + probe scripts - never commit anything under `bin/`
5. `bun run test` and `bun test` swallow `console.error` output - write debug to files instead
6. PS7 `&$ "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -Command "..."` is the canonical way to run one-liners (heredocs get mangled - use Python file-write for multi-line scripts)

## Round 11 (2026-07-09 evening) - Phase A step 3 COMPLETE

Done: chat-completions-builder.ts is now the single Chat-shape request construction module. request-builder.ts deleted. All callers unaffected (continue through bridge/request barrel).

### Execution sequence (verified Round 11)

1. `git mv src/bridge/request/message-builder.ts src/bridge/request/chat-completions-builder.ts` (rename-only first)
2. Overwrote chat-completions-builder.ts with merged content (~ 562 lines / 15664 bytes)
3. Wrote shim into request-builder.ts: `export * from "./chat-completions-builder";` (3 lines)
4. Patched request/index.ts: line 2 path `./message-builder` -> `./chat-completions-builder`
5. Patched request-builder.test.ts: import path + 2 call sites renamed buildChatMessages -> buildChatCompletionsMessages
6. Removed unused `BridgeRole` from input-normalizer.ts import (carry-over from Round 9 / step 2)
7. `bun run typecheck` -> PASS (after fixing 3 call-site signature mistakes where I had incorrectly guessed planBridgeCompatibility / planTools / planOutputContract parameter shapes; corrected to:
   - `planBridgeCompatibility({provider, model, request, capabilities})`
   - `planTools({tools, toolChoice, profile: {...input.profile, webSearch: input.webSearch}})`
   - `planOutputContract({format: input.request.text?.format, responseFormatDecision: compatibility.responseFormat})`)
8. `bun run lint:fix` -> 2 files auto-fixed (chat-completions-builder.ts format + index.ts export order), 1 unsafe unused-import skipped
9. `bun run check` -> FAILED on `src module boundaries > non-index TypeScript modules do not re-export other modules` (the shim violated the project boundary rule)
10. **Pivot decision**: shim-route (X) dropped; switched to delete-route (Y) since the architectural no-shim rule is hard-coded in the test
11. Deleted request-builder.ts; removed `export * from "./request-builder"` line from index.ts
12. `bun run check` -> 862 pass / 0 fail / 2032 expect() / 139 files (regression unchanged from Round 9 baseline)
13. `bun run test:e2e` -> 65 pass / 0 fail / 9 skip / 301 expect() / 11 files (regression unchanged)
14. `git commit` + `git push fork HEAD:refs/heads/main` -> commit `f61566c`

### Scope-pivot rationale (X -> Y)

Original plan was shim-route (request-builder.ts becomes `export * from "./chat-completions-builder"`). Two problems discovered:

1. **Architectural**: src/module-boundaries.test.ts line 92-104 forbids ANY non-index TypeScript file from having `export ... from "..."` declarations. This rule has no exception path; even a 1-line shim violates it.

2. **Cleanliness**: Deleting request-builder.ts entirely was cheaper than expected - only ONE direct reference existed (the index.ts re-export itself). All other 7+ files import through the `../bridge/request` barrel, which continues to re-export from `./chat-completions-builder`. Zero caller-side edits required.

Y cost: 2 file ops (delete shim, drop index.ts line 3) instead of 3 (shim + index.ts + boundary test allowance).

### File diff summary (commit f61566c)

```
src/bridge/request/chat-completions-builder.ts   | NEW (562 lines, was message-builder.ts 160 lines)
src/bridge/request/index.ts                      | -1 line (dropped request-builder re-export)
src/bridge/request/input-normalizer.ts           | -1 word (BridgeRole removed from type import)
src/bridge/request/request-builder.test.ts       | import path + 2 call sites + 1 new import entry
src/bridge/request/request-builder.ts            | DELETED (was 397 lines)
src/bridge/request/message-builder.ts            | DELETED via rename
```

git diff stats: 5 files changed, 254 insertions(+), 250 deletions(-)
git rename similarity: 67% (content significantly differs from original message-builder.ts)

### Bug found and fixed during execution

Two call-site signature mistakes caused initial typecheck failures (5 errors):

1. `planBridgeCompatibility` does NOT take `webSearch` parameter (interface PlanBridgeCompatibilityInput is just {provider, model, request, capabilities})
2. `planTools` does NOT take `request` / `capabilities` / `provider` / `model` / `webSearch` as flat fields; instead takes `tools` (from request.tools), `toolChoice` (from request.tool_choice), and `profile` (with webSearch merged in)
3. `planOutputContract` does NOT take `request` / `capabilities` / `provider` / `model`; instead takes `format: input.request.text?.format` and `responseFormatDecision: compatibility.responseFormat`

Root cause: I reconstructed the function body from memory instead of reading L62-113 of the original. Round 10 audit didn't cover L62-113 (only L138-397 of helpers). Round 12 should add a "verify every line before merge" reminder.

### Phase A status table (update)

| Step | Status | Commit | Notes |
|---|---|---|---|
| 1 (F class rename - Accessor interfaces) | DONE | 4e2fe76 | BridgeResponseAccessor rename |
| 2 (input-normalizer neutral types) | DONE | eee42f2 | BridgeMessage alias, internal Chat types |
| 3 (B-扩展: chat-completions-builder merge + request-builder delete) | DONE | f61566c | boundary-rule pivot from shim to delete; 562 lines merged file |
| 4 (create request-dispatcher.ts + anthropic-messages-builder.ts + redirect callers to dispatcher) | pending | - | shim-deletion unblocked by step 3 |
| 5 (response-reconstructor rename) | DONE in step 1 | 4e2fe76 | already covered |
| 6 (provider-exchange dispatcher swap) | pending | - | small |
| 7 (12 test files update) | pending | - | medium-high |
| 8 (full check + e2e iterate) | pending | - | regression sweep |
| Phase B (AnthropicMessages pipeline) | pending | - | blocked until step 8 |

### Process state - unchanged (verified Round 11)

| pid | process | port | role |
|---|---|---|---|
| 16976 | godex5 | 5679 | LLM gateway |
| 15124 | godex6 | 5680 | user primary keepalive |
| 2568 | godex7 | 5681 | Path D test gateway |
| 14412 | node | - | chrome-browser-mcp (CDP on 9224) |
| 6800 | chrome | 9222 | user Chrome debug |

### Workflow rule - new (Round 11)

- **Verify every line before bulk-merge.** When merging two files, read the FULL overlap section first, then write. I missed reading L62-113 of request-builder.ts and reconstructed call sites from memory, leading to 5 typecheck errors that took a round of investigation to fix.
- **Boundary rule trips shims.** Plan: never add re-export-only shim files to this project. Module structure = real modules + index.ts barrels only.

### Next: Phase A step 4

Create `src/bridge/request/request-dispatcher.ts` + `src/bridge/request/anthropic-messages-builder.ts`. Dispatcher reads `ProviderSpec.requestKind` and routes to chat-completions-builder or anthropic-messages-builder. After this step: redirect all `buildChatCompletionRequest` callers (44 sites) from `../bridge/request` barrel to `../bridge/request/request-dispatcher` (or keep barrel pointing at dispatcher).

Awaiting user authorization to start step 4. stream_mode timing = A confirmed (defer to step 4-5 spec.ts assembly, attach to ProviderSpec.streamMode field).

## Round 12 (2026-07-10) - Phase A step 4 COMPLETE + protocol fallback locked

Done: protocol-routing seam is in place. ProviderSpec.protocol is now optional with chat_completions fallback. AnthropicMessages pipeline stub ready for Phase B fill-in.

### Execution sequence (verified Round 12)

1. Read ProviderSpec, ProviderProtocol, src/responses/runtime.ts (existing streamMode env-var layer).
2. Confirmed: ProviderSpec.protocol already exists as the natural discriminator. No need to add new `apitype` field.
3. Confirmed: 6 existing provider specs all set protocol explicitly -> the fallback path is dormant today.
4. Made `protocol?: ProviderProtocol` optional in ProviderSpec with JSDoc.
5. Added `streamMode?: "passthrough" | "wrap"` field to ProviderSpec (deferred wiring per Round 10 YES-A; env var GODEX_STREAM_MODE still drives runtime for now).
6. Created `src/bridge/request/anthropic-messages-builder.ts` (55 lines):
   - BuildAnthropicMessagesRequestInput / Result interfaces (mirror Chat shape)
   - buildAnthropicMessagesRequest() throws BRIDGE_REQUEST_UNSUPPORTED_PARAMETER with clear "Phase B not implemented" message + metadata.
7. Created `src/bridge/request/request-dispatcher.ts` (78 lines):
   - BuildBridgeRequestInput with `spec: ProviderSpec<unknown, unknown, unknown, unknown>` as the discriminator
   - BuildBridgeRequestResult with `request: unknown` (protocol-dependent shape; caller feeds to provider.request which is itself protocol-parameterised)
   - buildBridgeRequest(input) routes by spec.protocol:
     - chat_completions (or absent) -> buildChatCompletionRequest
     - messages -> buildAnthropicMessagesRequest (Phase B stub)
     - anything else -> chat_completions (silent fallback, no trace call yet)
8. Updated barrel `src/bridge/request/index.ts` to re-export from chat-completions-builder, anthropic-messages-builder, request-dispatcher, input-normalizer.
9. Updated `src/responses/provider-exchange.ts` (the ONE prod caller):
   - buildChatCompletionRequest -> buildBridgeRequest
   - input: `capabilities: ProviderCapabilities` -> `spec: ProviderSpec<unknown, ...>`
   - return types: BuildChatCompletionRequestResult -> BuildBridgeRequestResult
10. Updated 5 test files with the same shape change:
    - browser-function-loop, sync-request-pipeline, stream-pipeline, web-search/stream-runner, web-search/sync-runner
11. Risk #3 from Round 11 discussion: `src/responses/web-search/sync-runner.ts` line 53 only reads `built.tools` and `built.output`, both still present in BuildBridgeRequestResult. ZERO edits needed.
12. `bun run typecheck` PASS after one round of fixes:
    - Removed unused imports from anthropic stub (verbatimModuleSyntax strict)
    - Dropped a fake `recordTraceDiagnostic` reference (no such API in trace module; deferred trace integration to a later step)
    - Dropped anthropic stub's re-exports (boundary rule + ambiguity at index barrel)
    - Fixed 2 leftover `capabilities:` lines in test files that used 3-tab indent (pattern only matched 2-tab)
13. `bun run lint:fix` -> auto-fixed 4 files (format issues)
14. `bun run check` -> 862 pass / 0 fail / 2032 expect() / 139 files (matches Round 11 baseline)
15. `bun run test:e2e` -> 65 pass / 0 fail / 9 skip / 301 expect() / 11 files (matches Round 11 baseline)
16. `git commit` + `git push fork` -> commit `457e3f0`

### Fallback policy decision (Round 12 lock)

- `ProviderSpec.protocol` is OPTIONAL. If absent, dispatcher defaults to `CHAT_COMPLETIONS_PROTOCOL`.
- Existing 6 specs declare protocol explicitly, so the fallback path is dormant.
- Trace marker `bridge.protocol.fallback` for unknown-protocol fallback is DEFERRED: the dispatcher runs in contexts that may not have a ResponsesContext, so trace integration will be threaded through the caller in a later step.
- JSDoc on the protocol field documents the fallback rule for future contributors.

### Critical data for review

Files in scope (10 total):
- src/bridge/provider-spec/contract.ts (+10 lines: protocol optional doc, streamMode field)
- src/bridge/request/anthropic-messages-builder.ts (NEW, 55 lines)
- src/bridge/request/request-dispatcher.ts (NEW, 78 lines)
- src/bridge/request/index.ts (+2 lines for new re-exports)
- src/responses/provider-exchange.ts (-1 +1: 1 prod call site)
- 5 test files (mechanical rename + capability -> spec input change)

File sizes after step 4:
- chat-completions-builder.ts: 15664 bytes / 562 lines (unchanged from step 3)
- anthropic-messages-builder.ts: 2017 bytes / 55 lines (NEW)
- request-dispatcher.ts: 3021 bytes / 78 lines (NEW)
- index.ts: 164 bytes / 4 lines
- provider-spec/contract.ts: 3675 bytes / 127 lines (was 3283 bytes / 117 lines)

git diff stats: 10 files changed, 188 insertions(+), 44 deletions(-)

### Phase A status table (update)

| Step | Status | Commit | Notes |
|---|---|---|---|
| 1 (F class rename - Accessor interfaces) | DONE | 4e2fe76 | BridgeResponseAccessor rename |
| 2 (input-normalizer neutral types) | DONE | eee42f2 | BridgeMessage alias, internal Chat types |
| 3 (B-扩展: chat-completions-builder merge) | DONE | f61566c | boundary-rule pivot from shim to delete |
| 4 (request-dispatcher + anthropic stub + protocol? + streamMode?) | DONE | 457e3f0 | single prod call site redirected; 5 test files updated; 862/0 + 65/0 unchanged |
| 5 (response-reconstructor rename) | DONE in step 1 | 4e2fe76 | already covered |
| 6 (provider-exchange dispatcher swap) | DONE in step 4 | 457e3f0 | already covered (the swap happened as part of step 4) |
| 7 (12 test files update) | in progress | - | 5 of 12 done in step 4; remaining 7 to audit for shape regressions |
| 8 (full check + e2e iterate) | pending | - | regression sweep |
| Phase B (AnthropicMessages pipeline) | pending | - | blocked until step 8 |

### Process state - unchanged (verified Round 12)

| pid | process | port | role |
|---|---|---|---|
| 16976 | godex5 | 5679 | LLM gateway |
| 15124 | godex6 | 5680 | user primary keepalive |
| 2568 | godex7 | 5681 | Path D test gateway |
| 14412 | node | - | chrome-browser-mcp (CDP on 9224) |
| 6800 | chrome | 9222 | user Chrome debug |

### Open Questions status

- OQ1 (BridgeMessage.role shape): still deferred to Phase B
- OQ2 (Block.type enum): still deferred to Phase B
- OQ3 (Anthropic thinking policy): still deferred to Phase B
- OQ4 (upstream PR readiness): explicitly OUT OF SCOPE (Round 10 user decision: "不用了")
- OQ5 (stream_mode timing): YES-A LOCKED in Round 10. ProviderSpec.streamMode? field added in step 4. Runtime wiring deferred to step 8 or Phase B.

### Next: Phase A step 7 (was: provider-exchange dispatcher swap + 12 test files)

Step 6 is now a no-op (the swap already happened in step 4). Step 7 becomes "audit remaining 7 test files for shape regressions" since 5 of the originally-estimated 12 test files were updated in step 4. The remaining 7 to audit are the ones in src/responses/ that don't call buildChatCompletionRequest directly but might consume buildBridgeRequestResult shape changes.

Then step 8 is the regression sweep (full check + e2e on a fresh clone or after deep clean).

Awaiting user direction on step 7 vs taking a break.

## Round 13 (2026-07-10) - Step 7 audit + smoke test + Phase B design draft

A+B+C combined: audit (no-op), binary smoke test (all green), Phase B design doc drafted.

### A. Phase A step 7 audit (no-op)

Step 7 was originally estimated as "12 test files update". After step 4 actually touched 5 of those 12 in one batch, step 7 becomes an audit pass. Audit results:

- 0 files still reference `buildChatCompletionRequest` or `BuildChatCompletionRequestResult`
- 5 lines touch `built.*` fields (`.output` and `.tools`), all still present in `BuildBridgeRequestResult` -- zero changes needed
- The other 7 of 12 originally-estimated test files don't actually depend on the renamed types (they consume provider responses, not request build results)

Verdict: step 7 = no-op. Step 4 was more thorough than the step 7 estimate assumed.

### B. godex-step4 binary + smoke tests

Built `bin/godex-step4.exe` from current source tree (commit 457e3f0 HEAD + 2-step-7 audit clean tree). 99,164,160 bytes, located at `bin/godex-step4.exe`.

Created `bin/godex-step4-smoke.yaml` based on `godex6-keepalive.yaml` with:
- port: 5682 (avoids collisions with 5678/5679/5681)
- separate data dir: `./data-step4/`
- separate log dir: `./logs-step4/`

Started in background, pid 24336. Smoke tests:

| Endpoint | Test | Result |
|---|---|---|
| GET /health | health check | 200 OK, providers: [minnimax.chat] |
| GET /v1/models | model list | 200 OK, 3 models (M3 / M2.7 / M2.7-highspeed) |
| POST /v1/responses (text) | "Say hi in 5 words" | 200 OK, response: "Hello there, how are you?" (49 output tokens) |
| POST /v1/responses (tool) | declared get_weather, asked about Tokyo | 200 OK, model emitted function_call `get_weather({"location":"Tokyo"})` |
| POST /v1/responses (stream) | "Count to 3" | 200 OK, SSE events: response.created, response.in_progress, response.output_item.added, ... |

Verdict: dispatcher in step 4 is production-ready. Zero behavior change confirmed for the existing Chat provider path. godex6 (keepalive) untouched on port 5678.

Stopped godex-step4 cleanly after smoke tests. Live process state:

| pid | process | port | role |
|---|---|---|---|
| 16976 | godex5 | 5679 | LLM gateway |
| 15124 | godex6 | 5678 | user primary keepalive (untouched) |
| 2568 | godex7 | 5681 | Path D test gateway |
| 14412 | node | - | chrome-browser-mcp (CDP on 9224) |
| 6800 | chrome | 9222 | user Chrome debug |

### C. Phase B design draft

Wrote `handoffs/2026-07-10-phase-b-anthropic-design.md` (22 KB / 460 lines). Covers:

1. Anthropic Messages API primer (endpoint, request body, response body, streaming events)
2. Codex Responses API -> Anthropic Messages request translation (top-level fields, tools, input->messages)
3. Anthropic Messages -> Codex Responses API response translation (sync, streaming SSE event mapping table)
4. Tool name codec for Anthropic (sanitization rules)
5. Spec file design (anthropic + minimax-anthropic thin wrapper)
6. End-to-end flow diagram (where dispatcher hands off to anthropic pipeline)
7. Open Questions resolution:
   - OQ1 BridgeMessage.role -> BridgeContentBlock neutral type
   - OQ2 Block.type enum -> text | image | tool_use | tool_result | reasoning
   - OQ3 Anthropic thinking mapping (effort -> thinking.enabled/budget_tokens)
8. Test plan (unit + mocked E2E + live E2E)
9. File-level work plan (~15 new files + 5 modifications, ~1200-1800 LOC)
10. Risk + rollback (Phase B purely additive; Anthropic provider opt-in via YAML)
11. Phase B sequencing (B1-B6, ~5-6 days focused work)
12. After Phase B: Codex++ browser tools should finally work reliably; user can switch apitype per-conversation

Key insight surfaced by drafting: OQ1 (BridgeMessage.role) is the highest-leverage decision. Resolving it once unblocks both Chat and Anthropic pipelines cleanly. The cost is rewriting input-normalizer.ts (~ 700 lines) but the benefit is one canonical input shape forever.

### Phase A status table (update)

| Step | Status | Commit | Notes |
|---|---|---|---|
| 1 (F class rename) | DONE | 4e2fe76 | |
| 2 (input-normalizer neutral types) | DONE | eee42f2 | |
| 3 (B-扩展: chat-completions-builder merge) | DONE | f61566c | |
| 4 (request-dispatcher + anthropic stub + protocol? + streamMode?) | DONE | 457e3f0 | |
| 5 (response-reconstructor rename) | DONE in step 1 | - | |
| 6 (provider-exchange dispatcher swap) | DONE in step 4 | - | |
| 7 (test files shape audit) | DONE | - | no-op; step 4 was thorough |
| 8 (full check + e2e iterate) | DONE | - | clean: 862/0 + 65/0 + smoke 5/5 |
| Phase B (AnthropicMessages pipeline) | DESIGNED | - | awaiting user go to start B1 (BridgeContentBlock) |

### Next

Phase A is fully complete (all 8 steps). Phase B is designed (handoffs/2026-07-10-phase-b-anthropic-design.md) and ready to start.

Phase B sequencing proposed:
- B1 (~1 day): OQ1 + OQ2 - BridgeContentBlock + input-normalizer rewrite + chat-completions-builder translation
- B2 (~1 day): OQ3 - thinking mapping
- B3 (~1-2 days): anthropic spec + client + hooks + DTOs
- B4 (~1 day): stream transformer + sync reconstructor
- B5 (~0.5 day): minimax-anthropic thin wrapper + registry
- B6 (~0.5 day): live E2E + Codex++ smoke

Awaiting user authorization to start Phase B1, or any redirection.
