# GodeX Studio (Tauri 2)

原生 Windows 桌面应用,提供 GodeX 的可视化配置界面(服务商列表、模型启用、实时日志、重启)。

替代之前的 `studio/` (Bun HTTP + 浏览器) 方案 —— 现在是一个 **exe 启动后弹一个原生窗口**,没有命令行,没有浏览器,没有 HTTP 端口。

## 与 Bun 版本的差异

| | 旧 `studio.exe` (Bun + WebView2 手动) | 新 `godex-studio.exe` (Tauri 2) |
|---|---|---|
| 入口 | bun runtime + 裸 WebView2 loader | Tauri 2 Rust 运行时 |
| 后端 | TypeScript (Bun.serve) | Rust (Tauri commands) |
| 前端 | 同一份 HTML | 同一份 HTML,但用 `invoke()` 替代 `fetch()` |
| 窗口 | 自己用 WebView2 loader 创 | Tauri 帮你创 |
| 日志 | Bun 子进程 stdout 推 SSE | Rust 线程读 stdout 推 Tauri event |
| 体积 | 98MB (含 bun runtime) | 10-15MB (Tauri 编译优化后) |
| 启动 | ~500ms | ~200ms |

## 前置 (一次性)

1. **Rust 工具链**: 从 https://rustup.rs/ 装 (`rustup-init.exe`),默认安装 stable-x86_64-pc-windows-msvc 即可
2. **MSVC C++ Build Tools**: Visual Studio Installer 装 "Desktop development with C++" (需要 `cl.exe` 和 `link.exe`)
3. **WebView2 Runtime**: Win11 自带,Win10 21H2+ 也自带,更早要装 (https://developer.microsoft.com/microsoft-edge/webview2/)
4. **Tauri CLI**: `cargo install tauri-cli --version "^2.0"` (装好后有 `cargo tauri` 子命令)

## 构建

```cmd
cd D:\Documents\VibeCoding\GodeX\studio-tauri
cargo tauri build
```

首次 build 5-15 分钟,产出:
- `src-tauri\target\release\godex-studio.exe` (10-15MB)
- `src-tauri\target\release\bundle\nsis\GodeX Studio_0.1.0_x64-setup.exe` (NSIS 安装包)

## 开发模式 (热重载)

```cmd
cd D:\Documents\VibeCoding\GodeX\studio-tauri
cargo tauri dev
```

改 Rust 代码自动重启 exe,改 `src/index.html` 刷新即可。

## 启动

```cmd
D:\Documents\VibeCoding\GodeX\studio-tauri\src-tauri\target\release\godex-studio.exe
```

默认读 `C:\Users\Bliss\.godex\config.yaml` + `D:\...\bin\godex2.exe`,可通过环境变量覆盖:

```cmd
set GODEX_CONFIG=D:\Documents\VibeCoding\GodeX\platforms\win32-x64\bin\jisu-api-config.yaml
set GODEX_BINARY=D:\Documents\VibeCoding\GodeX\platforms\win32-x64\bin\godex2.exe
godex-studio.exe
```

(注: 中文路径在 PowerShell `Start-Process` 下会被 mojibake,直接 cmd 启动就没事)

## 架构

```
godex-studio.exe (Tauri 2)
├── Rust 主进程
│   ├── commands.rs   Tauri commands 暴露给前端
│   ├── godex.rs      进程管理 + stdout 读取 + ring buffer + 事件推送
│   ├── config.rs     providers / enabled[] 读写 (手写 YAML parser,避免 serde_yaml 坑)
│   ├── state.rs      共享状态 (路径、godex supervisor)
│   └── strip_ansi.rs ANSI 转义码剥离 (godex 日志里全是颜色码)
└── WebView2 (Tauri 自带)
    └── index.html    中文界面,JS 调 invoke() 拿数据,listen() 收事件
```

## 测试

```cmd
cargo test --manifest-path src-tauri/Cargo.toml
```

(目前只有 `strip_ansi` 的单元测试,后续加 commands / config 的 round-trip 测试)
