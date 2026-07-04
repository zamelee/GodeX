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
- 用户在 Codex++ 的工具与插件页面手动配置
- 配置项：`mcpServers.browser_control.url`

### 可选：GodeX Studio 拉起
- chrome-browser-mcp 作为 GodeX Studio 的子进程
- Studio 管理生命周期

## MCP 服务 (端口 9224)

### 固定 + 动态避让
- 默认端口：9224
- 环境变量：`MCP_PORT`
- 如果端口被占用，使用 port-finder 自动找可用端口

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
- 模式：stateless（每个请求创建新 McpServer 实例）
- 避免 "Already connected" 错误

### 关键配置
```json
{
  "mcpServers": {
    "browser_control": {
      "url": "http://localhost:9224/mcp"
    }
  }
}
```

### 环境变量
- `MCP_PORT`：MCP 服务端口（默认 9224）
- `CDP_PORT`：Chrome DevTools 端口（默认 9222）

## 文件结构
```
chrome-browser-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index_new.ts     # 主入口（stateless MCP）
│   ├── chrome.ts        # Playwright Chrome 管理
│   ├── extension.ts     # Extension 通信
│   └── tools/
│       ├── basic.ts     # 基础工具
│       └── enhanced.ts  # Extension 增强工具
└── chrome-extension/    # Chrome 扩展（待实现）
```

## 状态

- [x] MCP Server 基本功能（13 工具）
- [x] Playwright 控制 Chrome
- [x] Mail.163.com 测试通过
- [ ] Extension 实现
- [ ] GodeX Studio 集成
- [ ] 生命周期管理

## 启动命令
```powershell
cd D:\Documents\VibeCoding\GodeX\chrome-browser-mcp
node dist/index_new.js
```
