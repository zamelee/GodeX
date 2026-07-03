

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
