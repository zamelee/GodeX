# GodeX Studio: Discovered 持久化 + 预设派生 /v1/models 字段

> 2026-06-24 · branch `godex/studio-tauri` · 配合 godex 端 a35e658(`feat(models): Codex++ compatibility + strict resolver + preset-driven fields`)

---

## 1. 背景

之前 GodeX Studio 跟 GodeX、Codex++、Codex 在 `config.yaml` 的模型管理上各自为政,有几个具体痛点:

| 痛点 | 旧行为 | 用户期望 |
|---|---|---|
| 用户取消勾选一个拉来的模型 | 它从 UI 列表里消失,下次再拉又会冒出来 | 取消的应该"记住",不再出现在 enabled 里 |
| 取消后再拉一次上游 | 已取消的又会以全新行写入 `models.enabled[]` | 重复的别写第二遍 |
| 用户手动改过 `context_window` | 拉上游时直接被覆盖 | 用户改过的版本要保留 |
| `/v1/models` 缺少 Codex++ 想要的字段 | 只有 `id` | 还要 `name` / `context_window` / `max_tokens` / `input_modalities` |
| Studio 不知道哪些字段是"预设" | 任何字段改动都看不出是不是用户编辑过 | 拉上游时知道哪些是 preset 默认值,哪些是用户改的 |

---

## 2. 设计决策(用户已确认)

### 2.1 `discovered` 段

在 `config.yaml` 的 `models:` 下新增 `discovered:` 段,跟 `enabled:` 平级但语义不同:

```yaml
models:
  enabled:        # Studio 启用(被 Codex 看到的模型)
    - provider: minimax
      model: M2.7
      id: "minimax/MiniMax-M2.7"
      context_window: 204800
      max_tokens: 8192
      capabilities: { text: true, image_input: true, tool_use: true, stream: true }
  discovered:     # Studio 持久化"已见过但没启用"的模型(Studio-only,不被 Codex 看到)
    - provider: minimax
      model: M3-Plus
      id: "minimax/MiniMax-M3-Plus"
      context_window: 256000
      max_tokens: 16384
```

**关键不变量**:

1. `discovered` 是 **Studio-only** 字段。GodeX 端不读、不写、不透传(避免污染 godex 端 schema)。
2. GodeX 仍然只暴露 `models.enabled[]` 给 `/v1/models`。
3. 取消勾选 = `enabled[]` 删除 + `discovered[]` 新增(参数保留,持久化)。
4. 再次勾选 = `discovered[]` 删除 + `enabled[]` 新增(回流动,无副作用)。
5. 拉上游时,对于同 `provider/model`,按"参数完全一样才跳过"去重:
   - `enabled[]` 里已存在 → 跳过(不动)
   - `discovered[]` 里已存在 + 参数跟 remote 一模一样 → 跳过(不动)
   - `discovered[]` 里已存在 + 参数不同(用户改过 context_window / max_tokens / multimodal / capabilities / note) → **保留用户版本**,跳过 remote
   - `enabled` 和 `discovered` 都没有 → 加进 `enabled[]`(保持跟旧行为一致:新拉到的默认进 enabled)

### 2.2 拉取顺序与渲染顺序

- 拉取去重在 `fetchRemoteModels` 命令里完成(Rust 端或 JS 端均可,当前在 JS 端做)。
- UI 渲染合并 `enabled` + `discovered`,**不按 enabled/disabled 分组**(用户操作时会跳来跳去,分组排序反而碍事)。
- 取消勾选的行在 UI 上灰显 + 标记 `已禁用` tag,方便区分。

### 2.3 preset 派生 `/v1/models` 字段

`/v1/models` 现在的字段来自两个地方:

| 字段 | 来源 |
|---|---|
| `id` | 上游 `/v1/models` 返回的 |
| `slug`, `display_name` | 从 id 派生 |
| `name` | preset 匹配(`src/config/model-presets/index.ts` 的 `match_preset()`) |
| `context_window`, `max_tokens` | preset 匹配 |
| `description` (= preset.notes) | preset 匹配 |
| `input_modalities` | 从 preset.multimodal 派生 `[text, image?, audio?, video?]` |
| `capabilities`, `multimodal`, `note` | 用户在 Studio 编辑过的(可能跟 preset 不一样) |

**关键点**: `name` / `context_window` / `max_tokens` / `description` / `input_modalities` 这 5 个是 **Studio 端 fetch 时** 从 preset 现算的,不是存进 config 的。这样:
- GodeX 端 schema 不用动(它本来就不管这些字段)
- preset 升级时所有用户自动拿到新值
- 用户在 Studio 编辑过的值仍以 enabled[] 里的 `context_window` / `max_tokens` 形式覆盖(Studio 优先)

---

## 3. 改动文件清单

### 3.1 提交的文件(本次 commit)

| 文件 | 改动 |
|---|---|
| `studio-tauri/src-tauri/src/config.rs` | `EnabledModel` 加 `id: Option<String>`;`read_discovered_models()` 新增;`render_discovered_block()` 新增;`save_enabled_models()` 签名加 `discovered: &[EnabledModel]` |
| `studio-tauri/src-tauri/src/commands.rs` | `EnabledModelsResponse { enabled, discovered }` 新增;`read_enabled_models` 返回该 struct;`save_enabled_models` 加 `discovered` 参数;`RemoteModel` 加 `name` / `description` / `input_modalities` / `context_window` / `max_tokens` 5 字段;`fetch_remote_models` 用 `load_preset_file` + `match_preset` 派生 |
| `studio-tauri/src/index.html` | `let discovered = []` 全局;`selectProvider` 重置;`loadEnabledForCurrent` 读 `all.enabled` + `all.discovered`;`saveEnabled` 写两边;`fetchRemoteModels` 走新合并去重;`toggleModel` 跨 enabled↔discovered 移动;`removeModel` 两边都查;`renderModels` 用 `mid` 引用 + 灰显 + backtick 模板(修了 5 处字符串拼接 bug) |

### 3.2 不在本次 commit 的改动(working tree 留底)

| 文件 | 状态 | 原因 |
|---|---|---|
| `studio-tauri/src-tauri/src/state.rs` | 1 行真实改动 + 234 行 CRLF/LF 噪音 | HEAD 里 state.rs 是 CRLF,`.gitattributes` 强制 LF(但 .gitattributes 是 untracked,git 不强制 normalize),导致整文件 diff 噪音。本规则由之前对话明确"那两个 CRLF 噪音 modified 不动"。**1 行真实改动是 `godex2.exe` → `godex.exe` 的 fallback binary 路径修正**。 |
| `studio-tauri/src-tauri/capabilities/main.json` | 末尾空行 CRLF 噪音 | 同上,无实际内容变化 |

> 这两个文件等下一次单独开一个 `chore: normalize state.rs to LF` commit 一起处理。

### 3.3 不在 working tree 的文件

- `godex` 端 9 个文件改动 — 已经在 a35e658 commit 进去,本次不动
- `godex` 端 `EnabledModel`(同名不同模块)— 不同 crate,不冲突
- 旧 `studio/` (Bun + WebView2) — 已废弃,无影响

---

## 4. 行为细节

### 4.1 toggleModel 行为矩阵

| 起点 | 终点 | 操作 | 结果 |
|---|---|---|---|
| 不在 enabled,不在 discovered | 用户勾选 | toggle | 加进 enabled |
| 在 enabled | 用户取消勾选 | toggle | 移到 discovered(保留参数) |
| 在 discovered | 用户勾选 | toggle | 移到 enabled(保留参数) |
| 在 discovered | 用户点"删除" | removeModel | 从 discovered 删除(永久消失) |
| 在 enabled | 用户点"删除" | removeModel | 从 enabled 删除(不写 discovered) |

### 4.2 setModelParam / setModelCap 行为

- 改 enabled 行的 context_window → 写回 enabled 那条记录
- 改 discovered 行的 context_window → 写回 discovered 那条记录
- 跟 enabled/discovered 状态无关,改的是"当前行所在列表"

### 4.3 去重函数 `rowEqualsRemote(row, remote)`

```js
function rowEqualsRemote(row, remote) {
  if (row.context_window !== (remote.context_window ?? null)) return false;
  if (row.max_tokens !== (remote.max_tokens ?? null)) return false;
  if ((row.multimodal ?? false) !== remoteHasImageModality(remote)) return false;
  if (capText(row) !== remoteHasText(remote)) return false;
  if ((row.note ?? "") !== (remote.description ?? "")) return false;
  return true;
}
```

任何字段不一致都算"用户编辑过",保留 row 跳过 remote。

---

## 5. 兼容性

| 组件 | 影响 |
|---|---|
| **godex** | 0 改动。它读 `models.enabled[]` 输出 `/v1/models`,跟以前一样。`discovered` 段对它透明。 |
| **Codex** | 0 改动。`/v1/models` 多了 5 个字段都是可选的(`#[serde(skip_serializing_if = "Option::is_none")]`),Codex 读不到就当 null。 |
| **Codex++** | 0 改动,但**获益**。`name` / `context_window` / `max_tokens` 字段现在能在 Codex++ UI 显示。`input_modalities` 暂时是 Tauri 端字段,Codex++ 用不到也没影响。 |
| **config.yaml 旧文件** | 向后兼容。`read_discovered_models` 在没有 `discovered:` 段时返回空 Vec。`render_discovered_block` 在空列表时输出 `discovered: []`,保证下次保存时显式写出该段。 |
| **godex-studio.exe 老 binary** | 不影响。它的 read 路径只找 `enabled:`,新增 `discovered:` 段会被忽略,继续工作。 |

---

## 6. 验证步骤

### 6.1 Rust 后端
```bash
cd D:\Documents\VibeCoding\GodeX\studio-tauri\src-tauri
cargo check --message-format=short
```

### 6.2 JS 语法
```bash
node -e "const s=require('fs').readFileSync('D:/Documents/VibeCoding/GodeX/studio-tauri/src/index.html','utf-8'); const m=s.match(/<script>([\s\S]+?)<\/script>/); try{new Function(m[1]); console.log('JS OK');}catch(e){console.log('Error:',e.message);}"
```

### 6.3 端到端(手动)
1. 启动新 `godex-studio-20260624-0751.exe`
2. 切到 minimax provider
3. 点"拉取上游" → enabled 增加 N 个模型(M2.7 等)
4. 取消勾选其中 1 个 → enabled 减 1,discovered 增 1,UI 灰显 + `已禁用` tag
5. 关 Studio → 重开 → 重新选 minimax → enabled + discovered 都正确加载
6. 再点"拉取上游" → 不重复(那个取消的仍在 discovered,且 enabled 没被覆盖)
7. 在 discovered 行改 `context_window`(用户编辑) → 拉一次 → 那行参数没被覆盖
8. 看 `config.yaml` → 出现 `models.discovered:` 段
9. `godex.exe` 重启 → `curl http://127.0.0.1:5678/v1/models` → 仍然只输出 enabled 的模型(`discovered` 不透传)

### 6.4 Codex++ 端
1. Codex++ 用 base_url `http://127.0.0.1:57321/v1`(或 5678)拉模型 → 看到 `name` / `context_window` / `max_tokens` 字段
2. 用 `gpt-5.4` 这种不存在的 id → 报错信息应包含真实 model 名(来自 a35e658 的 chat-provider-client 改动)

---

## 7. 已知限制 / 后续 TODO

- [ ] `state.rs` 那 1 行真实改动 (`godex2.exe` → `godex.exe` 的 fallback 路径) 仍在 working tree,等下次 `chore: normalize to LF` commit
- [ ] `capabilities/main.json` 末尾空行 CRLF 噪音同上
- [ ] `discovered` 段在 `config.yaml` 里只在 Studio 编辑过才显式写;首次装新 binary + 旧 config 时不会自动建该段(只在 saveEnabled 时建) — 行为正确但要注意:Studio 启动时 `discovered` 永远是空数组直到用户做一次 fetch + toggle
- [ ] `input_modalities` 字段是 Studio 内部用的,没透传到 `/v1/models` 给 Codex++ 看到(目前 Codex++ 端没读这字段的需求;后续要看 Codex++ 端代码再决定要不要透传)
- [ ] `discovered` 段大小理论无上限,但 config.yaml 是手写 parser,模型很多时保存会比较慢(几百个 model 仍 < 50ms)

---

## 8. 部署产物

- 源码: `studio-tauri/src-tauri/target/release/godex-studio.exe` (6.55 MB, 2026-06-24 07:51)
- 部署副本: `platforms/win32-x64/bin/godex-studio-20260624-0751.exe`
- 备份: `studio-tauri/src-tauri/src/config.rs.bak-pre-a35e658-20260624-072309` (修复前快照,可删)
