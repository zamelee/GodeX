# Handoff: Godex Plugin System + Studio (Layer by Layer)

## 当前快照

- **Branch**: `codex/fix-minimax-tool-call-arguments`
- **HEAD**: `7c8315b checkpoint: pre-studio/plugin-system work` (在 cf34d49 之上)
- **Backup tag**: `pre-studio-backup` (指向 7c8315b, 远端 fork 已同步)
- **上游 fix 状态**: 5 个 fix commit 全部已推 fork

### 最近 5 个 fix commit
```
7c8315b checkpoint: pre-studio/plugin-system work          ← 备份点
cf34d49 fix(bridge): hoist media user messages out of parallel tool result runs
b2725b6 fix(bridge): split image-bearing tool outputs into tool + user messages
1b73dcb fix(stream): drop null tool call fields from Chat Completions deltas
e3066a7 fix(minimax): coerce empty tool call arguments to empty object literal
147ee7c fix(minimax): sanitize tool call arguments and pair-check session history
```

## 任务目标

给 godex 加 4 个 hook 扩展点（~100 行），studio/ 写 1000+ 行 model-specific 逻辑，让 godex 不被 MiniMax 怪癖绑定。

## 架构（已讨论确认）

- godex 在 4 个位置挖洞（plugin 扩展点）
- studio/ 是独立子项目，注册 GodexPlugin，提供 hook 实现
- godex 启动时通过 `config.plugins` 字段动态 `import()` studio
- Codex 端零改动，还是连 `http://127.0.0.1:5678/v1`
- 路由/能力/session/trace 仍归 godex 核心
- provider 怪癖 → 全部归 studio plugin hooks

## 4 个 Hook 点

| Hook | 触发位置 | godex 改动 | studio 写什么 |
|------|----------|-----------|-------------|
| `transformChatMessages` | input-normalizer 之后，构建 Chat request 前 | `request-builder.ts` +15 行 | image 拆分、parallel reorder、orphan drop |
| `patchRequest` | Chat request 完成后，发送前 | `provider-spec/factory.ts` +10 行 | tool args canonicalize、空串→{} |
| `transformStreamDelta` | provider SSE chunk 进来，map 前 | `stream-delta-mapper.ts` +15 行 | null 过滤、reasoning_details 提取 |
| `transformResponseEvent` | Responses event 构造完，推 SSE 前 | `stream-pipeline.ts` +10 行（可选） | 事件级调整 |

## 分层推进

### Layer 0：基础设施（前置）
- ✅ 已完成：godex 路由、alias、capability 声明、session、trace
- 新增：`config.plugins: string[]` 字段、`ApplicationContext.loadPlugins()`

### Layer 1：Plugin System (godex 100 行)
- **PR**: `codex/plugin-system`
- **新文件**:
  - `src/bridge/plugins.ts` (新, ~50 行)：GodexPlugin 类型 + loadPlugins()
- **修改**:
  - `src/bridge/request/request-builder.ts` (+15 行)：调用 transformChatMessages
  - `src/providers/shared/stream-delta-mapper.ts` (+15 行)：调用 transformStreamDelta
  - `src/bridge/provider-spec/factory.ts` (+10 行)：合并 plugin hook 到 patchRequest
  - `src/responses/stream-pipeline.ts` (+10 行，可选)：调用 transformResponseEvent
  - `src/config/sections/providers.ts` (+10 行)：读 plugins 字段
  - `src/context/application-services.ts` (+10 行)：启动时 load
- **测试**: 1-2 个 smoke test
- **总计**: ~100 行新增，0 行删除
- **退出条件**: godex 启动时能 `import()` 一个空 plugin 函数并调用，行为不变

### Layer 2：Studio 骨架
- **目录**: `D:\Documents\VibeCoding\GodeX\studio\`
- **package.json**: 独立 bun project，devDep 引 godex 源码 types
- **src/plugin.ts**: 导出 default GodexPlugin（先空实现，return 原值）
- **退出条件**: godex 配置 `plugins: ["./studio/dist/plugin.js"]` 能跑通

### Layer 3：迁移 MiniMax 怪癖到 Studio
- **目标**: 把 godex 当前 fix 分支里的 minimax-specific 逻辑搬到 studio
- **改动**:
  - `src/providers/minimax/hooks.ts` 里的 `canonicalizeMessageToolArguments` → `studio/src/hooks/messages.ts` 的 `transformChatMessages`
  - `src/bridge/request/input-normalizer.ts` 里的 image 拆分 → studio
  - `src/bridge/request/request-builder.ts` 里的 `reorderToolMediaMessages` → studio
  - `src/providers/shared/tool-arguments.ts` → studio
  - `src/providers/shared/stream-delta-mapper.ts` 里的 null 过滤 → studio
- **关键**: godex 退回到"通用 Chat Completions 透传"，所有 minimax 怪癖归 studio
- **回归测试**: 用 trace.db 跑之前所有 fix 的测试，确认无退化

### Layer 4：Studio UI（之前讨论的可视化界面）
- 左中右三栏
- 多 provider 预留（左侧）
- 多 model 多选（中间）
- 参数编辑（右侧）
- 切 model 警告
- 日志面板（复用 godex trace.db）

## 关键决策

1. **plugin 加载**: 动态 `import()` 路径，godex 启动时执行
2. **plugin 失败处理**: try-catch 包裹，plugin 抛异常 → godex 报错，不降级
3. **多 plugin**: 数组顺序执行，每个 plugin 拿上一个的输出
4. **plugin 优先级**: plugin hook 在 spec hook 之后执行（plugin 可覆盖 provider 默认行为）
5. **per-model 分支**: plugin 内部看 `ctx.model` 自己 if/else，将来可升级成"profile lookup"

## 用户偏好（重要）

- 之前每一轮 fix 形成的命名习惯：`pre-pr-checkpoint` tag 作为安全网
- godex.exe 和 godex2.exe 交替构建，不同时重建
- 不自动发 PR，需要时手动
- 改动只 stage 有意文件，CRLF 噪音忽略
- 每次重要修复后更新 `announcements/v1.0.1-fix.md`
- AGENTS.md 严格遵守
- **重要：之前明确说过"godex.exe 与 godex2.exe 不要两个都同时构建"**

## 待你确认

1. 这份 handoff 你认可吗？
2. Layer 1（plugin system）现在就开干吗？
3. 分支名 `codex/plugin-system` 可以吗？
4. 备份 tag `pre-studio-backup`（指向 7c8315b）当作回退点可以吗？

## 环境备注

- 本次会话中遇到 `.git/index.lock: Permission denied` 错误，是 .git 目录只读导致
- 解决办法：等权限恢复后 commit（已恢复）
- 工作树有 368 个"modified"假阳性，实际内容跟 HEAD 一致（git stat 缓存问题）
- 网络偶发阻断 github.com:443，git push 偶尔需要重试
