# chrome-browser-mcp 详细设计文档

## 项目位置
`D:\Documents\VibeCoding\GodeX\chrome-browser-mcp\`

## 架构

```
Codex++ (启动器)
    ↓ 配置注入
Codex ←→ MCP 协议 ←→ chrome-browser-mcp (子进程)
                          ↓
                    Extension 可用？──Yes──→ Extension 控制
                          ↓ No
                    Playwright 控制
                          ↓
                    用户已有 Chrome / 独立 Chrome
```

## 启动方式

### 默认：Codex++ 配置页面注入
在 Codex++ 的工具与插件页面添加 MCP 配置：
```toml
[mcp_servers.browser_control]
enabled = true
command = "node"
args = ["D:/Documents/VibeCoding/GodeX/chrome-browser-mcp/dist/index_stdio.js"]
startup_timeout_sec = 120

[mcp_servers.browser_control.env]
CDP_PORT = "9222"
```

### 可选：GodeX Studio 拉起
- chrome-browser-mcp 作为 GodeX Studio 的子进程
- Studio 管理生命周期

### HTTP 模式（测试用）
```powershell
cd D:\Documents\VibeCoding\GodeX\chrome-browser-mcp
node dist/index_new.js  # HTTP 模式，端口 9224
```

## MCP 服务

### stdio 模式（Codex 调用）
使用 `index_stdio.js`，通过 stdin/stdout 与 Codex 通信

### HTTP 模式（测试用）
使用 `index_new.js`，通过 HTTP API 调用（端口 9224）

### 端口配置
- **CDP_PORT**：Chrome DevTools 端口（默认 9222）
- **MCP_PORT**：HTTP 模式端口（默认 9224，stdio 模式不需要）

### 13 个工具

| 工具 | 功能 | Extension 增强 |
|------|------|---------------|
| open_url | 新标签页打开 URL | ✅ |
| navigate | 当前标签页导航 | ✅ |
| screenshot | 截图（base64 PNG） | ✅ |
| click | 点击元素 | ✅ |
| type_text | 输入文本 | ✅ |
| get_text | 获取元素文本 | ✅ |
| wait_for | 等待元素出现 | ✅ |
| evaluate | 执行 JS | ✅ |
| scroll_to | 滚动到元素 | ✅ |
| list_pages | 列出所有标签页 | ✅ 精确 |
| get_active_tab | 获取当前标签页 | ✅ 精确 |
| switch_tab | 切换标签页 | ✅ 精确 |
| get_element_info | 获取元素详情 | ✅ 精确 |

## Chrome 控制策略

### 优先级
1. **Extension**：优先使用 Chrome Extension 控制
   - 精确元素定位
   - 获取 Chrome 动态（锁定对话与标签）
   - 复用用户已有 Chrome 窗口
   
2. **Playwright Fallback**：Extension 不可用时
   - 新开独立 Chrome 窗口
   - 端口：9222（CDP）

### Chrome 生命周期
- **不关闭**：对话结束不断开，保持连接
- **复用**：下次直接复用已有 Chrome，不新建窗口
- **常驻**：chrome-browser-mcp 保持运行，避免频繁启停

## Extension 功能（chrome-extension/）

### 核心功能
- 获取 Chrome 动态状态
- 精确元素定位（替代 Playwright selector）
- 锁定对话到特定标签页
- 与用户已有 Chrome 通信

### Fallback 机制
```
Extension 可用？ → Yes → Extension 控制
                → No → Playwright 控制
```

## 生命周期管理

### 常驻模式
- chrome-browser-mcp 保持运行
- 不产生一堆 Chrome 窗口
- 下次直接复用

### 自动重启
- GodeX Studio 作为 supervisor
- 监控 chrome-browser-mcp 子进程状态
- 崩溃后自动拉起新实例
- Codex 无感知，保持连接

## 服务多个实例

- 单个 chrome-browser-mcp 可同时服务多个 Codex 实例
- 通过 MCP session 管理
- 每个实例独立的状态（不同标签页等）

## 技术实现

### MCP SDK
- 版本：@modelcontextprotocol/sdk ^1.0.0
- stdio 模式：StdioServerTransport（Codex 调用）
- HTTP 模式：StreamableHTTPServerTransport（测试用）

### 关键文件
```
chrome-browser-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index_stdio.ts    # stdio 入口（Codex 调用）
│   ├── index_new.ts      # HTTP 入口（测试用）
│   ├── chrome.ts         # Playwright Chrome 管理
│   ├── extension.ts      # Extension 通信
│   └── tools/
│       ├── basic.ts      # 基础工具
│       └── enhanced.ts    # Extension 增强工具
└── dist/
    ├── index_stdio.js    # stdio 编译输出
    └── index_new.js       # HTTP 编译输出
```

## 状态

- [x] MCP Server stdio 模式（Codex 调用）
- [x] MCP Server HTTP 模式（测试用）
- [x] Playwright 控制 Chrome
- [x] Mail.163.com 测试通过
- [ ] Extension 实现
- [ ] GodeX Studio 集成
- [ ] 生命周期管理

## Codex++ 配置示例

在 Codex++ 的「工具与插件」页面，Kind 选择「MCP」：
- **ID**: browser_control
- **TOML 内容**:
```toml
enabled = true
command = "node"
args = ["D:/Documents/VibeCoding/GodeX/chrome-browser-mcp/dist/index_stdio.js"]
startup_timeout_sec = 120
```
