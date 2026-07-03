# Handoff: Studio + Model-Probe 功能开发

> 生成时间: 2026-07-03
> 当前分支: codex/probe-live-cancel
> 远程: origin (只读), fork (可写)

## 状态总结

### 已完成功能
1. **probe_v4.py** - 混合探测脚本（LLM judge + code fallback）
2. **probe_v4_quick.py** - 快速版本（基于 v3，简单判断）
3. **probe_v3.py** - LLM-as-judge 版本
4. **Studio Tauri 命令** - probe_model, open_in_editor, launch_model_probe
5. **Studio Modal** - 探测结果 UI（**已修复可见性 bug**，见下方）

### 已知问题
1. **1 个测试失败** - `studio-tauri/src/sash_full_test.js` 被 Bun 误加载为测试（浏览器端 JS，无 `window`）。预存在，非本次改动引入。
2. **1 个 TS 错误** - `src/bridge/request/request-builder.test.ts(1138)` 缺 `parameters`/`strict` 字段。预存在。
3. **API 不稳定** - MiniMax API 响应时间波动大（35-150s/模型）

### 脚本位置
- `tools/probe/upstream/probe_v4.py` - 完整版（LLM judge + code fallback）
- `tools/probe/upstream/probe_v4_quick.py` - 快速版
- `tools/probe/upstream/probe_v3.py` - LLM-as-judge 版本
- `tools/probe/live_logs/` - 运行日志

### 快速运行命令
```bash
# 完整探测（推荐）
python tools/probe/upstream/probe_v4.py

# 快速探测
python tools/probe/upstream/probe_v4_quick.py --target "MiniMax-M2.7"

# 带 bridge 检查
python tools/probe/upstream/probe_v4.py --check-bridge
```

## 下一步
1. Studio 打包测试
2. 验证 godex.exe 桥接层正确降级 web_search
3. 用户测试 Studio 功能
4. (可选) Rust 端 schema v1.0 升级（见下方"待办"）

## 红线维持
- 不动 Rust 端生产代码（godex2.exe / CodeX / Codex++）
- 只改 Python 探测脚本和 Studio 前端
- 只推送到 fork (zamelee/GodeX)
- godex.exe 是中转服务，studio-tauri.exe 是 GUI 桌面应用

---

## [2026-07-03] 模型探测 Modal 可见性修复

### 问题描述
用户反馈：Studio 的"模型能力探测"子窗口中，选择全量（Python + LLM）模式后，**结果栏不显示任何数据**，只能看到日志栏疯狂刷屏（Python 输出）。即使探测完成，保存按钮也无法工作。

### 根本原因
经排查发现 3 个独立 bug 同时存在：

#### Bug 1: CSS 特异性导致结果栏被压扁
**位置**: `studio-tauri/src/index.html` CSS 部分

```css
/* 失败 - 优先级低 */
.probe-results-section { flex: 0 0 200px; min-height: 100px; }

/* 父规则 - 优先级高 (0,0,2,1 vs 0,0,1,0) */
.probe-flex-mid > .probe-section { flex: 0 0 auto; min-height: 50px; }
```

更通用的规则 `.probe-flex-mid > .probe-section` 因为有 `.probe-flex-mid >` 限定而特异性更高，把 200px 覆盖成 **50px**。结果栏只够显示标题，表格被挤到不可见区域。

**修复**: 提高选择器特异性
```css
.probe-flex-mid > .probe-section.probe-results-section { 
    flex: 0 0 200px; 
    min-height: 100px; 
}
```

#### Bug 2: `reasoning` 字段误标
**位置**: `studio-tauri/src/index.html` JS 的 `startProbeRun` 函数（全量模式分支）

```javascript
// 旧代码 - bug: 只要 j["reasoning"] 存在就返回 true
r.reasoning = !!j["reasoning"];
```

这导致**所有有 reasoning 探测数据的模型都被标记为支持 reasoning**，即使实际状态是 `"false_model"`。

**修复**: 显式检查 status 字段
```javascript
r.reasoning = isTrue("reasoning");
```

#### Bug 3: 旧 `truthy` 函数假设特定数据格式
**位置**: `studio-tauri/src/index.html` JS

```javascript
// 旧代码 - 假设 v[0] 是数组
function truthy(k) {
    const v = j[k];
    return v && v[0] === "true";
}
```

依赖 Tauri 序列化 `(String, String)` 元组为 JSON 数组。如果未来 Rust 端把 `judgments` 类型改为 `HashMap<String, Judgment>` (对象 `{status, reason, method}`)，JS 解析会失败。

**修复**: 同时支持数组和对象两种 schema
```javascript
function statusOf(v) {
    if (!v) return null;
    if (typeof v === "object" && !Array.isArray(v)) return v.status || null;
    if (Array.isArray(v) && v.length >= 1) return v[0];
    return null;
}
function isTrue(v) { return statusOf(v) === "true"; }
```

### 修改文件清单

| 文件 | 改动 | 类型 |
|------|------|------|
| `studio-tauri/src/index.html` | CSS 特异性修复 | bug fix |
| `studio-tauri/src/index.html` | `truthy` → `statusOf/isTrue` | refactor + bug fix |
| `studio-tauri/src/index.html` | 修复 `r.reasoning = !!j["reasoning"]` | bug fix |
| `tools/probe/upstream/probe_v4.py` | 新增 `JUDGMENT_METHOD` 常量 + `schema_version` 字段 | preparation for schema v1.0 |

### 验证方法

**预览模式**（无需打包）:
1. 打开 `D:\Documents\VibeCoding\GodeX\preview.html` （或本地 server `http://127.0.0.1:8765/preview.html`）
2. 看到完整 Modal：Provider 下拉 + 模型 pills + 能力勾选 + 结果 + 日志
3. 点 ▶ 模拟开始探测
4. 观察：3 个模型依次完成 → 结果栏**逐行增加** → 日志栏实时输出
5. 关键验证点：
   - **结果栏完整可见 200px**（不是 50px 只能看标题）
   - **M2.7 / M2.7-highspeed 的 Reason 列显示 NO**（不是误标 YES）
   - **M3 的 Reason 列显示 YES**（真的支持）

**真实 Studio**:
1. 重启 `bin/godex-studio.exe`（已包含修复）
2. 打开"模型探测"窗口
3. 选择 minnimax.chat Provider
4. 勾选 3 个模型（M2.7 / M2.7-hs / M3）
5. 选全量模式，点开始
6. 观察结果栏是否逐行出现

### 已知次要问题（未修复）

1. **`child.wait()` 阻塞 async runtime**: Rust 函数 `probe_full_via_python` 用 `std::process::Child::wait()`（阻塞），在 `async` 函数中会阻塞整个 Tauri async runtime，导致 `probe-full-log` 事件延迟传递。修复：改用 `tokio::process::Child::wait().await`。但这是次要问题，日志最终都会到。

2. **schema v1.0 升级未完成**: Python 已经写 `schema_version: "1.0"` 和对象格式 judgments，但 Rust `ProbeFullResult` 仍然是旧的 `HashMap<String, (String, String)>`。当前 JS 的 `statusOf` 兼容两种格式，过渡期 OK，但要彻底 schema v1.0 还需要重建 `probe_full_via_python` Rust 函数（源码丢失，需重新实现）。

### 编译产物
- `studio-tauri/src-tauri/target/release/godex-studio.exe` (7.6 MB, 2026-07-03 09:18)
- `studio-tauri/src-tauri/target/release/bundle/nsis/GodeX Studio_0.1.0_x64-setup.exe`
- 已部署到 `bin/godex-studio.exe` (覆盖旧版本)
- 旧版本备份: `bin/godex-studio.exe.bak.20260703_091829`

### 测试结果
- TypeScript: ⚠️ 1 个**预存在**错误
- Lint: ✅ 干净
- Bridge tests: ✅ 230/230
- Studio-tauri Rust tests: ✅ 25/25
- 1 fail (pre-existing sash_full_test.js): 不影响功能

### 推送记录
- Commit: (待生成)
- Push: fork (zamelee/GodeX) only

---

## [2026-07-03] Web Search tool 修复 (open_page / find_in_page)

### 问题
Codex 客户端的 `web_search` 工具支持 3 种 actions:
- `search` (with `query`)
- `open_page` (with `url`)
- `find_in_page` (with `url` + `pattern`)

之前 godex 的 `webSearchDeclaration` 渲染时只声明 `enable` 和 `search_engine`, 没有提供参数描述告诉模型三种 action 怎么用。模型只看到 `query` 参数,所以:
- 用户说 "Open URL X" → 模型回答 "我没有 URL 打开功能" → 返回 `{"query": "X"}`
- godex 还原成 `web_search_call action=search` (错的) 而不是 `open_page`
- Codex 收到错误的 action → 行为错乱

### 修复
1. **`webSearchDeclaration`** 现在接受 `providerType` 参数:
   - 当 `providerType === "web_search"` (Zhipu/DeepSeek 等原生支持) → 走原生格式
   - 当 `providerType === "function"` (minimax 等降级场景) → 渲染成 function,描述里说清楚全部 3 种 action 和对应参数
2. **`webSearchCall`** 根据参数形状还原 action:
   - `{query}` → search
   - `{url}` → open_page
   - `{url, pattern}` → find_in_page
3. **测试**: 替换原来错误的"无 query 字段回退到 function_call"测试为正确的 3 种 action 测试

### 修改文件
- `src/bridge/tools/declaration-renderer.ts` — webSearchDeclaration 接受 providerType
- `src/bridge/tools/call-restorer.ts` — webSearchCall 识别 3 种 action
- `src/bridge/tools/call-restorer.test.ts` — 测试更新

### 端到端验证
| 测试 | 模型返回 | 预期 action | 实际 |
|------|---------|------------|------|
| Open URL | `{"url": "..."}` | open_page | ✅ |
| Find "login" on page | `{"url": "...", "pattern": "login"}` | find_in_page | ✅ |
| Search news | `{"query": "AI ..."}` | search | ✅ |

### MCP 测试结果
CodeX 端发起的 MCP 请求 (通过 godex) minimax 可以正确处理:
- 发送 `type: "namespace"` 工具 (CodeX 实际格式) → minimax 正常调用 `mcp__server__tool({a:2,b:3})`
- 发送 `function_call` + `function_call_output` → minimax 正确返回最终答案
- **MCP 工具调用链路完全工作**,不需要 bridge 特殊处理

### 部署
- 编译: `bun run build` (700ms)
- 部署: `bin/godex.exe` (新二进制 14:04:47 部署, 旧版备份到 `bin/godex.exe.bak.20260703_140454`)
- 用户已重启 godex 服务验证
