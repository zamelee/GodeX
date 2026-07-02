# Handoff: Studio + Model-Probe 功能开发

> 生成时间: 2026-07-02
> 当前分支: codex/probe-live-cancel
> 远程: origin (只读), fork (可写)

## 状态总结

### 已完成功能
1. **probe_v4.py** - 混合探测脚本（LLM judge + code fallback）
2. **probe_v4_quick.py** - 快速版本（基于 v3，简单判断）
3. **probe_v3.py** - LLM-as-judge 版本
4. **Studio Tauri 命令** - probe_model, open_in_editor, launch_model_probe
5. **Studio Modal** - 探测结果 UI

### 已知问题
1. **6 个测试失败** - 这些是之前就存在的问题（provider-conformance, paths test, init wizard）
2. **API 不稳定** - MiniMax API 响应时间波动大（35-150s/模型）

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

## 红线维持
- 不动 Rust / godex2.exe / CodeX / Codex++
- 只改 Python 探测脚本和 Studio 前端
- 只推送到 fork (zamelee/GodeX)