# GodexStudio

Plugin + UI for Godex — per-model profiles, MiniMax quirk handling, and
eventual visual configuration without touching Godex core.

## Status

**Layer 2** (this branch): Pass-through plugin skeleton. All hooks are no-ops.
Godex continues to work exactly as before.

**Layer 3** (future): Migrate MiniMax-specific hardcoded logic from Godex
into real studio hook implementations.

**Layer 4** (future): Add a web UI for model selection, parameter tuning,
and log inspection.

## Directory Layout

```
studio/
  src/
    plugin.ts      # GodexPlugin default export (pass-through until Layer 3)
    hooks/         # Per-hook implementations (Layer 3)
    profiles/      # Profile loading logic (Layer 3-4)
    server/        # UI web server (Layer 4)
    public/       # Static UI assets (Layer 4)
  dist/
    plugin.js     # Built from src/plugin.ts — this is what godex loads
  profiles.yaml   # Model parameter presets (Layer 4)
```

## Build

```bash
cd studio
bun install
bun run build   # → dist/plugin.js
```

## Using with Godex

In your `godex.yaml`:

```yaml
plugins:
  paths:
    - ./studio/dist/plugin.js
```

Then start godex normally. The plugin loads at startup; if the path
is wrong or the file is missing godex will print an error and refuse to start
(fail-fast — no silent degradation).

## Hook Reference

| Hook | When | What |
|------|------|------|
| `transformChatMessages` | After messages are normalized, before HTTP call | Rewrite message arrays (image split, reorder, orphan drop) |
| `patchRequest` | After provider spec patch, before HTTP call | Rewrite request fields (tool args, etc.) |
| `transformStreamDelta` | Raw SSE chunk from provider, before delta mapper | Rewrite streaming chunks (null filter, reasoning extraction) |

Each hook runs async, errors propagate to the caller, and multiple plugins
chain in registration order.
