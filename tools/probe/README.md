# tools/probe/README.md

GodeX 模型探测工具集。

## 目录结构

```
tools/probe/
  upstream/       直连上游（minnimax.chat）的 Python 探测脚本
  studio-cdp/     通过 CDP 驱动真实 studio.exe 的测试脚本
  fixtures/       ground-truth 测试样本（红底+RED字 PNG、440Hz WAV、mp4 stub）
  generate_fixtures.py  重新生成 fixtures 的 Python 脚本
  Makefile        make 入口
```

## 设计原则

探测程序**只用于在 godex 启动前给 models.enabled 定参数**（context_window、max_tokens、各 cap），
所以**永远直连上游 base_url**（不走 localhost:5678）。走 godex 是循环验证，没意义。

> 未来用 ResponsesAPI 经 godex 复查 godex 自身转发对不对 —— 那是 post-launch 工具，不是 probe。

## 当前模型（minnimax.chat 代理）

3 个已启用模型：`MiniMax-M2.7`, `MiniMax-M2.7-highspeed`, `MiniMax-M3`

`gw-ced…` 这把 key 在真实 minimax.com（api.minimaxi.com）上是 401，所以探测只对 minnimax.chat 有效。

## 入口

### 生成 fixtures
```
make fixtures
# 或
python tools/probe/generate_fixtures.py --out tools/probe/fixtures
```

### 直连上游探测
```
make probe
```

### Rust 端独立测试（不开 Tauri）
```
make cargo-probe
```

## 探测维度

| 维度 | 算法 | 备注 |
|---|---|---|
| context_window | exp (×2 → ×4) → bisect | 从 claimed 向上找最大 |
| max_tokens | exp (×2 → ×4) → bisect | 从 claimed 向上找最大 |
| text | 单次 chat | 200 = true |
| image | ground-truth PNG inline | 200 + reply 含 "red"/"红色" |
| audio | 1s 440Hz WAV inline | 200 + reply 含 "audio"/"sound" |
| video | mp4 stub inline | 200 + reply 含 "video"/"视频" |
| function | get_weather + tool_choice=required | 200 + tool_calls 非空 |
| web_search | tools:[{type:web_search}] | 200 / 400 |
| file_search | tools:[{type:file_search}] | 200 / 400 |
| computer_use | tools:[{type:computer_use,provider:windows}] | 200 / 400 |
| tool_search | tools:[{type:tool_search}] | 200 / 400 |
| mcp | tools:[{type:mcp}] | 200 / 400 |
| reasoning | reasoning_effort=medium | usage.reasoning_tokens > 0 |