/**
 * chrome-browser-mcp
 * 
 * MCP Server，通过 Playwright 控制 Chrome，绕过 node_repl 的内置浏览器限制。
 * 
 * 使用方式：
 *   node --loader tsx src/index.ts
 *   或: npx tsx src/index.ts
 * 
 * 环境变量：
 *   MCP_PORT       - MCP HTTP Server 端口，默认 9224
 *   CDP_PORT       - Chrome 调试端口，默认 0（自动查找）
 *   LOG_LEVEL      - 日志级别，默认 info
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequest,
  ListToolsRequest,
} from "@modelcontextprotocol/sdk/types.js";

import { getChrome, closeChrome, ChromeOptions } from "./chrome.js";
import { setExtensionMessage } from "./extension.js";

// 基础工具
import {
  openUrl,
  navigate,
  screenshot,
  click,
  typeText,
  getText,
  waitFor,
  evaluate,
  scrollTo,
  listAllPages,
} from "./tools/basic.js";

// 增强工具（插件模式）
import {
  getActiveTab,
  switchTab,
  getElementInfo,
} from "./tools/enhanced.js";

const DEFAULT_MCP_PORT = 9224;

const TOOLS = [
  // === 基础工具 ===
  {
    name: "open_url",
    description: "Open a URL in a new browser tab",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "The URL to open" } },
      required: ["url"],
    },
  },
  {
    name: "navigate",
    description: "Navigate the current tab to a URL",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "The URL to navigate to" } },
      required: ["url"],
    },
  },
  {
    name: "screenshot",
    description: "Take a screenshot of the current page, returns base64 PNG",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "click",
    description: "Click an element by CSS selector",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string", description: "CSS selector" } },
      required: ["selector"],
    },
  },
  {
    name: "type_text",
    description: "Fill an input field with text",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the input" },
        text: { type: "string", description: "Text to type" },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "get_text",
    description: "Get text content of an element",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string", description: "CSS selector" } },
      required: ["selector"],
    },
  },
  {
    name: "wait_for",
    description: "Wait for an element to appear",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector" },
        timeout: { type: "number", description: "Timeout in ms (default 15000)" },
      },
      required: ["selector"],
    },
  },
  {
    name: "evaluate",
    description: "Execute arbitrary JavaScript in the page",
    inputSchema: {
      type: "object",
      properties: { js: { type: "string", description: "JavaScript code to execute" } },
      required: ["js"],
    },
  },
  {
    name: "scroll_to",
    description: "Scroll an element into view",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string", description: "CSS selector" } },
      required: ["selector"],
    },
  },
  {
    name: "list_pages",
    description: "List all open browser pages/tabs",
    inputSchema: { type: "object", properties: {} },
  },
  // === 插件增强工具 ===
  {
    name: "get_active_tab",
    description: "Get the currently active tab info (uses Extension if available, else fallback to Playwright)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "switch_tab",
    description: "Switch to a tab matching a URL pattern",
    inputSchema: {
      type: "object",
      properties: { url_pattern: { type: "string", description: "URL or pattern to match" } },
      required: ["url_pattern"],
    },
  },
  {
    name: "get_element_info",
    description: "Get detailed element info (bounding box, visibility, text)",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string", description: "CSS selector" } },
      required: ["selector"],
    },
  },
];

async function main() {
  const mcpPort = parseInt(process.env.MCP_PORT || String(DEFAULT_MCP_PORT), 10);
  const cdpPort = parseInt(process.env.CDP_PORT || "0", 10);

  console.log(`[chrome-browser-mcp] Starting...`);
  console.log(`  MCP HTTP: http://localhost:${mcpPort}/mcp`);
  console.log(`  CDP port: ${cdpPort}`);

  // 初始化 Chrome
  const chromeOptions: ChromeOptions = {
    preferredPort: cdpPort === 0 ? undefined : cdpPort,
    headless: false, // headful 让用户能看到操作
  };

  try {
    await getChrome(chromeOptions);
    console.log(`[chrome-browser-mcp] Chrome connected`);
  } catch (err) {
    console.error(`[chrome-browser-mcp] Failed to connect Chrome: ${err}`);
    process.exit(1);
  }

  // 创建 MCP Server
  const server = new Server(
    {
      name: "chrome-browser-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 注册工具列表
  server.setRequestHandler(ListToolsRequest, async () => {
    return { tools: TOOLS };
  });

  // 处理工具调用
  server.setRequestHandler(CallToolRequest, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case "open_url":
          result = await openUrl(args?.url as string);
          break;
        case "navigate":
          result = await navigate(args?.url as string);
          break;
        case "screenshot":
          result = await screenshot();
          break;
        case "click":
          result = await click(args?.selector as string);
          break;
        case "type_text":
          result = await typeText(args?.selector as string, args?.text as string);
          break;
        case "get_text":
          result = await getText(args?.selector as string);
          break;
        case "wait_for":
          result = await waitFor(
            args?.selector as string,
            args?.timeout as number | undefined
          );
          break;
        case "evaluate":
          result = await evaluate(args?.js as string);
          break;
        case "scroll_to":
          result = await scrollTo(args?.selector as string);
          break;
        case "list_pages":
          result = await listAllPages();
          break;
        case "get_active_tab":
          result = await getActiveTab();
          break;
        case "switch_tab":
          result = await switchTab(args?.url_pattern as string);
          break;
        case "get_element_info":
          result = await getElementInfo(args?.selector as string);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      // 支持 base64 图片和普通文本
      const isImageResult =
        typeof result === "string" && result.startsWith("data:image/");

      return {
        content: [
          {
            type: isImageResult ? "image" : "text",
            ...(isImageResult
              ? { data: (result as string).split(",")[1], mimeType: "image/png" }
              : { text: String(result) }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err}` }],
        isError: true as const,
      };
    }
  });

  // 创建 HTTP Transport 并启动
  const transport = new StreamableHTTPServerTransport({
    port: mcpPort,
    // POST 和 GET 都支持 SSE
  });

  // Extension HTTP 端点（方案 2 备选）
  const extHandler = (req: Request) => {
    if (req.method === "POST") {
      req.json().then((body) => {
        setExtensionMessage(body as Parameters<typeof setExtensionMessage>[0]);
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  };

  await server.connect(transport);
  console.log(`[chrome-browser-mcp] MCP Server ready on http://localhost:${mcpPort}/mcp`);

  // 优雅关闭
  const shutdown = async () => {
    console.log(`[chrome-browser-mcp] Shutting down...`);
    await closeChrome();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(`[chrome-browser-mcp] Fatal: ${err}`);
  process.exit(1);
});
