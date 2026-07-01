# Handoff: 模型探测功能集成到 studio.exe

## 状态
- ✅ Rust command `probe_model` 已添加（直接 HTTP 调用，不通过 GodeX）
- ✅ Modal UI 框架已添加（需完善）
- ✅ 支持 context window 二分搜索（减少 API 调用）
- ✅ 支持能力探测：text, image, function, reasoning

## 从 Codex API 获取的模型能力

### MiniMax-M2.7 / M2.7-highspeed
```json
{
  "input_modalities": ["text", "image"],
  "supported_reasoning_levels": ["low", "medium", "high"],
  "supports_parallel_tool_calls": true
}
```

### MiniMax-M3
```json
{
  "input_modalities": ["text", "image", "video"],
  "supported_reasoning_levels": ["low", "medium", "high"],
  "supports_parallel_tool_calls": true
}
```

## 探测能力对照表

### 已确认的能力（通过 Codex API）

| 能力名 | 中文说明 | M2.7/M2.7-hs | M3 |
|--------|----------|---------------|-----|
| `text` | 文本输入 | ✓ | ✓ |
| `image` | 图片输入 | ✓ | ✓ |
| `video` | 视频输入 | ✗ | ✓ |
| `reasoning` | 思考模式 | ✓ (low/medium/high) | ✓ (low/medium/high) |
| `parallel_tool_calls` | 并行工具调用 | ✓ | ✓ |

### 待探测的能力

| 能力名 | 中文说明 | 探测方式 |
|--------|----------|----------|
| `audio` | 音频输入 | 发 input_audio 请求 |
| `function` | 函数调用 | 发 tools 请求，检查 tool_calls |
| `computer_use` | 计算机操作 | 发 computer_use 工具请求 |
| `tool_search` | 工具搜索 | 发 tool_search 工具请求 |

## 实现的功能

### Rust probe_model 命令
- 直接 HTTP 调用 provider API（不通过 GodeX）
- context window 二分搜索（claimed -> 2x -> 4x -> FAIL，然后 binary search）
- max_tokens 关键值测试（16384, 32768, 65536, 131072, 196608, 262144）
- 能力探测：text, image, function, reasoning, batch tools

### 前端 Modal
- Provider 选择下拉框
- 模型复选框列表
- 进度显示
- 实时日志
- 结果表格（Model, Context, MaxOut, Text, Image, Func, Reason）

## 待完善

1. 结果保存到 yaml（probe_raw, probed_at 注释）
2. 探测进度条美化
3. 错误重试逻辑
4. 探测内容勾选（用户选择探测哪些能力）
5. 批量 vs 逐个探测选择
6. 保存策略选择

## 相关文件

| 文件 | 作用 |
|------|------|
| `studio-tauri/src-tauri/src/commands.rs` | probe_model 命令实现 |
| `studio-tauri/src-tauri/src/lib.rs` | 命令注册 |
| `studio-tauri/src/index.html` | Modal UI |
| `studio-tauri/src-tauri/Cargo.toml` | reqwest 依赖 |


## 2026-07-01 探测发现

fixture 用 PIL/wave/ffmpeg stub 生成的 ground-truth 内容（红底+RED字 PNG、440Hz WAV、mp4 stub）
直接打 minnimax.chat，**比之前 probe-minnimax.py 的结论更准**：

| 维度 | M2.7 | M2.7-hs | M3 | 说明 |
|---|---|---|---|---|
| text | ✅ | ✅ | ✅ | |
| image | ❌ fake-200 | ❌ fake-200 | ✅ | M2.7/M2.7-hs 不真支持视觉 |
| audio | ❌ 400 | ❌ 400 | ✅ | M2.7/M2.7-hs 真不支持音频 |
| video | ⚠️ 200 fake | ⚠️ 200 fake | ❌ 400 | M2.7/M2.7-hs 假装支持，M3 拒绝（ffprobe 失败）|
| function | ✅ | ✅ | ✅ | 真实 tool_calls |
| reasoning | ❌ tokens=0 | ✅ | ✅ | M2.7 思考没开 |
| web_search | ✅ | ✅ | ✅ | 200 |
| file_search/computer_use/tool_search/mcp | ❌ 400 | ❌ 400 | ❌ 400 | 全部拒绝 |

**之前结论错的原因**：旧 probe 用 `audio_url` (非标准 shape)，所以 M2.7/M2.7-hs 200 + "I don't see audio" 看起来像 proxy 假阳性。
真相：用 `input_audio` (正确 shape) 后，**M2.7/M2.7-hs 直接 400 "invalid params, audio msg length"**，
**M3 才真支持**。Proxy 没剥内容，是模型本身差异。

## yaml 写入计划（待用户批准）

```yaml
MiniMax-M2.7:
  image: false      # 假 200，模型看不到
  audio: false      # 400 真拒
  video: false      # 假 200
  reasoning: false  # 0 token，没真开
  function: true
  web_search: true
MiniMax-M2.7-highspeed:
  image: false
  audio: false
  video: false
  reasoning: true
  function: true
  web_search: true
MiniMax-M3:
  image: true       # 真看见红
  audio: true       # 真听见
  video: false      # ffprobe 拒绝
  reasoning: true
  function: true
  web_search: true
```
