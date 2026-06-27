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


---

## 二、本轮讨论确认结论（2026-06-27 14:00-15:00，第二轮）

### A. ⚠️ 关键 BUG：margin 字段在 godex 端被静默丢弃

**症状**：用户在 Studio 把 margin 改成 80%，godex 端 /v1/models 仍按 0.95 算 effective 值。

**根因链**：
1. ✅ Studio src/index.html:1073 stripUndef 正确写出 out.margin
2. ✅ Studio src-tauri/src/config.rs save_enabled_models 正确写 yaml（margin: 0.80）
3. ❌ godex 端 src/config/schema.ts:33 EnabledModel 接口**没有** margin 字段
4. ❌ godex 端 src/config/sections/models.ts parseEnabledModels **没有读** obj.margin
5. ❌ godex 端 src/server/routes/models.ts:54 用 s any 强行读 .margin，运行时永远 undefined，永远 fallback 0.95

**修复**（3 个文件）：
- src/config/schema.ts — EnabledModel 加 margin?: number
- src/config/sections/models.ts — parseEnabledModels 加 const margin = numberOrUndefined(obj.margin); if (margin !== undefined) entry.margin = margin;
- src/server/routes/models.ts — 删 s any、清理类型断言
- studio-tauri/model-probe/src-tauri/src/lib.rs:140 — let margin = 0.95f64; 改为读 yaml 里的 margin，没有再 0.95

**风险**：低；需重启 godex 验证 effective 值变化。

### B. model-probe 的 --config=<path> 参数没生效

**根因**：model-probe/src-tauri/src/lib.rs:240 的 setup() 硬编码扫 USERPROFILE/.godex/config.yaml 和 cwd/godex.yaml，**没有读** std::env::args()，所以 studio 传的 --config= 被无视。

**修复**：
1. main.rs 在调 un() 前 parse_args() 拿到 --config=<path>，存 OnceLock<PathBuf>
2. un() 把 OnceLock 里的路径作为 config_path 初值塞进 AppState
3. setup() 降级为兜底（仅在显式路径不存在时扫 USERPROFILE/cwd）
4. 前端 UI 的"Config 路径"输入框继续保留，作运行时修改入口

### C. 探测窗口职责分离（去掉余量控件）

**决定**：探测窗口内**完全删除**余量滑块。原因：
- 探测语义 = 测出"模型真实上限"（原始字节数）
- 余量是消费侧（godex.yaml → /v1/responses）的事
- raw 值已经通过 yaml 注释行（见 D）持久化
- 余量调整在 Studio 主界面单点控制

**改动**：model-probe/src/index.html 删掉"余量" slider 行和 label。

### D. raw 探测值的持久化方式（"或"——只做 yaml 注释行）

**方案**：model-probe 写 yaml 时在 context_window 行**紧跟其后**插入三行注释：
`yaml
- provider: minimax
  model: MiniMax-M3
  context_window: 1235000
  # probe_raw: 1300000
  # probed_at: 2026-06-27T14:00:00Z
  # probe_method: chat_completions
  margin: 0.95
`

**优势**：
- js-yaml 默认丢弃注释，godex 完全无感知
- Studio 扫 # probe_raw: 行就能 UI 展示"raw 1.3M / 探测于 14:00"
- git diff 友好，raw 值跨提交历史可追溯
- 与 	ools/logs/probe-*.jsonl 是"或"关系（已有历史日志，不动）

**兼容矩阵**（yaml 各种状态）：

| yaml 状态 | godex | Studio | model-probe |
|----------|-------|--------|-------------|
| 裸 yaml（裸 provider/model） | ✅ | ✅ | ✅ |
| + context_window | ✅ | ✅ | ✅ |
| + margin | ✅（修后） | ✅ | ✅ |
| + # probe_raw 注释 | ✅（js-yaml 忽略） | ✅ 显示 raw | ✅ |
| 删了 # probe_raw | ✅ | ⚠️ 显示"未探测" | ✅ |

### E. 已启用模型行的字段决策

**保留**：上下文、输出上限、余量、capabilities、reasoning
**不要**：temperature、top_p、tool_choice、pricing（这些会让 Studio 与 Codex 默认值冲突，适得其反；计费/预估也不做）

**关于 reasoning**：上一轮讨论中提到，本轮确认加入；具体三态为 
one / nabled / max，UI 用下拉切换。

### F. 上下中布局 sasha 修复（保留调试边框）

**根因**：#fs-provider { flex: 0 0 auto } 高度由内容决定，无法被 inline style 强压。
**修复**（保留调试边框/背景）：
`css
#fs-provider{ flex:0 0 auto; min-height:0; overflow:hidden; border:1px solid red; background:rgba(255,0,0,.05) }
#fs-models{ flex:1 1 0; min-height:0; margin-bottom:0; border:1px solid lime; background:rgba(0,255,0,.05) }
`
**Sash 配置**：minBefore: 100, minAfter: 100, mode: "pct"（保留响应式缩放）

**调试边框/背景**：保留不动（开发期排错依赖）。

### G. 输入卡顿 + 渲染优化

**根因**：oninput 触发 setModelParam → enderModels() 整表 innerHTML 重写，输入框被销毁重建。

**优化方案**：
1. setModelParam 用 equestAnimationFrame 节流（200ms），仅 idle 时再重渲
2. model-row 加 contain: layout style; 告诉浏览器离屏渲染
3. model-list 加 contain: strict
4. 排版微调：行高 32px → 26px；不换行模型名 + ellipsis

### H. ABE 校验（输入防呆）

**A. 上下文必须 ≥ 1**：HTML5 min=1（已加）
**B. 上下文 ≥ 输出上限**：Studio 保存前 JS 校验
`js
function validateModel(m) {
  if (m.context_window != null && m.context_window < 1) return "上下文必须 ≥ 1";
  if (m.max_tokens != null && m.context_window != null && m.max_tokens > m.context_window) {
    return "输出上限不能超过上下文";
  }
  return null;
}
`
**E. 探测时间超过 30 天加黄标**：Studio UI 显示"探测时间"，过期提醒重测

**D（godex 启动失败时给清晰错误）不做**：Studio 的 ead_enabled_models 命令读 yaml 失败时直接报错即可。

---

## 三、实施顺序（确认后动手）

| # | 改动 | 文件数 | 风险 | 预计时间 | 状态 |
|---|------|--------|------|----------|------|
| 1 | 修 margin bug（A） | 4 | 低 | 30 min | ✅ ba929c9 |
| 2 | fs-provider 修复（F） | 1（仅 CSS） | 极低 | 5 min | ✅ 55d63a6 |
| 3 | model-probe CLI 参数（B） | 2 | 低 | 30 min | ✅ feab3f1 |
| 4 | setModelParam 节流 + CSS contain（G） | 1（仅 index.html） | 低 | 20 min | ✅ 2f60751 |
| 5 | 探测窗口去余量（C） | 1（model-probe/src/index.html） | 极低 | 5 min | ✅ 519c3aa |
| 6 | yaml 注释行（D） | 1（model-probe/lib.rs） | 低 | 20 min | ✅ c09b1a9 |
| 7 | ABE 校验 + reasoning（H+E） | 1（studio/src/index.html） | 低 | 30 min | ⏳ 进行中 |

**总预计**：~2.5h；#1-#6 已完成并推送到 fork。


---

## 四、gpt-5.4 model_not_found 调查（2026-06-27 15:30）

### 现象
~/.godex/logs/godex.log 中持续出现 Model not found: gpt-5.4 错误（status 400），累计 371 条（2026-06-26 12:20 ~ 2026-06-27 09:24），间隔从 1ms 到几十秒不等。

### 调查方法
1. godex 端：godex.log 中错误前后的 equest.received / provider.request.sending / stream.completed 记录
2. Codex 端：~/.codex/sessions/2026/06/{26,27}/*.jsonl 中 session_meta / 	urn_context 字段
3. Codex 端：~/.codex/config.toml 内容
4. godex 端：model-presets.json 中 gpt-5.4 的预设归属

### 关键证据

**a) Codex ~/.codex/config.toml 当前内容**：
`	oml
model_provider = "custom"
[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = true
base_url = "http://127.0.0.1:5678/v1"
`
**没有 model 字段**。之前 config - 副本.toml 有 model = "MiniMax-M2.7-highspeed"，但当前被覆盖/删除。

**b) 所有 Codex session 的 session_meta.payload.model 都是空字符串**（6 个 session 全部 model=''）：
- ollout-2026-06-26T10-08-43: model='' provider='custom' cli=0.142.0-alpha.6
- ollout-2026-06-26T14-43-12: model='' provider='custom' cli=0.142.0-alpha.6
- ollout-2026-06-26T16-55-10: model='' provider='custom' cli=0.142.0-alpha.6
- ollout-2026-06-26T19-37-51: model='' provider='custom' cli=0.142.0-alpha.6
- ollout-2026-06-26T20-31-42: model='' provider='custom' cli=0.142.0-alpha.6
- ollout-2026-06-26T21-48-47: model='' provider='custom' cli=0.142.2

**c) session 实际 turn_context 用的是带前缀 model**（不是默认的 gpt-5.4）：
- minnimax.chat/MiniMax-M2.7 / MiniMax-M2.7-highspeed / minnimax/MiniMax-M3 等

**d) gpt-5.4 错误时间规律**：
- 错误成对/成组出现（间隔 6ms~38ms），是 reqwest 客户端重试
- 错误**夹在两次正常请求之间**：13:18:53 完成 → 13:19:18 gpt-5.4 错误 → 13:21:20 正常请求
- **用户实际请求（turn_context 用 M2.7/M3）完全正常**——gpt-5.4 错误与用户对话无关

**e) model-presets.json 中 gpt-5.4 的归属**：
`json
{
  "name": "GPT-5.5",
  "aliases": ["gpt-5.5", "gpt-5.4", "gpt-5-turbo"],
  "context_window": 1050000,
  "max_tokens": 131072
}
`
**gpt-5.4 是 GPT-5.5 的别名**。但 godex 当前 nabled 列表里没有 GPT-5.5 也没有 gpt-5.4 alias 映射。

### 根因
Codex 0.142.x 客户端在以下场景会发"模型探测"请求（不挂 model 字段，由 Codex CLI 内部硬编码默认 model gpt-5.4）：
1. **Model 升级提示**（弹窗"已升级到 gpt-5.5" 时探测新 model）
2. **UI 切回默认 model**（用户切换服务商时）
3. **启动预热 / 状态拉取**
4. **seen-model-upgrade-list: ["gpt-5.5"] 提示触发**

godex 端 model-presets.json 虽然把 gpt-5.4 解析成 GPT-5.5 预设，但 models.enabled 列表里**没有**这个预设；models.aliases 也没有 gpt-5.4 → minimax.chat/MiniMax-M2.7 映射；所以 ModelResolver.resolve("gpt-5.4") 走 indEnabledMatch 路径，匹配失败，抛 server.request.model_not_found 400。

### 影响
- **不影响用户对话**——错误是独立后台请求
- **污染 godex.log**——371 条噪音干扰真问题诊断
- **不消耗 MiniMax 配额**——错误在 godex 端早期就拒绝

### 修复方案（独立可做）

**方案 A（推荐）**：在 godex.yaml 加 alias 把 gpt-5.4 路由到用户的默认 model：
`yaml
models:
  aliases:
    gpt-5.4: minimax.chat/MiniMax-M2.7
    gpt-5.4-mini: minimax.chat/MiniMax-M2.7-highspeed
    gpt-5.5: minimax.chat/MiniMax-M3
  enabled: [...]
`
**优点**：gpt-5.4 错误消失，Codex 客户端的"模型探测"也能正常返回
**缺点**：Codex UI 显示的"已升级到 gpt-5.5"提示可能会让用户混淆

**方案 B（保守）**：在 Codex 端 ~/.codex/config.toml 显式设 model = "minnimax.chat/MiniMax-M2.7"，避免 Codex 用默认 model 发请求：
`	oml
model_provider = "custom"
model = "minnimax.chat/MiniMax-M2.7"
`
**优点**：根本上不让 Codex 用 gpt-5.4
**缺点**：用户切 model 时仍可能触发默认 model 请求；需要 Codex++ 同步写这个字段

**方案 A + B 都做**：A 处理已经发生的请求，B 预防新请求。

### 另一个真实问题（用户最初问的"上下文超 5 次"）

godex.log 中同时有 98 条 invalid params, context window exceeds limit (2013) 错误：
- provider: minimax
- model: MiniMax-M2.7-highspeed
- status: 502（godex 端 providerErrorToHttp 映射）
- 错误**成对/成组**（间隔 1-3 秒）= reqwest 自动重试 5 次

修复依赖：
1. **修 margin bug**（A）—— 让 godex 端 effective 值更小，避免 422
2. **error passthrough**（commit a6c5c9d 已做）—— 让 Codex 端能看到 400 而非 502，触发早失败早压缩
3. **可选**：在 godex 端加 retry 限制，避免无限重试同一个无效请求

### 实施清单追加

| # | 改动 | 文件 |
|---|------|------|
| 8 | godex.yaml 加 gpt-5.4 / gpt-5.4-mini / gpt-5.5 alias 路由 | ~/.godex/config.yaml |
| 9 | Codex++ 写 ~/.codex/config.toml 的 model 字段 | src-tauri/src/state.rs write_codex_model_context 函数 |
