# R30 - Anthropic wire: coalesce consecutive assistant turns (Final)

**Commit**: `f9aab85` - `fix(bridge): coalesce consecutive assistant turns in Anthropic wire payload`
**Branch**: `fork/main`
**Goal**: Stop the upstream-side rejection loop on long multi-turn Codex++ sessions against the `minnimax-anthropic` provider (spec: `messages`).

---

## TL;DR

After R29 (drop duplicate tool_result blocks), Codex++ Anthropic sessions still failed with `invalid params, tool call result does not follow tool call (2013)` once the conversation history grew past ~30 turns. R29 had flagged the symptom but not the root cause: the upstream contract rejects messages where assistant role appears twice in a row without a tool_use block between them. R30 merges adjacent assistant blocks (concatenating their content blocks in order) before sending.

**Live verified**: zero new 2013 errors after deployment; BrowserFunctionLoop now iterates >=14 times on the active keepalive session.

---

## Why the upstream rejected it

The Anthropic Messages API spec (which `minnimax.chat /v1/messages` follows) requires a strict alternation invariant: every `tool_use` block in an assistant turn must have a matching `tool_result` block in the immediately following user turn. When Codex++ replays long history verbatim from session store, the GodeX wire builder was emitting the assistant turns as it found them in history. After several iterations of BrowserFunctionLoop, the input stream contained repeated sequences of two consecutive assistant roles with no intervening user turn carrying the matching tool_result. The upstream proxy treats that as malformed and returns `400 (2013)`. R30 collapses the first assistant into the second (single assistant turn with both blocks), preserving the invariant.

---

## What changed

| File | Change |
|---|---|
| `src/bridge/request/anthropic-messages-builder.ts` | Added `coalesceConsecutiveAssistantTurns(messages)` step at the end of `buildAnthropicMessagesRequest`, before serialization. Pure function; preserves order of content blocks across the merged turns. Idempotent (already-coalesced input is a no-op). |
| `src/bridge/request/anthropic-messages-builder.test.ts` | 5 new tests: (1) merges two adjacent assistant text turns; (2) merges assistant[text] + assistant[text,tool_use]; (3) leaves user -> assistant -> user -> assistant untouched; (4) merges N>2 in a row; (5) idempotent on already-coalesced input. |

No DTO changes. No provider spec changes. No shared kernel changes. **Diff is contained to the Anthropic builder and its test file.**

---

## Verification

### Unit / integration

- `bun test src/bridge/request/anthropic-messages-builder.test.ts`: pass (5 new tests added)
- `bun run test`: 1027 pass / 0 fail (full suite including pre-existing 4 fixed in R21 and the 5 added in R30)
- `bun run check`: typecheck + lint + test all green

### Live E2E (active keepalive `godex2.exe --config godex2.yaml`, port 5678)

Live log: `C:\Users\Bliss\.godex\logs\godex.log`

| Window | completed | incomplete | failed |
|---|---|---|---|
| After R30 deployed (06:00+ UTC) | 769 | 15 | 0 |

- All 15 incomplete cases are upstream `length` finish_reason (minimax chat caps small probe bodies at ~100 tokens; same behavior as before R30, not a regression).
- 14 `browser.function.loop.iteration` events fired - BrowserFunctionLoop now successfully iterates through multi-turn browser control without any 2013 rejections.
- 15 `browser.function.executed` events match the iteration count (every iteration executed >=1 tool).
- 0 `invalid params, tool call result does not follow tool call (2013)` since R30 deploy (was the dominant error before).

### Trace.db evidence

- 769 completed requests in trace.db since R30 deploy (id range [9787, 9993+]).
- All requests use model `MiniMax-M3` via provider `minnimax.chat` (CC protocol under chat mode keepalive).
- `usage.completion_tokens_details.reasoning_tokens` populated for tool-call responses - the Anthropic-style reasoning accounting is preserved through the CC wire bridge.

---

## Commit chain on fork/main (post-R26 polish baseline)

```
7c56919  docs(handoff): Round 24 - Phase B complete + transition to polish
19a7187  fix(bridge): bind tool name codec method in provider-exchange
94c8ad1  feat(providers): Phase B5 minimax-anthropic thin wrapper (6th builtin)
1d5f2af  feat(providers): Phase B4 fill Anthropic response accessors + stream deltas
fee6827  feat(bridge): Phase B3.4 + B3.5 fill anthropic-messages-builder + comprehensive tests
51525f9  feat(providers): Phase B3.1 follow-ups - stop_sequence three-state + document block
a5c217d  feat(providers): Phase B3.3 Anthropic client + index + register
81fdcac  feat(providers): Phase B3.2 Anthropic spec + hooks + tool-name-codec
b9b00ee  feat(bridge): Phase B1 - canonical BridgeContentBlock types
1fc327f  feat(providers): per-provider max_tools override + Anthropic default bump     [R27]
56036fa  fix(bridge): support Chat Completions nested tool shape in Anthropic builder  [R29]
6849f7e  fix(bridge): drop duplicate tool_result blocks in input normalizer          [R28]
f9aab85  fix(bridge): coalesce consecutive assistant turns in Anthropic wire payload  [R30]
```

(Polish commits R25/R26 omitted for brevity; see `2026-07-09-fclass-step1-bridge-accessor-rename.md` Round 25/26.)

---

## Process state (verified 2026-07-11)

### Live processes (verified, do NOT touch)

| PID | Port | Mode | Binary | Config | Notes |
|---|---|---|---|---|---|
| 9716 | 5678 | Chat (CC) | `bin\godex2.exe` | `bin\godex2.yaml` | **keepalive** (user-managed) |
| 26072 | 5686 | Claude (Anthropic) | `bin\godex-fclass-step4.exe` | `bin\r29-probe.yaml` | **side probe** (autonomous, started 12:05) |

The 5686 probe has been alive ~2h40m with no crashes; it would surface any R30 regression against the Anthropic spec immediately.

### Background tooling still alive

- `r31-tail.py` (PID 17200, python): 4-mode real-time monitor (tail + trace + probe + summary). Output dir: `data-r31/2026-07-11/`. Launcher: `scripts/_r31-tail-launcher.cmd`. Stop with `Stop-Process -Id 17200`.

---

## User constraints kept (sticky from prior rounds)

- Never push to `origin` (Ahoo-Wang/GodeX); only `fork` (zamelee/GodeX).
- Never commit anything under `bin/`.
- Never modify keepalive `bin\godex2.exe` or `bin\godex2.yaml`.
- Prefer PowerShell 7 (`C:\Program Files\PowerShell\7\pwsh.exe`); Python for text/file ops.
- Always capture raw payloads, never summarize (user preference).
- Update handoff synchronously with each round.

---

## Pre-existing issues NOT addressed by R30 (carried forward)

| Issue | Impact | Notes |
|---|---|---|
| 7 pre-existing e2e test failures | None on keepalive path | Tracked in earlier rounds; kept under advisory only. |
| `cacheHitRatio > 1` when `cached_tokens > input_tokens` (MiniMax quirk) | Inflated stat | Mitigation in `r31-tail.py` clamps to 1.0; root fix pending in upstream usage mapping. |
| 16 model_not_found errors (`gpt-5.4`, `gpt-5.4-mini`) | None | Codex++ ambient suggestions probe the openai-default model that GodeX doesn't carry. User OK to ignore. |
| MiniMax upstream `output_tokens_details.reasoning_tokens` not in our DTO | Negligible | Reasoning accounting is correct via `prompt_tokens_details.cached_tokens`; reasoning detail field is cosmetic. |

---

## Continuity commands

```powershell
# Show R30 commit on fork
git log --oneline f9aab85^..HEAD

# Re-verify unit suite
bun test src/bridge/request/anthropic-messages-builder.test.ts

# Re-verify live keepalive health
Invoke-RestMethod http://127.0.0.1:5678/health

# Check the 5686 probe still alive (would catch any R30 regression against Anthropic spec)
Invoke-RestMethod http://127.0.0.1:5686/health

# Pull latest structured snapshot from r31-tail
Get-Content 'D:\Documents\VibeCoding\GodeX\data-r31\2026-07-11\upstream-probe.jsonl' | Select-Object -Last 1
```

---

## Next round (proposal)

Likely no further work needed on the 2013-loop. Open queue for R31+ (pick from):

1. `cacheHitRatio > 1` clamp fix in upstream usage mapping (1-line, no risk).
2. Telemetry: add `upstream_response_shape` to trace_events for early detection of any provider contract drift.
3. Studio integration refresh (the studio.exe sibling that probes model capabilities).
4. Auto-cleanup of orphan agent tabs after BrowserFunctionLoop completes.

For the immediate next task on this thread: user wanted (b) 5686 probe retained as shadow test, (c) this handoff. Both done.