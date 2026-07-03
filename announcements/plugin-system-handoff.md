# Handoff: Godex Plugin System + Studio (Layer by Layer)

> 给 godex 加 4 个 hook 扩展点（~100 行），studio/ 写 1000+ 行 model-specific 逻辑。
> 核心理念：godex 留洞，studio 塞工具，godex 怎么升级都不影响 studio 干活。

---

## 0. 当前快照

- **Branch**: `codex/fix-minimax-tool-call-arguments`
- **HEAD**: `672c255 docs(handoff): document plugin system + studio plan`
- **备份 tag**: `pre-studio-backup` → `7c8315b` (远端 fork 已同步)
- **回退方法**: `git reset --hard pre-studio-backup` 或 `git checkout pre-studio-backup -b recovery`

### 最近 6 个 fix commit（已全部推 fork）
```
672c255 docs(handoff): document plugin system + studio plan
7c8315b checkpoint: pre-studio/plugin-system work          ← 备份点
cf34d49 fix(bridge): hoist media user messages out of parallel tool result runs
b2725b6 fix(bridge): split image-bearing tool outputs into tool + user messages
1b73dcb fix(stream): drop null tool call fields from Chat Completions deltas
e3066a7 fix(minimax): coerce empty tool call arguments to empty object literal
147ee7c fix(minimax): sanitize tool call arguments and pair-check session history
```

---

## 1. 背景：为什么需要 plugin 系统

### 1.1 godex 现在的核心职责
```
Codex (OpenAI Responses API)
        ↓                                ↑
   /v1/responses POST              SSE (Responses events)
        ↓                                ↑
┌───────────────────────────────────────────────────┐
│  godex bridge kernel                              │
│  Responses input → Chat Completions messages      │
│  Chat Completions response → Responses output     │
└───────────────────────────────────────────────────┘
        ↓                                ↑
   Chat Completions POST              SSE (Chat chunks)
        ↓                                ↑
   Provider (MiniMax / DeepSeek / OpenAI / ...)
```

godex 本职工作是**协议转换器**：Chat Completions ↔ Responses API。

### 1.2 痛点：provider 怪癖导致 godex 被污染
之前 5 个 fix 全部是 MiniMax 的怪癖处理：
| 怪癖 | 涉及文件 | 影响范围 |
|------|----------|---------|
| tool args 非 canonical JSON | `minimax/hooks.ts` + `shared/tool-arguments.ts` | 请求构建 |
| 空字符串 args 拒绝 | `tool-arguments.ts` `canonicalizeFunctionArguments("")` → `"{}"` | 请求构建 |
| tool output 含 image | `input-normalizer.ts` `outputText` 拆分 | 归一化 |
| 并行 tool call 中插 image | `request-builder.ts` `reorderToolMediaMessages` | 归一化 |
| 流式续传 `id: null` | `shared/stream-delta-mapper.ts` `!= null` 过滤 | 流处理 |

**问题**：这些逻辑都 hardcode 在 godex 主仓里。每次发现新怪癖 → 改 godex → 编译 → 推 PR。godex 越来越胖，越来越绑死 MiniMax。

### 1.3 三种方案对比（已讨论选定 C）

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| A. 只做 profile 注入参数 | 简单、godex 一行不改 | 解决不了结构性怪癖（image 拆分、message 数组重排） | ❌ |
| B. studio 是 godex fork | 彻底解耦 | 两个 godex 版本同步噩梦 | ❌ |
| **C. godex 加 hook 基础设施，studio 写实现** | **godex 升级不影响 studio，每个 provider 独立 plugin** | **godex 多 100 行** | **✅** |

### 1.4 选 C 的关键洞察
- **"profile 注入参数"只能解决表层**：temperature、top_p、max_tokens、reasoning_effort
- **结构性怪癖需要 hook 改 message 数组或 SSE 事件序列**：image 拆分、reorder、null 过滤、reasoning 提取
- **proxy 方案做不了结构性修改**：proxy 改的是 request top-level 字段，动不了 messages 数组内部
- **fork 方案是过度工程**：维护两个 godex 版本
- **hook 方案是甜区**：godex 主体加 4 个洞，studio 写工具，干活分离

---

## 2. 架构：4 个 hook 点 + 完整数据流

### 2.1 数据流图（含 4 个 hook）

```
Codex (Responses API)
  │ POST /v1/responses {model: "godex/m3", input: [...]}
  ▼
┌──────────────────────────────────────────────────────────────┐
│  godex (协议转换器)                                          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 1. 路由层（godex 核心）                                 │  │
│  │    model: "godex/m3" → alias 表                        │  │
│  │    → {provider: minimax, model: MiniMax-M3}            │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 2. 能力检查层（godex 核心）                             │  │
│  │    M3 capabilities: text ✓ image ✓ video ✓ audio ✗    │  │
│  │    Codex input: [text, image, audio]                   │  │
│  │    → audio 被按 capability 拒绝                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 3. 归一化层 Responses input → Chat messages (核心)     │  │
│  │    系统消息、user/tool/assistant 角色转换               │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                  │
│  ╔════════════════════════════════════════════════════════╗  │
│  ║ 4. [Hook A] transformChatMessages   ← studio 挂       ║  │
│  ║    in:  ChatMessage[] + {model, provider}              ║  │
│  ║    out: ChatMessage[] (改 message 数组结构)            ║  │
│  ║    用途: image 拆分、parallel reorder、orphan drop     ║  │
│  ╚════════════════════════════════════════════════════════╝  │
│                           │                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 5. 构建 Chat Completions request body (核心)            │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                  │
│  ╔════════════════════════════════════════════════════════╗  │
│  ║ 6. [Hook B] patchRequest            ← studio 挂        ║  │
│  ║    in:  ChatRequest + {model}                          ║  │
│  ║    out: ChatRequest                                    ║  │
│  ║    用途: tool args canonicalize、空串→{}、其他字段变换 ║  │
│  ╚════════════════════════════════════════════════════════╝  │
│                           │                                  │
│  │ POST → Provider                                         │
│  ▼                                                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 7. provider 特殊处理（spec.hooks）                     │  │
│  │    minimax: reasoning_split / thinking 字段           │  │
│  │    deepseek/openai: 标准就行                           │  │
│  └────────────────────────────────────────────────────────┘  │
│  │ ◀──── SSE stream chunks                                 │
│  ╔════════════════════════════════════════════════════════╗  │
│  ║ 8. [Hook C] transformStreamDelta     ← studio 挂       ║  │
│  ║    in:  provider-specific delta + {model}              ║  │
│  ║    out: provider-specific delta (改字段/丢字段)        ║  │
│  ║    用途: null 过滤、reasoning_details 提取             ║  │
│  ╚════════════════════════════════════════════════════════╝  │
│  │                                                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 9. Responses 状态机重建事件 (核心)                      │  │
│  │    Chat chunks → Responses events                       │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                  │
│  ╔════════════════════════════════════════════════════════╗  │
│  ║ 10. [Hook D] transformResponseEvent  ← studio 挂       ║  │
│  ║     in:  ResponseStreamEvent + {model}                 ║  │
│  ║     out: ResponseStreamEvent (可选)                    ║  │
│  ║     用途: 事件级微调、错误注入                          ║  │
│  ╚════════════════════════════════════════════════════════╝  │
│                           │                                  │
│  │ SSE → Codex                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 hook 详细签名

```ts
// src/bridge/plugins.ts (新增)

export interface GodexPluginContext {
  readonly model: string;      // 解析后的实际 model 名，如 "MiniMax-M3"
  readonly provider: string;   // provider 名，如 "minimax"
  readonly alias?: string;     // 用户请求里的 alias 名（可选）
}

export interface GodexPluginHooks {
  // Hook A: 在归一化完成后、构建 Chat request 前调用
  // 改 ChatMessage[] 数组（image 拆分、reorder、orphan drop）
  transformChatMessages?: (
    messages: readonly ChatCompletionMessageParam[],
    ctx: GodexPluginContext
  ) => ChatCompletionMessageParam[] | Promise<ChatCompletionMessageParam[]>;

  // Hook B: Chat request 完成后、发送前调用
  // 改 request 字段（tool args canonicalize、空串→{}）
  patchRequest?: (
    request: ChatCompletionCreateRequest,
    ctx: GodexPluginContext
  ) => ChatCompletionCreateRequest | Promise<ChatCompletionCreateRequest>;

  // Hook C: provider SSE chunk 进来、map 到 Responses event 前
  // 改 provider-specific delta（null 过滤、reasoning 提取）
  transformStreamDelta?: (
    delta: unknown,
    ctx: GodexPluginContext
  ) => unknown | Promise<unknown>;

  // Hook D (可选): Responses event 构造完、推 SSE 前
  // 微调事件级行为
  transformResponseEvent?: (
    event: ResponseStreamEvent,
    ctx: GodexPluginContext
  ) => ResponseStreamEvent | Promise<ResponseStreamEvent>;
}

export interface GodexPlugin {
  readonly name: string;       // plugin 标识，用于日志
  readonly hooks: GodexPluginHooks;
}

export async function loadPlugins(paths: readonly string[]): Promise<GodexPlugin[]> {
  const plugins: GodexPlugin[] = [];
  for (const path of paths) {
    const mod = await import(/* @vite-ignore */ path);
    const plugin = mod.default ?? mod;
    if (plugin && typeof plugin === "object" && "hooks" in plugin) {
      plugins.push(plugin as GodexPlugin);
    } else {
      throw new Error(`Plugin ${path} did not export a GodexPlugin`);
    }
  }
  return plugins;
}
```

### 2.3 hook 覆盖范围

| Hook | 路由 | 能力检查 | 多模态 | Provider 差异 |
|------|------|----------|--------|---------------|
| A. transformChatMessages | | | ✅ | ✅ |
| B. patchRequest | | | | ✅ |
| C. transformStreamDelta | | | | ✅ |
| D. transformResponseEvent | | | | ✅ |

**不在 plugin 范围**：路由（godex 核心）、能力检查（godex 核心）、session 持久化、trace 记录、SSE 编码。

### 2.4 多个 plugin 协作
- 数组顺序执行：每个 plugin 拿上一个的输出
- 同一个 hook 在不同 plugin 里叠加（流水线）
- 一个 plugin 抛异常 → 整个请求失败（不静默降级）

### 2.5 plugin 与 provider spec hook 的顺序
- spec.hooks.patchRequest（provider 自带，如 minimax）**先**执行
- plugin.hooks.patchRequest **后**执行（plugin 可覆盖 provider 默认行为）
- 这让 plugin 能"包装"provider 的默认行为

---

## 3. Provider 行为矩阵

不同 provider 需要不同的 plugin 处理：

| Provider | 跟 OpenAI 差异 | 需要 plugin hook？ | 备注 |
|----------|---------------|------------------|------|
| **OpenAI** | 参考实现 | ❌ 不需要 | 零配置 |
| **DeepSeek** | 高度兼容 | ❌ 通常不需要 | 偶尔有 reason 字段差异 |
| **智谱 (zhipu)** | 高度兼容 | ❌ 通常不需要 | tool_call id 可能 null |
| **MiniMax** | Chat Completions 兼容但有怪癖 | ✅ **必需要** | image 拆分、reorder、null 过滤、reasoning |
| **Ollama (兼容模式)** | 看具体模型 | ⚠️ 按需 | 视觉模型可能需要 |
| **Anthropic** | **不兼容** (Messages API) | 🚧 要新写 bridge | 未来大工程 |
| **Gemini** | **不兼容** | 🚧 同上 | 未来大工程 |

**结论**：plugin 不是"所有 provider 都需要"，是"有怪癖的 provider 才挂"。GPT/DeepSeek 零配置，MiniMax 必挂。

---

## 4. 4 个 Layer 的详细计划

### Layer 1：Plugin System (godex 100 行)

**目标**：在 godex 挖 4 个洞，能 import 一个空 plugin 跑通。

**新文件**：
- `src/bridge/plugins.ts` (~50 行): GodexPlugin 类型 + loadPlugins()

**修改文件**：
- `src/bridge/request/request-builder.ts` (+15 行): 在 chatMessages() 末尾调用 plugin transformChatMessages
- `src/providers/shared/stream-delta-mapper.ts` (+15 行): 在 mapCommonChatStreamDelta 前面调用 plugin transformStreamDelta
- `src/bridge/provider-spec/factory.ts` (+10 行): 在 spec.hooks.patchRequest 之后调用 plugin patchRequest
- `src/responses/stream-pipeline.ts` (+10 行): 在 SSE 编码前调用 plugin transformResponseEvent
- `src/config/sections/providers.ts` (+10 行): 读 plugins 字段
- `src/context/application-services.ts` (+10 行): 启动时 loadPlugins

**测试**：
- `src/bridge/plugins.test.ts` (新): loadPlugins 解析 / plugin hook 调用链 / 错误传播

**总计**: ~110 行新增，0 行删除

**退出条件**:
1. `bun run typecheck` 通过
2. `bun run check` 通过
3. 编写一个测试 plugin（空 hooks）能成功被 godex 加载
4. godex 启动时 config.yaml 有 `plugins: [...]` 不报错

**风险**:
- 动态 import 路径解析（用绝对路径避免相对路径问题）
- 错误传播（plugin 异常不能被吞）

### Layer 2：Studio 骨架

**目标**：独立子项目，能导出 GodexPlugin 默认值（pass-through）。

**目录结构**:
```
D:\Documents\VibeCoding\GodeX\studio\
├── package.json                # 独立 bun project
├── tsconfig.json               # 继承 godex 的 strict
├── README.md
├── src/
│   ├── plugin.ts               # GodexPlugin 默认导出
│   ├── hooks/                  # 占位目录
│   ├── profiles/               # 占位目录
│   ├── server/                 # 占位目录
│   └── public/                 # 占位目录
└── profiles.yaml               # 占位空文件
```

**package.json**:
```json
{
  "name": "@zamelee/godex-studio",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "bun build src/plugin.ts --outdir dist --target bun"
  },
  "devDependencies": {
    "typescript": "^5"
  }
}
```

**plugin.ts**:
```ts
import type { GodexPlugin } from "../godex/src/bridge/plugins";

const plugin: GodexPlugin = {
  name: "studio",
  hooks: {
    // Layer 3 之前都是 pass-through
  },
};

export default plugin;
```

**退出条件**:
1. `bun run build` 在 studio/ 产出 dist/plugin.js
2. godex config.yaml 加 `plugins: ["./studio/dist/plugin.js"]` 启动成功
3. 跑通一次简单 chat（无怪癖 model 走 godex 原生路径）

### Layer 3：迁移 MiniMax 怪癖到 Studio

**目标**：把当前 fix 分支的 minimax-specific 逻辑搬到 studio。godex 退回通用 Chat Completions 透传。

**搬迁映射**:
| 当前位置（godex） | 目标位置（studio） | hook |
|-------------------|-------------------|------|
| `src/providers/minimax/hooks.ts` `canonicalizeMessageToolArguments` | `studio/src/hooks/messages.ts` `transformChatMessages` | A |
| `src/providers/shared/tool-arguments.ts` `canonicalizeFunctionArguments` / `isValidFunctionArguments` | `studio/src/hooks/args.ts` | A |
| `src/bridge/request/input-normalizer.ts` `outputText` 强制 `supportsImageInput: false` | `studio/src/hooks/messages.ts`（不强制，交给 A 处理） | A |
| `src/bridge/request/input-normalizer.ts` `toolExtrasUserMessage` 拆分逻辑 | `studio/src/hooks/messages.ts` `splitToolOutputMedia` | A |
| `src/bridge/request/request-builder.ts` `reorderToolMediaMessages` | `studio/src/hooks/messages.ts` `reorderToolMediaMessages` | A |
| `src/providers/shared/stream-delta-mapper.ts` `!= null` 过滤 | `studio/src/hooks/stream.ts` `transformStreamDelta` | C |
| `src/providers/minimax/hooks.ts` `minimaxPatchRequest` | `studio/src/hooks/request.ts` `patchRequest` | B |

**改动量**: 1000+ 行新增到 studio
**godex 改动**: 删除（不是新增）上述 hardcode 逻辑

**回归测试**:
- 用 trace.db 里 6 个错误 request 的 payload 作为 fixture
- 跑完整测试套件
- 用户手动验证：图片工具调用、并行 tool call、空 args

**退出条件**:
1. studio plugin 重新实现所有 5 个 minimax 怪癖的修复
2. godex 主仓移除对应 hardcode
3. 全部 unit test 通过
4. Codex 端手动验证 trace.db 里的 6 类错误场景不再出现

### Layer 4：Studio UI

**目标**：可视化配置界面。

**布局**:
```
┌──────────────────────────────────────────────────────────┐
│ Provider    │ Models                │ Model Details        │
│ minimax  ▾  │ ● M3    192k ctx  ✓active│ Context:  192,000   │
│             │ ○ M2.7  128k ctx        │ Max out:   16,384   │
│             │ ○ custom…            │ Supports: tools,vision│
│             │                       │                       │
│             │                       │ Params                │
│             │                       │ temp:    [0.7    ]   │
│             │                       │ max_out: [16384   ]  │
│             │                       │ top_p:   [1.0    ]   │
│             │                       │                       │
│             │                       │ History est: ~45k tok │
│             │                       │ ⚠ Fits in M2.7       │
├─────────────┴───────────────────────┴──────────────────────┤
│ [Apply & Reload]   [Revert]   Active: M3 (192k ctx)        │
├──────────────────────────────────────────────────────────┤
│ Logs (复用 godex trace.db)                                │
└──────────────────────────────────────────────────────────┘
```

**左中右三栏职责**:
- **左 Provider**: 下拉选择 provider（先只 minimax，预留多 provider）
- **中 Models**: 该 provider 的 model 列表，多选（☑ 启用 / ☐ 禁用），可自定义添加
- **右 Model Details**: 选中 model 的能力（只读）+ 参数（可编辑）

**底部 Logs**: 直接读 godex 的 trace.db，复用

**后端 (studio/server.ts)**:
- 5679 端口（与 godex 5678 区分）
- 静态 HTML/JS
- `/api/config` GET/POST: 读/写 godex config.yaml
- `/api/profiles` GET/POST: 读/写 studio profiles.yaml
- `/api/logs`: 读 godex trace.db

**改 godex config**:
- studio 通过 file system 直接编辑 config.yaml
- godex 需要 file watching 重新加载（或 studio 重启 godex）

**改 godex trace.db**:
- studio 用 bun:sqlite 只读打开 `C:\Users\Bliss\.godex\data\trace.db`
- 暴露给前端 SSE 或轮询

---

## 5. Studio 详细结构

### 5.1 profiles.yaml（UI 自己的，不在 godex config 里）

```yaml
# 每 model 一套参数预设
models:
  MiniMax-M3:
    label: "M3 (主力)"
    context_window: 192000        # 用于切 model 警告
    max_output: 16384
    supports:                     # 从 provider API 拉
      - text
      - image
      - video
      - tools
      - reasoning
    defaults:                     # 自动选（按 model 名）
      temperature: 0.7
      top_p: 1.0
      max_output_tokens: 16384
      stream: true
    overrides:                    # 手动微调（用户在 UI 上改的）
      temperature: 0.5
  MiniMax-M2.7:
    label: "M2.7 (试水)"
    context_window: 128000
    max_output: 8192
    supports: [text, image, tools, reasoning]
    defaults:
      temperature: 0.5
      max_output_tokens: 8192
```

**逻辑**:
- 启动时读 `defaults`
- 用户在 UI 改参数 → 写到 `overrides`
- 请求来了 → plugin 查 `overrides || defaults` 注入

### 5.2 studio 目录最终形态

```
studio/
├── package.json
├── tsconfig.json
├── README.md
├── profiles.yaml                          # model 参数预设
├── src/
│   ├── plugin.ts                          # GodexPlugin 默认导出
│   ├── hooks/
│   │   ├── args.ts                        # tool args canonicalize
│   │   ├── messages.ts                    # transformChatMessages
│   │   │                                 # - image 拆分
│   │   │                                 # - parallel reorder
│   │   │                                 # - orphan drop
│   │   ├── request.ts                     # patchRequest
│   │   └── stream.ts                      # transformStreamDelta
│   │                                     # - null 过滤
│   │                                     # - reasoning_details 提取
│   ├── profiles/
│   │   ├── loader.ts                      # 读 profiles.yaml
│   │   ├── applier.ts                     # 注入参数到 request
│   │   └── types.ts
│   ├── tokens/
│   │   └── estimator.ts                   # 历史 token 估算
│   ├── server/                            # UI 服务
│   │   ├── index.ts                       # Bun.serve
│   │   ├── routes/
│   │   │   ├── config.ts                  # /api/config
│   │   │   ├── profiles.ts                # /api/profiles
│   │   │   ├── logs.ts                    # /api/logs
│   │   │   └── models.ts                  # /api/models
│   │   └── proxy.ts                       # Codex → studio → godex
│   └── public/
│       ├── index.html                     # 三栏布局
│       ├── app.js
│       └── style.css
└── dist/                                  # build 产物
    └── plugin.js                          # godex import 这个
```

---

## 6. Codex → Studio → Godex 联通设计

### 6.1 三个进程的职责
- **Codex**: 客户端，发 Requests API 请求
- **Studio (5679)**: UI + model profile 注入层（可选，作为 proxy）
- **Godex (5678)**: 协议转换器（本职）

### 6.2 两条路径

**路径 A (推荐)**: Codex → Godex (in-process plugin)
```
Codex → godex:5678
           │
           ├─ godex 内部 import studio plugin
           ├─ request-builder 调用 plugin.transformChatMessages
           ├─ factory 调用 plugin.patchRequest
           └─ stream 调用 plugin.transformStreamDelta
```
- 优点: 单进程，无网络跳转，性能最好
- 缺点: 改 plugin 要重启 godex

**路径 B (可选)**: Codex → Studio → Godex (proxy)
```
Codex → studio:5679 → godex:5678
           │
           ├─ studio 读 profiles
           ├─ studio 注入参数
           └─ studio 转发给 godex
```
- 优点: 改 profile 不重启 godex
- 缺点: 多一跳网络，性能差一点

**Layer 4 实现路径 A**（更简单）。路径 B 留作可选增强。

### 6.3 Codex 端配置
不管 A 还是 B，Codex 端 base_url 都是 `http://127.0.0.1:5678/v1`（走 A）或 `http://127.0.0.1:5679/v1`（走 B）。

**alias 策略**:
```yaml
models:
  aliases:
    "godex/m3":        minimax/MiniMax-M3
    "godex/m27":       minimax/MiniMax-M2.7
    "openai/gpt-4":    openai/gpt-4
    "deepseek/coder":  deepseek/deepseek-coder
    "*":               minimax/MiniMax-M3
```

Codex 选哪个 alias，godex 就路由到对应 provider/model。

---

## 7. 切 Model 警告（选项 2 实现）

**目标**: 切 model 之前估算历史 token，超出目标 model context window 时弹警告。

**实现位置**: `studio/src/tokens/estimator.ts`

**估算方法**:
- 读 `trace.db` 的 `trace_usage` 表（godex 记的 `prompt_tokens`）
- 最近一次请求的 `prompt_tokens` ≈ 当前会话历史
- 如果 trace.db 不够全，fallback: 按 message 字符数 / 3 估算

**触发时机**:
- UI 上点 "Apply & Reload" 切换 model 时
- 调用 studio `/api/profiles` 验证当前历史能否塞进目标 model
- 返回 warning 给前端

**弹窗内容**:
```
⚠ Context 警告
当前会话历史约 ~45,000 tokens
目标 model M2.7 窗口 128,000 tokens
✅ 装得下，可以切换

或:
❌ 历史 ~250k tokens 超过 M2.7 窗口 128k
建议：① 开新会话 ② 保留 M3 ③ 切回更大的 model
```

---

## 8. 风险与边界

### 8.1 风险清单

| 风险 | 影响 | 缓解 |
|------|------|------|
| plugin 加载失败 | godex 启动失败 | try-catch，fail fast 报错 |
| plugin 抛异常 | 单次请求失败 | 错误传播给 caller，不静默 |
| 动态 import 路径 | 相对路径解析 | 用绝对路径 |
| plugin hot reload | 复杂 | 暂不支持，提示用户重启 godex |
| studio 编译失败 | godex 启动失败 | studio 单独的 build 流水线 |
| trace.db 被 godex 锁定 | studio 读不到 | 只读模式打开，retry 机制 |
| 多 plugin 顺序冲突 | 行为不可预期 | 文档约定：plugin 自己 if/else model，顺序无关 |

### 8.2 边界（plugin 做不到的）
- ❌ 路由 (godex 核心)
- ❌ 能力检查 (godex 核心)
- ❌ session 持久化 (godex 核心)
- ❌ trace 记录 (godex 核心)
- ❌ SSE 编码 (godex 核心)
- ❌ provider spec 自带 hook (minimax/deepseek/zhipu 各家的硬逻辑)

### 8.3 升级策略
- godex 主版本升 → studio 不动（因为 plugin 类型稳定）
- studio 加新 model 处理 → godex 不动
- 两者通过 GodexPlugin interface 解耦

---

## 9. 关键决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| hook 数量 | 4 个 (A/B/C/D) | 覆盖 4 个数据流关键点 |
| 加载方式 | 动态 `import()` 路径 | 比 npm 包名灵活 |
| 失败处理 | 抛异常，godex 报错 | 不静默降级，避免怪异 bug |
| 多 plugin | 数组顺序 | 简单，可扩展 |
| 优先级 | plugin 在 spec hook 之后 | plugin 能覆盖 provider 行为 |
| 路由 | alias 表 | godex 已有 |
| per-model 分支 | plugin 内部 if/else ctx.model | 简单，将来升级 profile lookup |
| file 监控 | studio 写 yaml，godex 重启加载 | Layer 1 简单实现 |
| trace 复用 | studio 只读 trace.db | 不动 godex |
| UI port | 5679 (区别 godex 5678) | 独立进程 |
| Studio 路径 | 选 A (in-process plugin) | 简单高性能 |

---

## 10. 实施时间表（估算）

| Layer | 估时 | 累计 |
|-------|------|------|
| Layer 1 (plugin system) | 2-3 小时 | 3h |
| Layer 2 (studio 骨架) | 1 小时 | 4h |
| Layer 3 (迁移 minimax 怪癖) | 4-5 小时 | 9h |
| Layer 4 (UI) | 4-5 小时 | 14h |
| 联调+回归 | 2 小时 | 16h |

---

## 11. 用户偏好（重要，必读）

- 之前每一轮 fix 形成的命名习惯：`pre-pr-checkpoint` tag 作为安全网
- **godex.exe 和 godex2.exe 交替构建，不同时重建**（用户明确说过"以后记住了"）
- 不自动发 PR，需要时手动
- 改动只 stage 有意文件，CRLF 噪音忽略
- 每次重要修复后更新 `announcements/v1.0.1-fix.md`
- AGENTS.md 严格遵守
- 不破坏现有 fix 工作流
- 用大白话解释（用户原话）

---

## 12. 文件 / 命令速查

### 12.1 当前 exe 状态
- `platforms/win32-x64/bin/godex.exe` (运行中 / 运行过)
- `platforms/win32-x64/bin/godex2.exe` (备份)
- 用户的两个 config:
  - `C:\Users\Bliss\.godex\config.yaml` (minnimax.chat)
  - `D:\Documents\VibeCoding\GodeX\platforms\win32-x64\bin\极速API\config.yaml` (new.x5m5x.com)

### 12.2 构建命令
```powershell
$env:PATH = "$env:USERPROFILE\.bun\bin;$env:PATH"
& "$env:USERPROFILE\.bun\bin\bun.exe" build --compile --define 'GODEX_BUILD_ENV="prod"' --target=bun-windows-x64 src/index.ts --outfile platforms/win32-x64/bin/godex2.exe
```

### 12.3 关键 commit 历史
- `7c8315b` checkpoint (备份点)
- `cf34d49` reorder fix
- `b2725b6` image split fix
- `1b73dcb` stream null fix
- `e3066a7` empty args → {} fix
- `147ee7c` original tool args canonicalize fix

### 12.4 文档归档
- `announcements/v1.0.1-fix.md`: 5 个 fix 的 release notes
- `announcements/plugin-system-handoff.md`: 本文档

---

## 13. 待你确认

1. 这份 handoff 详细度够了吗？
2. 现在开 Layer 1 吗？
3. 分支名 `codex/plugin-system` 同意吗？
4. 回退点用 `pre-studio-backup` tag 可以吗？
