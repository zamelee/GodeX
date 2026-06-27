# Handoff: Studio + Model-Probe 功能开发

> 生成时间: 2026-06-27
> 当前分支: main (已同步 origin/main，commit a6c5c9d)
> 备份分支: fork/backup/pre-rebase-state (commit 50f1a9f)

## 一、需求清单（最终确认版）

### 1. godex.yaml 快速打开
- **位置**: Studio 设置 Modal（`src/index.html`）
- **行为**: 点击按钮 → 用系统默认编辑器打开 godex.yaml 文件
- **代码改动**:
  - `commands.rs`: 加 `open_config_in_editor` 命令
  - `src/index.html`: 加 `[📄打开]` 按钮

### 2. GodeX 副本运行模式
- **位置**: Studio 设置 Modal
- **UI 元素**:
  - 勾选框: `☑ GodeX副本运行`
  - 启动按钮: `[启动副本]`（点击才运行，不是勾选即运行）
  - 副本路径显示: `D:\...\GodeX-2026-06-27-temp-copy.exe`
- **逻辑**:
  ```
  用户勾选 → 点启动
      ↓
  检测副本是否存在 + MD5 是否与原文件一致
      ↓
  不存在或不一致 → 复制原 godex.exe 为副本
      ↓
  运行副本（不改 config 里的 godex_binary）
  ```
- **副本命名规则**: `{原文件名}-{日期}-temp-copy.exe`
- **代码改动**:
  - `state.rs`: `PersistedPaths` 新增 `replica_mode: bool`, `replica_binary_path: Option<String>`
  - `godex.rs`: `GodexSupervisor` 新增 `start_replica()`, `replica_pid()`, `kill_replica()`, `check_replica_health()`
  - `commands.rs`: 新增 `set_replica_mode`, `start_godex_replica`, `check_replica_status`
  - `src/index.html`: 设置 Modal 加勾选框和按钮

### 3. 安全余量滑块
- **位置**: Studio 模型编辑行（每个模型的 context_window / max_tokens 旁边）
- **行为**: 滑块 0-100%，默认 95%，应用到 context_window 和 max_tokens
- **计算**: `effective_value = raw_value * (margin / 100)`
- **代码改动**:
  - `src/index.html`: 每个模型行加滑块
  - `config.rs`: `EnabledModel` 新增 `margin: Option<f64>` 字段
  - `commands.rs`: 读取/保存 margin 值
  - `models.ts` (GodeX 路由): 计算 effective context/max_tokens

### 4. model-probe.exe 独立程序
- **位置**: `studio-tauri/model-probe/`（独立 Tauri 项目）
- **启动方式**: Studio 点击"模型能力探测"按钮 → 启动 `model-probe.exe --godex-url http://localhost:5678`
- **窗口 UI**（二维图表形式）:
  - Provider 下拉 + 全选/清空模型
  - 模型勾选列表（平铺，非下拉）
  - 上下文探测勾选 + 余量滑块
  - 内置工具勾选（local_shell, shell, apply_patch, tool_search, computer_use）
  - OpenAI 标准工具勾选（function, web_search, file_search, mcp）
  - web_search 变体勾选
  - 多模态勾选（文本、图片、视频、音频）
  - 推理模式探测勾选 + 参数/值下拉
  - API 格式选择（Chat Completions / Responses API）
  - 二维结果表格（行=模型，列=探测项）
  - 底部按钮：[开始探测] [保存到 godex.yaml] [导出 JSON] [取消]

## 二、探测逻辑详情

### 2.1 上下文探测（context / max_tokens）
- **方法**: 二进制搜索，从 claimed × 0.9 开始
- **max_input**: 二分查找逼近真实上限，约 6 次
- **max_output**: 从 claimed_max × 1.5 开始单次探测，失败则逐步降低
- **安全余量**: 最终值 = 实测值 × margin%
- **输出**: 每个模型返回 `{ model, max_input, max_output, status }`

### 2.2 工具探测

#### 工具类型清单（参考 GodeX/src/tools/ 和 tools/ 脚本）

| 工具类型 | 来源 | 探测方法 |
|---------|------|---------|
| `local_shell` | Codex 内置 | 发 tools=[local_shell schema] + prompt → 200 + tool_call |
| `shell` | Codex 内置 | 发 tools=[shell schema] + prompt → 200 + tool_call |
| `apply_patch` | Codex 内置 | 发 tools=[apply_patch schema] + prompt → 200 + tool_call |
| `tool_search` | Codex 内置 | 两种策略可选：直接发 / 让模型主动调用 |
| `computer_use` | Codex 内置 | 发 tools=[computer_use schema] + prompt → 200 + tool_call |
| `computer` | Codex 内置（alias?） | 同 computer_use |
| `function` | OpenAI 标准 | 发简单 function tool → 200 + tool_call |
| `web_search` | OpenAI 标准 | 发 tools=[web_search] → 200 = 支持 |
| `file_search` | OpenAI 标准 | 发 tools=[file_search] → 200 = 支持 |
| `mcp` | OpenAI 标准 | 发 tools=[mcp] → 200 = 支持 |
| `web_search_2025_08_26` | 变体 | 同 web_search |
| `web_search_preview` | 变体 | 同 web_search |
| `web_search_preview_2025_03_11` | 变体 | 同 web_search |

#### 探测策略
```
Step 1: 综合探测（一个请求含所有选中工具）
        ↓ 全部成功
        全部标记 ✓
        ↓ 部分失败
Step 2: 逐个探测（每个工具单独发请求）
        ↓ 失败
        标记为 ✗
```

#### tool_search 两种探测模式
- 模式 A（主动）: 发 prompt "你有哪些工具可用？请调用 tool_search"（不带 tools）→ 看模型是否返回 tool_search 调用
- 模式 B（被动）: 发 tools=[tool_search] + prompt → 看是否调用

#### computer_use 探测
- 发 prompt "截个图" + tools=[computer_use]
- 期望: 响应中包含 computer_use 调用

### 2.3 多模态探测

| 能力 | 探测方法 |
|------|---------|
| 文本 | 发普通文本请求 → 200 |
| 图片输入 | 发 base64 小 PNG（< 1KB）→ 200 = 支持 |
| 视频输入 | 发视频 URL 或 base64 → 200 = 支持 |
| 音频输入 | 发音频 URL → 200 = 支持 |

### 2.4 推理模式探测

**策略**: 遍历所有可能的推理参数组合，以探测为准

```typescript
const REASONING_PARAMS = [
  // OpenAI style
  { reasoning_effort: "low" },
  { reasoning_effort: "medium" },
  { reasoning_effort: "high" },
  { thinking: { type: "enabled" } },
  { thinking: { type: "enabled", budget_tokens: 8192 } },
  
  // Anthropic style  
  { thinking: { type: "enabled" } },
  { thinking: { type: "enabled", budget_tokens: 16384 } },
  
  // Gemini style
  { thinking_mode: 1 },
  { thought: true },
  
  // Generic fallbacks
  { enable_thinking: true },
  { reasoning: true },
  { reflection: true },
];

// 探测：
// 1. 逐个发请求测试，看哪个返回 200 且响应含 reasoning/thinking/reflection/thought 关键词
// 2. 第一个成功的记录为该模型支持的推理参数
// 3. 无一成功 → 标记为不支持
```

### 2.5 API 格式选择
- 支持两种 API 格式探测: Chat Completions（默认）和 Responses API
- 用户可二选一

**Chat Completions**:
```json
{
  "model": "MiniMax-M3",
  "messages": [{"role": "user", "content": "..."}],
  "tools": [...],
  "max_tokens": 512
}
```

**Responses API**:
```json
{
  "model": "MiniMax-M3",
  "input": [{"role": "user", "content": [{"type": "input_text", "text": "..."}]}],
  "tools": [...],
  "max_output_tokens": 512
}
```

## 三、代码改动清单

### 3.1 Studio-tauri 改动

#### `src-tauri/src/state.rs`
- `PersistedPaths` 新增 `replica_mode: bool` 字段
- `PersistedPaths` 新增 `replica_binary_path: Option<String>` 字段
- `read_persisted_paths()` / `save_persisted_paths()` 支持新字段

#### `src-tauri/src/godex.rs`
- `GodexSupervisor` 新增方法:
  - `start_replica(config_path, replica_path)` → 启动副本
  - `replica_pid()` → 返回副本 PID
  - `kill_replica()` → 杀死副本
  - `check_replica_health()` → 检查副本是否存活
- `replica_mode` 状态标志

#### `src-tauri/src/commands.rs`
- `set_replica_mode(enabled: bool)` → 保存勾选状态
- `start_godex_replica()` → 启动副本
- `kill_godex_replica()` → 停止副本
- `check_replica_status()` → 返回副本状态
- `open_config_in_editor()` → 用系统编辑器打开 godex.yaml
- `probe_models(probe_request)` → 启动 model-probe.exe 并传递参数
- 已有命令增强: `read_codex_model_context` / `write_codex_model_context`

#### `src-tauri/src/config.rs`
- `EnabledModel` 新增 `margin: Option<f64>` 字段（0.0-1.0）
- `render_enabled_block()` 渲染 margin 字段
- `replace_or_insert()` 支持 margin 字段

### 3.2 Studio 前端改动（`src/index.html`）

#### 设置 Modal
- godex.yaml 路径字段旁加 `[📄打开]` 按钮
- 新增勾选框: ☑ GodeX副本运行
- 新增启动按钮: [启动副本]
- 显示副本路径

#### 模型列表
- 每个模型行加安全余量滑块（显示在 context_window / max_tokens 旁边）
- 滑块默认 95%，可拖动

#### 探测入口
- 模型列表顶部或设置 Modal 加 `[🔬模型能力探测]` 按钮
- 点击启动 model-probe.exe

### 3.3 新建 model-probe Tauri 项目

#### 目录结构
```
studio-tauri/model-probe/
├── src/
│   ├── main.rs           # Tauri 入口
│   ├── lib.rs            # 共享库
│   ├── ui.rs             # 窗口 UI（HTML/CSS 内联或生成）
│   ├── probe/
│   │   ├── mod.rs
│   │   ├── context.rs    # 上下文探测（二分搜索）
│   │   ├── tools.rs      # 工具探测（综合+逐个）
│   │   ├── multimodal.rs # 多模态探测
│   │   ├── reasoning.rs  # 推理模式探测
│   │   └── api.rs        # API 调用封装
│   └── godex.rs          # GodeX 交互（读取配置、写入结果）
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json   # 窗口配置：900×750，标准窗口
│   └── capabilities/
├── model-probe.exe       # 编译输出
└── README.md
```

#### tauri.conf.json 配置
- 窗口标题: `模型能力探测`
- 窗口大小: 900×750
- 始终置顶: 否
- 可最小化/最大化: 是

#### model-probe.exe 与 Studio 的通信
- Studio 调用: `model-probe.exe --godex-url http://localhost:5678 --config D:\...\godex.yaml`
- model-probe 完成后:
  - 直接写入 godex.yaml（通过文件操作）
  - 导出 JSON 报告
  - Studio 读取结果刷新模型列表

### 3.4 GodeX 路由改动

#### `src/server/routes/models.ts`
- 计算 effective context/max_tokens 时应用 margin
- `full_context_window_limit = (context_window ?? 0) * margin`
- `auto_compact_token_limit = (context_window ?? 0) * margin - max_tokens * margin`

## 四、关键文件参考

| 文件 | 用途 |
|------|------|
| `studio-tauri/src-tauri/src/config.rs` | 模型配置读写，参考格式 |
| `studio-tauri/src-tauri/src/state.rs` | 状态管理，参考 persist 模式 |
| `studio-tauri/src-tauri/src/commands.rs` | Tauri 命令，参考命令模式 |
| `studio-tauri/src-tauri/src/godex.rs` | GodeX 进程管理，参考 supervisor 模式 |
| `studio-tauri/src/index.html` | Studio 前端 UI，参考 modal 格式 |
| `tools/probe-minimax-context.ts` | 上下文探测参考（二分搜索） |
| `tools/tool_support_tester.py` | 工具探测参考（payload 格式） |
| `src/bridge/tools/declaration-renderer.ts` | 工具类型定义参考 |
| `src/bridge/tools/tool-plan.ts` | 工具 planning 参考 |
| `src/tools/builtin.ts` | 内置工具定义 |

## 五、实现顺序建议

1. **godex.yaml 打开按钮**（最简单，先做）
2. **安全余量滑块**（改动分散但简单）
3. **GodeX 副本运行模式**（Rust 端 + 前端）
4. **model-probe.exe 独立程序**（最复杂，最后做）

## 六、注意事项

1. **不要改 godex.yaml 里的 godex_binary 路径**——副本模式运行时副本路径是临时的，不写入 config
2. **model-probe 依赖 GodeX 在 5678 端口运行**——启动时检测，如未运行则弹窗询问
3. **安全余量默认 95%**——避免贴着真实上限运行
4. **工具探测用 Chat Completions 格式（默认）**——与 Codex 实际使用的 Responses API 分开测
5. **探测结果保存后，Studio 模型列表刷新**——调用 `loadRustPresets()` 或 `fetch_remote_models()`

## 七、MiniMax 实测值（来自 probe-minimax-context.ts）

| 模型 | 声称 Context | 实测 Context | 声称 MaxOut | 实测 MaxOut |
|------|------------|-------------|------------|------------|
| MiniMax-M3 | 1,000,000 | 1,300,000 | 131,072 | 196,608 |
| MiniMax-M2.7 | 204,800 | 266,240 | 131,072 | 196,608 |
| MiniMax-M2.7-highspeed | 204,800 | 266,240 | 131,072 | 196,608 |

（已更新到 godex.yaml，当前 working directory 状态）
