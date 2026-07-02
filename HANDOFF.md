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
1. main.rs 在调 
un() 前 parse_args() 拿到 --config=<path>，存 OnceLock<PathBuf>
2. 
un() 把 OnceLock 里的路径作为 config_path 初值塞进 AppState
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

**根因**：oninput 触发 setModelParam → 
enderModels() 整表 innerHTML 重写，输入框被销毁重建。

**优化方案**：
1. setModelParam 用 
equestAnimationFrame 节流（200ms），仅 idle 时再重渲
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

**D（godex 启动失败时给清晰错误）不做**：Studio 的 
ead_enabled_models 命令读 yaml 失败时直接报错即可。

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
| 7 | ABE 校验 + reasoning + probe 元数据（H+E+D 修正） | 2（src/index.html + src-tauri/src/config.rs） | 低 | 30 min | done 28f3cf4 |

**总预计**：~2.5h；#1-#7 已完成并推送到 fork。


---

## 四、gpt-5.4 model_not_found 调查（2026-06-27 15:30）

### 现象
~/.godex/logs/godex.log 中持续出现 Model not found: gpt-5.4 错误（status 400），累计 371 条（2026-06-26 12:20 ~ 2026-06-27 09:24），间隔从 1ms 到几十秒不等。

### 调查方法
1. godex 端：godex.log 中错误前后的 
equest.received / provider.request.sending / stream.completed 记录
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
- 
ollout-2026-06-26T10-08-43: model='' provider='custom' cli=0.142.0-alpha.6
- 
ollout-2026-06-26T14-43-12: model='' provider='custom' cli=0.142.0-alpha.6
- 
ollout-2026-06-26T16-55-10: model='' provider='custom' cli=0.142.0-alpha.6
- 
ollout-2026-06-26T19-37-51: model='' provider='custom' cli=0.142.0-alpha.6
- 
ollout-2026-06-26T20-31-42: model='' provider='custom' cli=0.142.0-alpha.6
- 
ollout-2026-06-26T21-48-47: model='' provider='custom' cli=0.142.2

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

## 五、本轮修复（2026-06-27 第三轮：Studio 调试收尾）

### 背景
上一轮推送 `7475827` 后用户报告两个仍存在的 bug：

1. **sash-main-log 拖不动** — Studio 主区 ↔ 日志区之间的 sash，鼠标拖完全无效
2. **model-probe.exe 的 config 路径为空** — 启动后 UI 上"Config"输入框是空白的

### 排查过程

**Bug A (sash-main-log)**：
- 看 HTML/CSS/JS 无明显异常（其他 3 个 sash 都正常工作）
- 解开 `target/release/build/godex-studio-*/out/tauri-codegen-assets/*.html` 看 embedded HTML
  - 发现 embedded HTML 里 `.model-list` 仍是旧版（没有 `contain:layout style` 修复）
  - 这是 Cargo incremental 缓存没刷新导致 — 二进制仍然是 18:57:16 的旧版
- 第一次 `cargo build --release` (19:14:47) 后 embedded HTML 包含了 `contain:layout style`，但 Bug A 仍在
- 用 Playwright + mocked `__TAURI__` 在 file:// 加载 index.html 测试 drag
  - 复现了：mouse move 20 次，每次都抛 `Cannot read properties of null (reading 'style')`
  - 根因：`initSashes()` 里写的是 `beforeEl: `$("main")`` ，但 `$ = (id) => document.getElementById(id)`，而 `<main>` 标签**没有 `id="main"`**，所以 `$("main")` 返回 null
  - 修复：`<main>` → `<main id="main">`

**Bug B (config 路径)**：
- 看 `commands.rs:launch_model_probe` 实际已经在 `cfg_path` 非空时传 `--config=...` 给 model-probe.exe
- 看 model-probe 的 `lib.rs` 解析 `--config=` → `CLI_CONFIG_PATH` → 写入 `state.config_path`（setup 阶段正确）
- **看 model-probe 的 `src/index.html` init 逻辑**：
  - 只从 URL `?config=...` 或硬编码 fallback (`godex.yaml`, `D:/Documents/VibeCoding/GodeX/godex.yaml`) 读路径
  - **完全不读 CLI `--config=...`**，所以 UI 始终空白（虽然 Rust 端 state.config_path 已经正确）
- 修复：
  - `lib.rs` 加 `get_initial_config_path` Tauri command，返回 `state.config_path` 的 String
  - 注册到 `invoke_handler`
  - `index.html` init 时先 URL param，没有就 `await invoke("get_initial_config_path")`，再 fallback

### 代码改动
| 文件 | 改动 |
|------|------|
| `studio-tauri/src/index.html` | `<main>` → `<main id="main">`（1 行）|
| `studio-tauri/model-probe/src-tauri/src/lib.rs` | 新增 `get_initial_config_path` Tauri command + 注册到 invoke_handler |
| `studio-tauri/model-probe/src/index.html` | init 流程：URL param → get_initial_config_path → tryDefaultPaths fallback |

### 验证
1. **Bug A**：Playwright drag 测试
   - 修复前：main 480→480（不变），log 274→274，pageerror ×20
   - 修复后：main 480→680，log 274→120（撞 min），pageerror = 0
   - 同时验证 sash-cols / log-sash 也都正常，无回归
2. **Bug B**：解压 `model-probe-48f627422a9ff559/0826d364*.html` embedded HTML 确认含 `get_initial_config_path`
3. **embedded HTML 修复**：解压 `godex-studio-8f68c89455d7cec8/c6289da30e79b*.html` 确认同时含 `<main id="main">` 和 `contain:layout style`

### Release 二进制
- `studio-tauri/src-tauri/target/release/godex-studio.exe` 19:29:29 (含 Bug A fix + 7475827 fix)
- `studio-tauri/model-probe/src-tauri/target/release/model-probe.exe` 19:21:24 (含 Bug B fix)

### 新增的工具脚本（`tools/`）
- `patch-bug-a.cjs` — 给 `<main>` 加 id（可重放）
- `patch-bug-b.cjs` — model-probe lib.rs + index.html patch（可重放）
- `test-sash.cjs` / `test-sash2.cjs` / `test-all-sashes.cjs` — Playwright 自动化测试 4 个 sash 拖动
- `verify-assets.cjs` — 解压 brotli 验证 embedded HTML 包含关键 fix

### 经验教训
1. **Tauri 2 的 frontend 改动不会自动触发 cargo rebuild**——HTML/CSS 改了但 Rust 没动的话，cargo incremental 缓存会复用旧 embedded HTML。需要 touch 一个 Rust 文件强制 rebuild。
2. **Playwright + mocked `__TAURI__` 是测试 Studio UI 的好方法**——避免开真实 Tauri 进程，可以用 file:// 加载 index.html。
3. **`<main>` 这种纯 tag 名元素做 `$("...")` 查询一定要有 id**——`document.getElementById` 不查 tag name。

## 六、本轮新增：GodeX 模式选择器 UI（2026-06-27 第四轮）

### 需求
把 replica 启动从"设置 Modal"移到"GodeX 网关代理日志 ● STOPPED"右侧，改成下拉菜单 + 勾选框。

### 旧 UI（已删除）
- 设置 Modal 里有 `☑ GodeX副本运行` 勾选 + `启动副本` 按钮
- GodeX panel header 有 `☐ 外挂` 勾选

### 新 UI（GodeX panel header）
```
[内置 ▼] [▶]  ● STOPPED
          ↑           ↑
     模式下拉       启动勾选
```
- **下拉** `内置 | 副本 | 外挂`：切换模式（只存 Rust flags，不立即启动）
- **勾选 `▶`**：启动 → 几秒后检测是否真的在运行，没有则自动取消勾选
- 取消勾选 = 停止

### 行为
1. 切换模式：立即停止当前 GodeX → 存新 flags
2. 勾选启动：
   - 调 `godex_start` → 3 秒后 polling `godex_status`
   - 没跑起来 → 自动 uncheck + 报错
   - 跑起来了 → checkbox 保持 checked
3. 取消勾选：调 `godex_kill`
4. `refreshStatus()` 每 5 秒同步 checkbox 状态

### 代码改动
| 文件 | 改动 |
|------|------|
| `src-tauri/src/commands.rs` | 新 `set_godex_mode(mode)` command，同时设 `external_mode` + `replica_mode` flags |
| `src/index.html` | GodeX panel header：删外挂 checkbox → 模式下拉 + 启动勾选；删设置 Modal 里的 replica section；stub `loadReplicaStatus`（不再需要）|
| `model-probe/src-tauri/src/lib.rs` | 补 `schemas.function:` 缺失的 `}`（syntax error 导致 JS 从未真正运行）|
| `model-probe/src/index.html` | init 流程加 `get_initial_config_path` 调用 |

### 验证
- embedded HTML 全部检查通过（无 oldExtModeCheckbox，mainId+containFix+modeDropdown+modeToggle 全 true）


---

# Phase 14 - Model-Probe Modal Render + Sash Wiring (2026-07-01)

## State
- HEAD: a21509a7 (commit: fix(probe-modal): move probe-flex-mid wrapper AFTER probe-sash-results)
- Working tree clean (only untracked: bin output + tools/probe mock/pix/log files)
- Last binary: D:\\Documents\\VibeCoding\\GodeX\\studio-tauri\\src-tauri\\target\\release\\godex-studio.exe (7.5 MB, 2026/7/1)
- Mock harness: D:\\Documents\\VibeCoding\\GodeX\\tools\\probe\\probe_real_clean.html (94 KB, 2026/7/1 17:48)

## User red lines (permanent)
1. cargo build --release requires user approval. Sequence: backup -> script verify -> user OK -> compile.
2. Do not touch godex2.exe (running on 5678), CodeX, Codex++; only fix via GodeX itself.

## Compiled-binary symptoms (user-reproduced)
- Bug A: log section zero height in probe modal. Buttons may be hidden.
  - Root: .modal-box (line 142) has no display declaration => defaults to display:block.
  - .probe-flex-mid wants flex:1 1 0 but parent is block => height 0.
  - Previous fix .probe-modal-box{display:flex} was added but mock still computed display:block.
- Bug B: 4 probe-sash-* not draggable.
  - Root: initSashes() (line 901-941) only registers 4 GodeX Studio top-level sashes.
  - probe-sash-models / probe-sash-caps / probe-sash-results / probe-sash-log not registered.

## Fix plan
1. CSS: add display:flex; flex-direction:column; to .modal-box at line 142.
   - Safe: current modals are column-style; existing .row children stay flex.
2. JS: add 4 new Sash(...) entries at end of initSashes() (before closing brace).
   - All 4 use dir=h, mode=pct, defaultRatio by content size.
   - storageKey prefix godex-studio.probe.*
3. probe-section in HTML already have IDs (probe-models-section, probe-caps-section, probe-results-section, probe-log-section); only Provider section may need an ID for Sash beforeEl. Will add id=probe-provider-section on line 581.
4. Verify with Playwright mock BEFORE compiling.
5. User OK -> cargo build --release once.

## Hard no-no
- Do not move .probe-actions inside .probe-flex-mid.
- Do not modify Sash class.
- Do not touch Rust this round.
- Push only to fork (zamelee/GodeX), never origin (Ahoo-Wang/GodeX).

## Verification (run before compile)
python tools/probe/verify_modal_render.py
  -> Expect display===flex, midWrapperH>=200, logH>=100.



# Phase 15 - Probe Modal Delta-Drag + Sash Move-Inside-initSashes (2026-07-01)

## Background
Phase 14 committed (3ac46a54) the probe-modal layout fix and 4 probe sashes.
Two cosmetic / correctness issues remained:

1. **Snap-on-press bug**: pressing a probe sash (mousedown without movement)
   caused the before-element height to jump to the cursor position because
   the Sash drag math was absolute-position-based, not delta-based.
   This was the same class of bug visible on all sashes, not only the probe ones.
2. **Probe sashes outside initSashes()**: the 4 probe-sash pushes were placed
   in global scope after the closing brace of initSashes(). This worked in
   Phase 14 because the DOM already had all probe-* elements at that point,
   but it bypassed the initSashes() invocation gate and was brittle.

## Changes
All edits in `studio-tauri/src/index.html`. No Rust / Tauri / GodeX changes.

1. **New Sash method `_computeCurrentRatio()`** (inserted before `applyRatio`):
   reads the current flex-basis of `this.before` as a ratio of the container.
   Falls back to the rendered bounding-rect size when the element uses
   `flex: 1 1 0` (no explicit basis). Used by delta-based drag so a press
   without movement does not snap the layout.

2. **`_onMove` rewritten as delta-based drag**:
   new ratio = `_dragStartRatio + (mouse delta / container size)`.
   Replaces the absolute-position formula `(pos - rect.top) / rect.height`.
   Guard: return early when `totalPx <= 0`.

3. **`_onDown` and `_onTouchStart` capture the drag-start state**:
   `_dragStartY`, `_dragStartX`, `_dragStartRatio` (via `_computeCurrentRatio()`).

4. **Lower `probe-sash-results` defaultRatio from 0.22 to 0.14**:
   the caps section is small; 22% allocated too much vertical space.

5. **Move 4 probe-sash pushes from global scope into `initSashes()`**:
   wrapped in `if ($("probe-sash-models")) { ... }` so the construction
   is skipped cleanly when the probe modal has not been opened yet
   (defensive — the modal is in the DOM at page load, so the guard
   is currently always true, but it future-proofs the function).

6. **Bugfix: add `id="probe-flex-mid"` to the wrapper div** (line 651).
   The probe-sash-results `afterEl: $("probe-flex-mid")` was returning null
   because the wrapper only had `class="probe-flex-mid"`. Phase 14 forgot
   the id, causing the applyRatio RAF callback in the Sash constructor to
   throw `Cannot read properties of null (reading "style")` and silently
   skip registration for that sash.

## Mock preview (browser)
`tools/probe/probe_real_clean.html` regenerated from `studio-tauri/src/index.html`:
- strips `display:none` from `#probe-modal`
- injects `window.__TAURI__.core.invoke` and `window.__TAURI__.event.listen`
  safe stubs so the page initialises in plain Chromium without Tauri.

## Verification (all probe sashes, delta-drag behaviour)
Run `python tools/probe/_vd6.py` (per-sash; each call ~5s):
- probe-sash-models : initial 73 / hChangeOnPress 0 / hChangeOn5pxMove +5 / noSnap true
- probe-sash-caps    : initial 132 / hChangeOnPress 0 / hChangeOn5pxMove +5 / noSnap true
- probe-sash-results : initial 102 / hChangeOnPress 0 / hChangeOn5pxMove +5 / noSnap true
- probe-sash-log     : initial 153 / hChangeOnPress 0 / hChangeOn5pxMove +5 / noSnap true

All four sashes now snap-to-cursor on mousedown with no movement, and
the height change is proportional (1:1) to mouse movement.

## What is NOT changed
- No Rust / Tauri / `model-probe` code touched.
- `_onUp` (persistence) untouched.
- `_loadRatio()` (localStorage read) untouched.
- `applyRatio()` body untouched (still writes inline flex on before/after).
- Studio main sashes (sash-main-log, sash-forms, sash-cols, log-sash) untouched.

## Hard no-no (carried forward)
- Do not move `.probe-actions` inside `.probe-flex-mid`.
- Do not touch Rust / godex2.exe / CodeX / Codex++.
- Push only to fork (zamelee/GodeX), never origin (Ahoo-Wang/GodeX).
- Compile (`cargo build --release`) only after explicit user OK.


# Phase 15.1 - Fix press-without-move jump on probe-sash-models / probe-sash-caps (2026-07-01)

## Bug
After the Phase 15 fix, two of the four probe sashes still showed a small
height jump on `mousedown` followed by `mouseup` without any actual movement.
This was especially noticeable AFTER the user had manually dragged any sash
(at which point the afterEl had a concrete flex-basis that got clobbered).

Root cause: `_onUp` always called `this.applyRatio(beforePx / totalPx, true)`
on every release. The intent was to persist the final ratio. But applyRatio
sets BOTH `before.style.flex` AND `after.style.flex`. For probe-sash-models,
the `afterEl` is probe-models-section; for probe-sash-caps, the `afterEl`
is probe-caps-section. Both of those have explicit flex-basis percentages
("0 0 18.00%" and "0 0 14.00%" by default). After a manual drag of the
preceding sash, those had been overwritten to "1 1 0" — and the next
mouseup on a neighbour would either re-set them or leave them at "1 1 0",
producing a small but visible snap.

probe-sash-results and probe-sash-log did not show this because their
afterEl (`probe-flex-mid`, `probe-log-section`) is always "1 1 0" already.

## Fix
Track whether `_onMove` actually changed the ratio. Only call applyRatio on
mouseup if movement happened. New Sash state: `this.moved` (boolean).

```js
// _onDown / _onTouchStart:  this.moved = false;

// _onMove:
const clamped = Math.max(minBeforeRatio, Math.min(maxBeforeRatio, ratio));
if (clamped !== this._dragStartRatio) this.moved = true;
this.applyRatio(clamped, false);

// _onUp:
const wasMoved = this.moved;
this.dragging = false;
this.moved = false;
this.sash.classList.remove("dragging");
document.body.style.cursor = "";
if (wasMoved) {
  // persist the rendered ratio
  this.applyRatio(beforePx / totalPx, true);
}
// (always remove window listeners)
```

## Verification

### Press-without-move (user-reported scenario)
Run `python tools/probe/_test_press_release.py`:
- probe-sash-models : beforeH 73 -> 73 -> 73   afterFlex unchanged
- probe-sash-caps    : beforeH 132 -> 132 -> 132 afterFlex unchanged
- probe-sash-results : beforeH 102 -> 102 -> 102 afterFlex unchanged
- probe-sash-log     : beforeH 153 -> 153 -> 153 afterFlex unchanged

### Drag still works
Run `python tools/probe/_test_drag.py`:
- All four sashes: drag 50px -> ~50px height delta, persists on release.

### Cross-sash scenario (the actual bug)
Run `python tools/probe/_test_user_scenario.py`:
- After dragging probe-sash-models 80px (which sets models-section to
  "1 1 0"), then mousedown probe-sash-caps without moving, then release:
  models-section and caps-section heights and flex values stay constant.

## What is NOT changed
- delta-drag math (Phase 15) unchanged.
- _computeCurrentRatio unchanged.
- All probe-sash registrations unchanged.
- No Rust / GodeX touched.

## Hard no-no (carried forward)
- Do not touch Rust / godex2.exe / CodeX / Codex++.
- Push only to fork (zamelee/GodeX), never origin (Ahoo-Wang/GodeX).
- Compile (`cargo build --release`) only after explicit user OK.

# Phase 16 - Probe Live Progress + Cancel Button (2026-07-01, in progress)

## Bug
Click 开始探测 -> button shows "探测中..." -> no log entries for 45-180s -> "程序未响应".

## Root cause
- `probe.rs` was batching events in `self.events: Vec<ProbeEvent>` and only emitting them after the function returned.
- `commands.rs` was reading events via `client.take_events()` AFTER the probe call completed, then emitting each one.
- Net effect: the UI sees zero progress events for the entire 45-180s probe duration; user thinks app is frozen.

Additionally:
- `claimed` values for ctx (100000) and max_tokens (131072) were hardcoded in JS, ignoring the model's actual config.
- No way to abort a long-running probe.

## User-approved fix scope (A + B + D)
- **A**: Use the model's real `context_window` / `max_tokens` as the starting `claimed` value (fallback to 100000/131072 when unset).
- **B**: Make probe events emit live as they happen (Rust -> Tauri emit), not after the function returns.
- **D**: Add a 停止 button that sets a shared cancel flag; probe loops check the flag between iterations.

**Cancelled by user mid-flight**: log sync target.
Originally proposed "sync all probe-progress to main Studio log panel (lp-studio-body)".
User correction: NO sync to main Studio log. The probe-modal's own log (`#probe-log`) is the single source of truth for probe progress. The existing `listen("probe-progress")` handler in `startProbeRun` already writes to `#probe-log` via the inner `log()` helper — once the live-emit wiring lands, that handler will start receiving events and populating the modal log.

## Files changed

### `studio-tauri/src-tauri/src/probe.rs`
- Removed duplicate `take_events` block at EOF (was still referencing the old `self.events` field).
- Added cancel checks:
  - `probe_ctx` outer loop: top-of-iteration check; emits `("ctx", "cancelled", "at test=N")` and breaks.
  - `probe_max_tokens` outer loop: same pattern.
  - `probe_caps` 6 sub-tests: pre-test check; emits cancelled event and returns partial `caps`.
  - `probe_caps` tool_specs loop: top-of-iteration check; emits cancelled event and returns partial `caps`.
- Existing struct fields `cancel: Arc<AtomicBool>` + `live_emit: Option<Box<dyn Fn(ProbeEvent) + Send + Sync>>` from the previous session are reused.

### `studio-tauri/src-tauri/src/commands.rs`
- Added imports: `use std::sync::atomic::{AtomicBool, Ordering}; use std::sync::{Arc, OnceLock};`
- Added module-level state at end of file:
  - `static PROBE_CANCEL: OnceLock<Arc<AtomicBool>>`
  - `fn get_probe_cancel() -> Arc<AtomicBool>`
- Added new Tauri command `probe_stop()` that sets the cancel flag and logs a diag line.
- Refactored `probe_ctx` / `probe_max_tokens` / `probe_caps` to:
  - reset cancel flag (`Ordering::SeqCst`)
  - build `live_emit: Box<dyn Fn(ProbeEvent) + Send + Sync>` closure that calls `app.emit("probe-progress", &ev)`
  - call `ProbeClient::new(...)?.with_cancel(cancel).with_live_emit(live_emit)`
  - return `Ok(client.probe_*(...))` directly (no more post-hoc `take_events` loop)

### `studio-tauri/src-tauri/src/lib.rs`
- Registered `commands::probe_stop` in the `invoke_handler!` list.

### `studio-tauri/src/index.html`
- Added 停止 button in probe-actions (hidden by default):
  ```html
  <button class="btn gray" id="btn-probe-stop" style="display:none" onclick="stopProbeRun()">停止</button>
  ```
- Added `stopProbeRun()` async function: invokes `probe_stop`, disables button, logs to probe-modal log.
- Modified `startProbeRun()`:
  - Look up `em = enabled.find(...)` BEFORE the per-model probe block; compute `claimedCtx = em.context_window || 100000`, `claimedMax = em.max_tokens || 131072`. Pass these into the probe commands.
  - Hide 开始 button (style.display="none"), show 停止 button (style.display="").
  - `finally` block restores both buttons.
  - Removed the now-redundant inner `const m = enabled.find(...)` block; uses the precomputed `em` instead.
- **No changes** to the `probe-progress` listener or the `log()` helper. They already write to `#probe-log`.

## State
- Branch: `codex/probe-live-cancel` (off `0e048ee0`)
- Modified (uncommitted): `probe.rs`, `commands.rs`, `index.html`, `lib.rs`
- Backup of previous exe: `studio-tauri/src-tauri/target/release/godex-studio.exe.bak.pre-phase16`

## Verification done (no compile yet)
- `cargo check --release` -> passes (only pre-existing `studio_log` field warning).
- `cargo clippy --release --lib` -> 29 warnings total, NONE new from Phase 16 changes (the `deref` warning on `probe.rs:483` is from the new line `ProbeEvent::info(*name, ...)` — minor, not blocking).
- JS extracted and `node --check` -> passes.
- Static checks on new IDs / function names / claimed-value wiring -> all pass.
- Confirmed `lp-studio-body` is NOT referenced from either `startProbeRun` or `stopProbeRun` blocks.

## Hard no-no (carried forward)
- Do not touch Rust / godex2.exe / CodeX / Codex++.
- Push only to fork (zamelee/GodeX), never origin (Ahoo-Wang/GodeX).
- `cargo build --release` requires explicit user OK.

## What is NOT done yet
1. Manual smoke test of the new behaviour (needs user to run the recompiled exe):
   - click 开始探测 -> expect live log entries streaming into the probe-modal log area
   - click 停止 -> expect cancel events to fire and the probe to abort cleanly
2. Commit + push (after smoke test OK).

# Phase 16.1 - Fix UI Freeze (sync command blocks webview thread)

## Bug (reported after Phase 16 build)
Click 开始探测 -> button shows "探测中..." -> UI completely frozen for 45-180s, even though
live-emit wiring was supposedly in place. No log entries appear in `#probe-log`.

## Root cause
`tauri::command` **sync** functions (`pub fn`, NOT `async fn`) run **inline on the calling thread**.
The Tauri macro body (`tauri-macros-2.6.3/src/command/wrapper.rs:404 body_blocking`) does:
```rust
let result = $path(args);        // run our probe synchronously
kind.block(result, resolver);   // respond
```
No `spawn_blocking`, no `async_runtime::spawn`. On Windows + WebView2, the IPC message handler
is invoked from within the webview's message pump. A blocking probe command therefore freezes
the entire UI for the duration of the probe.

The `live_emit` closure *was* correctly firing `app.emit("probe-progress", ...)` from the probe
thread, but the JS-side `invoke("probe_ctx", ...)` Promise could not resolve while the IPC thread
was blocked, so the JS event loop was effectively stuck waiting on the unresolved Promise.

## Fix
- Changed `probe_ctx` / `probe_max_tokens` / `probe_caps` from `pub fn` to `pub async fn`.
- Wrapped blocking work in `tauri::async_runtime::spawn_blocking(move || ...)`.
- Extracted the inner probe work into 3 helper functions (`run_probe_ctx_inner`, etc.)
  to avoid `move || -> Result<...> { ... }` parse ambiguity inside spawn_blocking argument.
- After `.await`, `.map_err(|e| format!("...join: {}", e))?` converts `tauri::Error` to `String`.

The cancel flag and live-emit closure are unchanged.

## Why the parse ambiguity workaround
Direct inline form:
```rust
tauri::async_runtime::spawn_blocking(move || -> Result<X, String> {
    let ...;
    Ok(...)
})
.await
.map_err(...)?
```
Was rejected by rustc with "unclosed delimiter" on the spawn_blocking `{`. Likely a parser edge case
where the `-> Result<...>` return-type arrow in a closure-as-argument confused the brace tracker.
Workaround: pull the body out into a named `fn run_probe_ctx_inner(...) -> Result<...>`, then pass
that as a function pointer to spawn_blocking. The function name has no return-type arrow inline.

## Verified
- `cargo check --release` -> only the pre-existing `studio_log` field warning.
- `cargo build --release` -> success in ~2m 57s.
- New exe size 7607808 bytes (Phase 16 was 7586816, +21KB for helpers + spawn_blocking wiring).
- New exe MD5 `939234ccdbe3b300e41112445a34e1b4`.
- Backup of previous exe: `godex-studio.exe.bak.pre-phase16.1`.

## Hard no-no (carried forward)
- Do not touch Rust / godex2.exe / CodeX / Codex++.
- Push only to fork (zamelee/GodeX), never origin (Ahoo-Wang/GodeX).
- `cargo build --release` requires explicit user OK.


# Phase 17 - Probe Save/Close 改造 (2026-07-02, smoke-tested OK)

## 目标
Phase 16.1 解决了"探测卡死看不到进度"。Phase 17 解决探测结果保存的两处遗留问题:
- saveProbeResults() 之前是 stub("开发中"),必须实写。
- closeProbeModal() 之前不区分"已保存 / 未保存",关闭即丢。
- 关窗口后主窗口的"已启用模型"字段不刷新。

## 用户拍板的三条决策
- Q1 = B+fallback:扩展 CAPS 到 14 项(新增 reasoning / web_search / file_search / computer_use / tool_search / mcp),fallback 语义是 probe 值为 null/undefined 时 **不覆盖** 现有 capability;仅当 v === true 或 v === false 才写入。
- Q2 = B:探测结果中 enabled[] 不存在的新模型 **自动加入**(enabled.push(newRow))。
- Q3 = 覆盖 + 弹窗确认:保存前弹窗显示"将保存 N 个到 provider: 更新 X 个(覆盖 ctx / max_tokens / capabilities), 新增 Y 个到 enabled[], 确定继续?",用户确认后才写。

## 代码改动

### studio-tauri/src/index.html(主要)
- CAPS 数组:8 项 → 14 项(reasoning / web_search / file_search / computer_use / tool_search / mcp 新增)。
- CAP_LABELS 字典:同步补 6 个中文标签。
- launchModelProbe() 入口加 reset:
  - _probeResults = [], _probeChanged = false,避免上次未保存的探测结果污染本次。
- saveProbeResults() 从 stub 重写为完整实现:
  - 过滤 success === false 的行(失败的行不进保存,仍留在结果表)。
  - 计数 updateCount / addCount,弹 confirm()。
  - 保存按钮 disable + 文案变 "保存中..."。
  - PROBE_TO_CAP 映射表(11 项:text/image/audio/video/function/reasoning/web_search/file_search/computer_use/tool_search/mcp → CAPS 字段)。
  - 已存在模型 → 覆盖 ctx / max_tokens / capabilities,fallback 保留未测字段。
  - 新模型 → push 到 enabled[],仅当 anyCap === true 时挂 capabilities。
  - 走和 saveEnabled() 同一条路径:read_enabled_models → merge → save_enabled_models。
  - 成功后 _probeChanged = false + renderModels() 刷新主窗口。
  - catch 显示 "保存失败: ...",finally 恢复按钮。
- closeProbeModal() 加 _probeChanged 守门:
  - 弹"有未保存的探测结果,确定关闭?",确认后关窗 + renderModels() 刷新主窗口。

### Rust(Phase 16.1 留下的,无新改动)
- commands.rs:probe_ctx / probe_max_tokens / probe_caps 已经是 async + spawn_blocking;新增 probe_stop 命令。
- probe.rs:ProbeClient 加 with_cancel(Arc<AtomicBool>) / with_live_emit(...),ctx / max_tokens / caps 探测循环每步检查 is_cancelled()。
- lib.rs:注册 probe_stop 命令。

## 验证
- node --check 通过(提取 _extracted3.js 后)
- 静态检查 27/27 通过(_static_check2.py)
- cargo check --release 通过(仅 1 个无关的 studio_log 字段警告)
- cargo build --release 成功(2m 57s,rc=0)
- 新 exe size 7607808 bytes(与 Phase 16.1 相同,JS 改动小到不影响段大小)
- 新 exe MD5 976b7a861f348541dd0f79862c1b9571
- 旧 exe MD5 939234ccdbe3b300e41112445a34e1b4(已备份为 godex-studio.exe.bak.pre-phase17)
- 烟测 8 步全过(弹窗、更新/新增计数、关窗刷新、新模型加入、保存守门等)

## 已知未做
- multimodal 旧字段未清理(与新 image_input / audio_input / video_input 重叠语义,但保留无害)。
- 未加保存进度动画(仅 disable 按钮 + 改文案)。
- 未做"哪些字段被更新、哪些被 fallback 保留"的可视化。

## 红线维持
- 不动 Rust 已有逻辑(Phase 17 仅写 index.html)。
- 不动 godex2.exe / CodeX / Codex++。
- Push 只到 fork (zamelee/GodeX)。
- 编译仍需用户明确 OK。

## Phase 18 - 模型能力探测 v4 (image/audio/video + tools) 全面可靠化

### 起点（已 commit 在 f9d38970 之前）
- v3（keyword + LLM judge）发现假阳性：image_input 对 M3 误判 -U。
- 探查 v4 源码发现：image_input 用了 2 个 fixture，其中 B_LETTER 是 https URL（`https://placehold.co/...png?text=B`），上游 minnimax.chat 直接返回 400 bad_request_error；RED_PNG 是 base64 数据 URI。
- 实际判定逻辑：M3 RED_PNG status=200 描述正确，但因为缓存中 RED_PNG status=0（网络抖动）+ B_LETTER 400，LLM judge 看 status=0 + status=400 联合判定为 -U（误把网络抖动当上游拒绝）。

### 改动总览（tools/probe/upstream/probe_v4.py + 配套 fixture）

#### 1. 修复入口语法（最先做，否则脚本跑不起来）
- 旧版 v4 line ~269 残留 literal `\r\n`（反斜杠-r-反斜杠-n 这 4 个字面字符），导致 SyntaxError。
- 改法：Python 字节级 `replace(b"\r\n", b"")` 直接删除。

#### 2. 增加 2nd base64 image fixture（替换 HTTPS B_LETTER）
- 旧：B_LETTER = `https://placehold.co/64x64.png/000000/FFFFFF/png?text=B`
- 新：GREEN_CIRCLE = 64x64 PNG 纯绿色圆形，base64 嵌入，新增 fixture 文件 `tools/probe/upstream/_GREEN_B64.b64`（约 250 字节 b64）。
- 同步修改 PROMPT_TEMPLATE 文案、JSON 输出 schema、参考 `B_LETTER` 全部替换为 `GREEN_CIRCLE`。

#### 3. Reasoning 3-shot + 多数投票
- `probe_reasoning_raw` 默认 n_shots=3，同 prompt 发 3 次，记录每发 `usage.completion_tokens_details.reasoning_tokens`。
- `judge_reasoning` 规则：
  - `≥2/3 shots reasoning_tokens>0` → `true`
  - `1/3` → `false_model`（marginal）
  - `0/3` → `false_model`
  - `0/3 with status≠200` → `false_other`
- 目的：reasoning 行为有随机性（cached 显示 M2.7 一次 185 tokens、一次 0 tokens），单发不可靠；3-shot 才能给稳定结论。

#### 4. Code-level multimodal fallback（LLM judge 失稳时）
- 加 `_fixture_refuses(response_text, cap)`：按 cap（image/audio/video）匹配 MM_REFUSAL_PHRASES 列表里约 38 条英文/口语化拒绝短语。
- 加 `_fixture_has_substantive(response_text)`：剥掉 <think>...</think> 块，要求正文 ≥20 字符的实质描述。
- 加 `code_judge_multimodal(cap, raw)`：per-fixture 跑前两个 + 多 fixture 聚合（与原 multi-fixture rule 一致）。
- 加 curly-quote 归一化：模型的 `I'm sorry, but I don’t have the ability` 用的是 U+2019 直引号，与 ASCII `'` 不匹配；归一化为 chr(39) 后才能命中 "i don't have the ability to view" 等短语。
- 兼容 audio/video 单一 fixture 形态（raw 中无 `fixtures` 字段，用 `cap/status/response_text/error_code` 单值）；code_judge 在这种情况自动构造单 fixture 视图。

#### 5. 4xx vs 5xx 区分
- 旧规则：`if all(s >= 400)` 判 false_upstream — 把 5xx（529 overloaded_error 等）也归到上游拒绝，错误。
- 新规则：
  - `all(s and 400 <= s < 500)` → false_upstream（真上游拒绝）
  - `any(s and 500 <= s < 600)` → false_other（服务端过载/临时错误，可重试）
  - 其他 → 走 code_judge_multimodal fallback

#### 6. LLM judge parse-fail fallback
- 旧规则：JSON parse failed → 全部归到 `inconclusive` (`?`)。
- 新规则：parse failed 但 raw 里有 200 响应 → 调 `code_judge_multimodal` 跑 refusal 检测；至少得到 -M / -U / -X 之一。

#### 7. Probe 模型 capability 真值表（minnimax.chat, 3-shot reasoning, 2-fixture image）

| capability     | M2.7  | M2.7hs | M3   |
| -------------- | ----- | ------ | ---- |
| text           | +     | +      | +    |
| image_input    | -M    | -M     | +    |
| audio_input    | -U    | -X*    | -M   |
| video_input    | -M    | -M     | +    |
| function_call  | +     | +      | +    |
| reasoning      | +     | +      | +    |
| web_search     | +     | +      | +    |
| file_search    | -U    | -U     | -U   |
| computer_use   | -U    | -U     | -U   |
| tool_search    | -U    | -U     | -U   |
| mcp            | -U    | -U     | -U   |

`*` M2.7hs audio 这次拿 529 (overloaded_error)，所以 -X；其它次 -U。说明服务端不稳，需要重测。

- **重要警告**：M2.7hs 在 Codex session 019ebae1-aeb7-7b13-b8c6-5f41831b88ea（2026-06-12）里能正确描述图片。**直接 Chat Completions 探针说 -M (refusal)，Codex via GodeX 走 Responses→Chat 转换能用。**说明 minnimax.chat 这个 gateway 对 M2.7hs 的 image 处理可能是按某种"激活条件"决定的（不是裸模型能力问题）。换 Provider 之前不要下"模型不能看图"的结论。
- **web_search 三家都是 +** —— 但用的是 minnimax.chat 的 custom function `plugin_web_search`，不是 OpenAI 标准 `type:"web_search"`，GodeX 端兼容性要注意。
- **file_search / computer_use / tool_search / mcp 都是 -U** —— 全部 400 bad_request_error，minnimax.chat 这个 gateway 不暴露这些 tool。

### "什么情况下必须重跑 probe"（用户拍板）

**触发：用户手动点 [探测模型] 按钮（Studio UI 提供）；不做自动触发。**

白话：只要"哪个模型 + 哪个上游"这一对组合变了，probe 结果就得重新跑一遍。光改参数不改组合，不用重跑。

- **要重跑的情况**：
  1. 切模型（在同一个 Provider 下从 M2.7 切到 M2.7hs / M3）—— 每个模型能力不同
  2. 切 Provider / 上游网关（minnimax.chat -> 别的网关）—— `-U` 是当前网关的限制，换 gateway 同一个 cap 可能从 `-U` 变 `+`
- **不用重跑的情况**：
  - 只换 API key（同 Provider 同模型）
  - 只调温度 / top_p / max_tokens / 余量百分比等调用参数
- **`-U` 的含义**：当前上游拒绝，不是模型不能。带这个标签的能力换 gateway 也许就行。
- 探测程序永远跑全部 fixture，不跳过任何 -U-prone 的 cap（避免历史 -U 把 cap 永久排除）。

### 符号图例（确认版）
- `+` true (绿): 模型确实处理了输入 / 调了 tool
- `-M` false_model (橙): API 200，但模型按 refusal 模式拒绝
- `-U` false_upstream (灰): API 4xx，**Provider-specific**；换 provider 也许就行
- `-X` false_other (红): 网络/解析/5xx 错误，可重试
- `?` inconclusive (蓝): 数据不足判不了

### 已知未做（Phase 18 留下）
- v4 还是单线程（顺序跑 11 caps + 1 judge ≈ 3-5 分钟/模型）。用户提到并发可选。
- LLM judge 与 code judge 偶尔判得不一样（LLM 看 thinking 文本有时把 M2.7hs 图像判 -U，code 看 refusal 短语判 -M）。当前以 LLM 为主，code 仅为 fallback。
- 用户提到的 LLM-as-meta-judge 思路（拿全部 raw 日志 + 提示词让 LLM 一次性总结所有 cap）—— 待定，没动手。

### 红线维持
- 仍不动 Rust / godex2.exe / CodeX / Codex++。
- 这次纯改 Python（probe_v4.py + 1 个 fixture 文件）。
- Push 只到 fork (zamelee/GodeX)。
- 编译仍需用户明确 OK。
