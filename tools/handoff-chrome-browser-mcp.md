# Handoff: chrome-browser-mcp — 绕过 node_repl 的浏览器控制方案

## 项目位置
`D:\Documents\VibeCoding\GodeX\chrome-browser-mcp\`

## 当前状态：✅ 已完全可用

**已完成的文件：**
```
chrome-browser-mcp/
  package.json        ✅ 入口改为 index_new.js
  tsconfig.json      ✅ 排除 index.ts
  src/
    index_new.ts     ✅ stateless 模式，修复 transport 连接问题
    chrome.ts        ✅ 正常
    extension.ts     ✅ 正常
    tools/basic.ts   ✅ screenshot 修复为 Buffer.from().toString("base64")
    tools/enhanced.ts ✅ url -> pageUrl 变量名修复
    utils/port-finder.ts ✅
  dist/               ✅ 编译输出
  test_mcp.py        ✅ 验证脚本
  chrome-extension/  ❌ 空目录，Extension 待实现（可选）
```

## 验证结果（2026-07-03）

| 测试项 | 结果 |
|--------|------|
| MCP Server 启动 | ✅ `http://localhost:9224/mcp` |
| Initialize 握手 | ✅ |
| tools/list | ✅ 返回 13 个工具 |
| open_url | ✅ 打开百度 |
| screenshot | ✅ 返回 base64 PNG，92961 bytes |

## 13 个 MCP 工具

1. `open_url` - 新标签页打开 URL
2. `navigate` - 当前标签页导航
3. `screenshot` - 截图（返回 base64 PNG）
4. `click` - 点击元素
5. `type_text` - 输入文本
6. `get_text` - 获取元素文本
7. `wait_for` - 等待元素出现
8. `evaluate` - 执行 JS
9. `scroll_to` - 滚动到元素
10. `list_pages` - 列出所有标签页
11. `get_active_tab` - 获取当前标签页
12. `switch_tab` - 切换标签页
13. `get_element_info` - 获取元素详情（需 Extension）

## 关键技术点（MCP SDK v1.29.0）

1. **stateless 模式**：每个请求创建新的 `McpServer` 实例，避免 "Already connected" 错误
2. **导入方式**：`@modelcontextprotocol/sdk/server/mcp.js` + `streamableHttp.js`
3. **StreamableHTTPServerTransport**：需 `sessionIdGenerator: undefined`
4. **HTTP Accept Header**：必须包含 `application/json, text/event-stream`

## 启动命令

```powershell
cd D:\Documents\VibeCoding\GodeX\chrome-browser-mcp
node dist/index_new.js
```

## 下一步（按优先级）

1. **接入 GodeX relay**：将 MCP URL 注入 Codex config
   - 路径 A：`mcp_servers.node_repl.command` 指向 `node dist/index_new.js`
   - 路径 B：GodeX 启动时注入独立 MCP Server URL

2. **Chrome Extension**（可选）：用于精确元素定位
   - 当前 Playwright 可用，但扩展可提供更精确的坐标

3. **打包进 Studio**：外部程序调试完成后，集成进 GodeX 启动器

4. **GodeX 端口避让**：确保 9224 端口不会被其他程序占用
