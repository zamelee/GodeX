# GodeX Studio — Layer 4 UI

Configuration UI for GodeX — edit provider, API key, model params, save profiles, monitor logs.

## Quick Start

### One-click launch (Edge App Mode)

Double-click `start.vbs` on your desktop. It will:
1. Start the bun backend (if not already running) on port 56791
2. Open Microsoft Edge in **App Mode** (no browser chrome — looks like a native app)
3. The Studio window stays open until you close it

If you don't have a desktop shortcut, see "Create Desktop Shortcut" below.

### Manual launch

```bash
bun run serve                                          # default: studio :56791, godex :5678
GODEX_BASE=http://127.0.0.1:5679 bun run serve          # use godex on port 5679
STUDIO_PORT=56792 bun run serve                         # use studio on port 56792
```

Then open <http://127.0.0.1:56791/> in any browser.

## UI Layout (4-column)

| Column | Purpose |
|--------|---------|
| **Left** (200px) | Provider selector — click to switch MiniMax / DeepSeek / OpenAI / GLM |
| **Center** | Settings forms — Connection (URL, Key, Timeout) / Model Params (Context, Max Output, Temp, TopP, TopK) / Advanced (Thinking, Reasoning Effort, Seed, Stream) / Alias (default alias → model) |
| **Right** (240px) | Model list pulled from godex `/v1/models` — click to auto-fill Context / Max Output from presets |
| **Bottom** (180px) | Live logs from trace.db (polls every 5s) |

### Action bar (bottom-center)
- **💾 保存配置** — saves current form values to localStorage
- **📋 生成 config.yaml** — generates YAML config and copies to clipboard
- **🔄 重置** — resets form to provider defaults

### Known model presets (auto-fills on click)
- `minimax/MiniMax-M3` — context 192k, max output 16k, thinking adaptive
- `minimax/MiniMax-M2.7` — context 192k, max output 16k, thinking adaptive
- `minimax/MiniMax-M2` — context 100k, max output 8k, thinking adaptive
- `deepseek/deepseek-chat` — context 64k, max output 8k
- `openai/gpt-4o` — context 128k, max output 16k
- `zhipu/glm-4` — context 128k, max output 8k

Add more by editing `PRESETS` in `src/serve.ts`.

## Environment Variables

| Var | Default | Description |
|-----|---------|-------------|
| `GODEX_BASE` | http://127.0.0.1:5678 | godex backend URL |
| `STUDIO_PORT` | 56791 | studio server port |
| `GODEX_DATA` | (auto-detected) | path to godex data dir containing trace.db |
| `STUDIO_PROFILES` | `../profiles.json` | path to profiles.json file |

## Create Desktop Shortcut

```powershell
$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut("$([Environment]::GetFolderPath('Desktop'))\GodeX Studio.lnk")
$shortcut.TargetPath = "D:\Documents\VibeCoding\GodeX\studio\start.vbs"
$shortcut.WorkingDirectory = "D:\Documents\VibeCoding\GodeX\studio"
$shortcut.IconLocation = "C:\Program Files (x86)\Microsoft\EdgeCore\149.0.4022.69\msedge.exe,0"
$shortcut.WindowStyle = 7
$shortcut.Description = "GodeX Studio - Configuration UI"
$shortcut.Save()
```

## Files

```
studio/
  src/
    serve.ts            — main entry, Bun.serve, embedded HTML
    hooks/              — plugin hooks (Layer 3, currently pass-through)
    profiles/           — profile storage (future)
    public/             — old static HTML (kept as reference)
    server/             — old server/index.ts (kept as reference)
  start.ps1             — PowerShell launcher (starts bun + opens Edge)
  start.vbs             — VBS wrapper to hide PowerShell window
  profiles.yaml         — placeholder (runtime uses profiles.json)
  package.json          — bun scripts
  README.md             — this file
```
