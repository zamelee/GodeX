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
