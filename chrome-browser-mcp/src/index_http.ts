/**
 * HTTP 入口 - 适合独立后台运行
 * Codex 可通过 HTTP 连接使用 MCP
 * 启动器使用此模式
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod";
import { closeChrome } from "./chrome.js";
import { openUrl, navigate, screenshot, click, typeText, getText, waitFor, evaluate, scrollTo, listAllPages } from "./tools/basic.js";
import { getActiveTab, switchTab, getElementInfo } from "./tools/enhanced.js";

const DEFAULT_MCP_PORT = 9224;
const DEFAULT_HEADLESS = false;

type ToolHandler = (args: any) => Promise<any>;
const tools = new Map<string, { description: string; schema: object; handler: ToolHandler }>();

function registerTool(name: string, description: string, schema: object, handler: ToolHandler) {
  tools.set(name, { description, schema, handler });
}

registerTool("open_url", "Open URL in new tab", { type: "object", properties: { url: { type: "string" } }, required: ["url"] }, async ({ url }: any) => ({
  content: [{ type: "text", text: await openUrl(url) }],
}));

registerTool("navigate", "Navigate current tab", { type: "object", properties: { url: { type: "string" } }, required: ["url"] }, async ({ url }: any) => ({
  content: [{ type: "text", text: await navigate(url) }],
}));

registerTool("screenshot", "Screenshot", { type: "object", properties: {} }, async () => {
  const r = await screenshot();
  return { content: [{ type: "image", data: r.split(",")[1], mimeType: "image/png" }] };
});

registerTool("click", "Click element", { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] }, async ({ selector }: any) => ({
  content: [{ type: "text", text: await click(selector) }],
}));

registerTool("type_text", "Type text", { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } }, required: ["selector", "text"] }, async ({ selector, text }: any) => ({
  content: [{ type: "text", text: await typeText(selector, text) }],
}));

registerTool("get_text", "Get element text", { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] }, async ({ selector }: any) => ({
  content: [{ type: "text", text: await getText(selector) }],
}));

registerTool("wait_for", "Wait for element", { type: "object", properties: { selector: { type: "string" }, timeout: { type: "number" } }, required: ["selector"] }, async ({ selector, timeout }: any) => ({
  content: [{ type: "text", text: await waitFor(selector, timeout) }],
}));

registerTool("evaluate", "Run JS in page", { type: "object", properties: { js: { type: "string" } }, required: ["js"] }, async ({ js }: any) => ({
  content: [{ type: "text", text: String(await evaluate(js)) }],
}));

registerTool("scroll_to", "Scroll to element", { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] }, async ({ selector }: any) => ({
  content: [{ type: "text", text: await scrollTo(selector) }],
}));

registerTool("list_pages", "List all tabs", { type: "object", properties: {} }, async () => ({
  content: [{ type: "text", text: JSON.stringify(await listAllPages()) }],
}));

registerTool("get_active_tab", "Get active tab", { type: "object", properties: {} }, async () => ({
  content: [{ type: "text", text: JSON.stringify(await getActiveTab()) }],
}));

registerTool("switch_tab", "Switch tab", { type: "object", properties: { url_pattern: { type: "string" } }, required: ["url_pattern"] }, async ({ url_pattern }: any) => ({
  content: [{ type: "text", text: await switchTab(url_pattern) }],
}));

registerTool("get_element_info", "Element info", { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] }, async ({ selector }: any) => ({
  content: [{ type: "text", text: JSON.stringify(await getElementInfo(selector)) }],
}));

function createServer(): McpServer {
  const server = new McpServer({ name: "chrome-browser-mcp", version: "0.1.0" }, { capabilities: {} });

  for (const [name, tool] of tools) {
    server.registerTool(
      name,
      { description: tool.description, inputSchema: tool.schema as z.ZodObject<any> },
      async (args: any) => {
        try {
          return await tool.handler(args);
        } catch (err: any) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
        }
      }
    );
  }

  return server;
}

async function main() {
  const mcpPort = parseInt(process.env.MCP_PORT || String(DEFAULT_MCP_PORT), 10);
  const cdpPort = parseInt(process.env.CDP_PORT || "0", 10);
  const headless = process.env.HEADLESS !== "true";

  console.error(`[chrome-browser-mcp] HTTP 模式启动`);
  console.error(`  MCP 端口: ${mcpPort}`);
  console.error(`  CDP 端口: ${cdpPort === 0 ? "自动" : cdpPort}`);
  console.error(`  HEADLESS: ${headless}`);

  // 设置懒加载参数
  (globalThis as any).__chromeOptions = {
    preferredPort: cdpPort === 0 ? undefined : cdpPort,
    headless,
  };

  // 动态导入 express
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());

  // MCP 端点
  app.post("/mcp", async (req: any, res: any) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // 健康检查
  app.get("/health", (_req: any, res: any) => {
    res.json({ status: "ok", version: "0.1.0", tools: tools.size });
  });

  // 工具列表（调试用）
  app.get("/tools", (_req: any, res: any) => {
    res.json({
      tools: Array.from(tools.entries()).map(([name, t]) => ({
        name,
        description: t.description,
        schema: t.schema,
      })),
    });
  });

  const server = app.listen(mcpPort, () => {
    console.error(`[chrome-browser-mcp] ✅ HTTP 服务已就绪`);
    console.error(`  MCP 端点: http://localhost:${mcpPort}/mcp`);
    console.error(`  健康检查: http://localhost:${mcpPort}/health`);
    console.error(`  工具列表: http://localhost:${mcpPort}/tools`);
  });

  server.on("error", (err: Error) => {
    console.error(`[chrome-browser-mcp] ❌ 端口 ${mcpPort} 被占用: ${err.message}`);
    process.exit(1);
  });

  process.on("SIGINT", async () => {
    console.error("[chrome-browser-mcp] 关闭中...");
    await closeChrome();
    server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.error("[chrome-browser-mcp] 关闭中...");
    await closeChrome();
    server.close();
    process.exit(0);
  });
}

main().catch((err: Error) => {
  console.error(`[chrome-browser-mcp] ❌ Fatal: ${err.message}`);
  process.exit(1);
});
