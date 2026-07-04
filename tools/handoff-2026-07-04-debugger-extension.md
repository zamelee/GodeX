## 2026-07-04 重大里程碑：chrome.debugger 扩展架构

### 为什么不用 content_scripts / chrome.scripting

| 方案 | 状态 | 原因 |
|---|---|---|
| `content_scripts` 自动注入 | 失败 | `--load-extension` 模式下 Chrome 限制 |
| `chrome.scripting.executeScript` | 失败 | 扩展 API 在该模式下不可用 |
| `chrome.debugger.attach` | 成功 | F12 同等权限，不受加载方式限制 |

### 最终架构：chrome.debugger + WebSocket

```
用户 Chrome（已通过 chrome://extensions/ 加载扩展）
  ├─ service_worker (chrome.debugger 权限 = F12 等同权限)
  │    └─ WebSocket: ws://localhost:9225/ext
  │
  └─ 所有 Tab（受扩展直接 CDP 控制）

         ↑↓ WebSocket

MCP 服务器（Node.js）
  ├─ HTTP API  :9224（Codex++ 调用）
  ├─ WebSocket :9225（接收扩展）
  └─ Playwright fallback（扩展断线时）
```

### 扩展 ID（永久）

`doincgkhebebkkjbmdhlfjkdbgfknkod`

> 用户必须通过 chrome://extensions/ → 开发者模式 → 加载已解压的扩展程序加载
> （不能用 `--load-extension` 命令行方式）

### 新增文件

```
chrome-browser-mcp/
├── extension/src/
│   ├── manifest.json     # 加了 debugger / unlimitedStorage 权限，去掉 content_scripts
│   └── service_worker.js # WebSocket 客户端 + chrome.debugger 调度器
└── src/
    ├── ext-ws.ts          # WebSocket Server (port 9225)
    └── tools/ext.ts       # 通过 WS 调用扩展的工具

chrome-browser-mcp/extension/src/manifest.json:
  - permissions: debugger, activeTab, tabs, scripting, storage, alarms, unlimitedStorage
  - host_permissions: <all_urls>
  - background.service_worker: service_worker.js (type: module)
  - 不再有 content_scripts
```

### service_worker.js 核心流程

```js
const MCP_WS = "ws://localhost:9225/ext";

function connect() {
  ws = new WebSocket(MCP_WS);
  ws.onopen = () => log("Connected to MCP");
  ws.onmessage = async (event) => {
    const { id, action, args } = JSON.parse(event.data);
    try {
      const result = await dispatchAction(action, args);
      ws.send(JSON.stringify({ id, success: true, result }));
    } catch (err) {
      ws.send(JSON.stringify({ id, success: false, error: err.message }));
    }
  };
  ws.onclose = () => setTimeout(connect, 2000); // 自动重连
}

async function dispatchAction(action, args) {
  const tabId = await getTargetTabId(args);
  switch (action) {
    case "navigate":   return cdp(tabId, "Page.navigate", { url: args.url });
    case "click":      return evalClick(tabId, args.selector);
    case "typeText":   return evalType(tabId, args.selector, args.text);
    case "evaluate":   return cdp(tabId, "Runtime.evaluate", { expression: args.js, returnByValue: true });
    case "screenshot": return cdp(tabId, "Page.captureScreenshot", { format: "png" });
    case "list_pages": return chrome.tabs.query({});
  }
}

async function cdp(tabId, method, params) {
  await ensureDebugger(tabId); // chrome.debugger.attach
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

connect(); // 启动时连接，掉线自动重连
chrome.alarms.create("keepAlive", { periodInMinutes: 0.25 }); // 防止 SW 被杀
```

### MCP 服务端 (ext-ws.ts) 核心

```ts
const wss = new WebSocketServer({ port: 9225, path: "/ext" });
wss.on("connection", (ws) => { extSocket = ws; });

export async function extSend(action, args) {
  const id = Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Extension request timeout")), 15000);
    function onMessage(data) {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        clearTimeout(timer);
        extSocket.off("message", onMessage);
        if (msg.success) resolve(msg.result);
        else reject(new Error(msg.error));
      }
    }
    extSocket.on("message", onMessage);
    extSocket.send(JSON.stringify({ id, type: "exec", action, args }));
  });
}
```

### 路由策略：扩展优先 + Playwright fallback

所有浏览器操作类工具（navigate / click / type_text / screenshot / evaluate / list_pages）都按这个顺序：
1. 尝试通过 WebSocket 调用扩展（chrome.debugger）
2. 失败时回退到 Playwright（启动独立 Chrome）

```ts
async function smartClick(selector: string): Promise<string> {
  if (await extIsAvailable()) {
    try { return await extClickFn(selector); }
    catch (e) { return "Extension: " + (e as Error).message; }
  }
  return click(selector); // Playwright fallback
}
```

### 验证清单

- [x] 扩展通过 chrome://extensions/ 加载（永久 ID `doincgkhebebkkjbmdhlfjkdbgfknkod`）
- [x] service_worker 连接 ws://localhost:9225/ext
- [x] navigate 通过 chrome.debugger.Page.navigate 成功
- [x] click 通过 chrome.debugger.Runtime.evaluate 成功（截图证实点击生效）
- [x] evaluate / screenshot / get_active_tab 全部通过
- [x] Playwright fallback 保留（扩展断线时不中断）

### 已知限制 & 下一步

1. **MV3 service_worker 可能被休眠**：靠 chrome.alarms (15s) 唤醒，重连会自动恢复
2. **chrome.debugger 需要用户授权**：首次使用会显示"该扩展正在调试此标签页"黄色条（不需点击）
3. **下次扩展新增工具**：在 dispatchAction() 加 case 即可，自动暴露给 MCP
4. **GodeX Studio 集成**：将 chrome-browser-mcp 作为 Studio 子进程拉起，统一管理生命周期
