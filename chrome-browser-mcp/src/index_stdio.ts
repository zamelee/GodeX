import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { getChrome, closeChrome } from "./chrome.js";
import { openUrl, navigate, screenshot, click, typeText, getText, waitFor, evaluate, scrollTo, listAllPages } from "./tools/basic.js";
import { getActiveTab, switchTab, getElementInfo } from "./tools/enhanced.js";

function createServer() {
  const server = new McpServer({ name: "chrome-browser-mcp", version: "0.1.0" }, { capabilities: {} });
  server.registerTool("open_url", { description: "Open URL in new tab", inputSchema: z.object({ url: z.string() }) }, async ({ url }) => ({ content: [{ type: "text", text: await openUrl(url) }] }));
  server.registerTool("navigate", { description: "Navigate current tab", inputSchema: z.object({ url: z.string() }) }, async ({ url }) => ({ content: [{ type: "text", text: await navigate(url) }] }));
  server.registerTool("screenshot", { description: "Screenshot", inputSchema: z.object({}) }, async () => { const r = await screenshot(); return { content: [{ type: "image", data: r.split(",")[1], mimeType: "image/png" }] }; });
  server.registerTool("click", { description: "Click element", inputSchema: z.object({ selector: z.string() }) }, async ({ selector }) => ({ content: [{ type: "text", text: await click(selector) }] }));
  server.registerTool("type_text", { description: "Type text", inputSchema: z.object({ selector: z.string(), text: z.string() }) }, async ({ selector, text }) => ({ content: [{ type: "text", text: await typeText(selector, text) }] }));
  server.registerTool("get_text", { description: "Get element text", inputSchema: z.object({ selector: z.string() }) }, async ({ selector }) => ({ content: [{ type: "text", text: await getText(selector) }] }));
  server.registerTool("wait_for", { description: "Wait for element", inputSchema: z.object({ selector: z.string(), timeout: z.number().optional() }) }, async ({ selector, timeout }) => ({ content: [{ type: "text", text: await waitFor(selector, timeout) }] }));
  server.registerTool("evaluate", { description: "Run JS in page", inputSchema: z.object({ js: z.string() }) }, async ({ js }) => ({ content: [{ type: "text", text: String(await evaluate(js)) }] }));
  server.registerTool("scroll_to", { description: "Scroll to element", inputSchema: z.object({ selector: z.string() }) }, async ({ selector }) => ({ content: [{ type: "text", text: await scrollTo(selector) }] }));
  server.registerTool("list_pages", { description: "List all tabs", inputSchema: z.object({}) }, async () => ({ content: [{ type: "text", text: JSON.stringify(await listAllPages()) }] }));
  server.registerTool("get_active_tab", { description: "Get active tab", inputSchema: z.object({}) }, async () => ({ content: [{ type: "text", text: JSON.stringify(await getActiveTab()) }] }));
  server.registerTool("switch_tab", { description: "Switch tab", inputSchema: z.object({ url_pattern: z.string() }) }, async ({ url_pattern }) => ({ content: [{ type: "text", text: await switchTab(url_pattern) }] }));
  server.registerTool("get_element_info", { description: "Element info", inputSchema: z.object({ selector: z.string() }) }, async ({ selector }) => ({ content: [{ type: "text", text: JSON.stringify(await getElementInfo(selector)) }] }));
  return server;
}

async function main() {
  const cdpPort = parseInt(process.env.CDP_PORT || "0", 10);
  console.error("[chrome-browser-mcp] Starting in stdio mode...");

  try {
    await getChrome({ preferredPort: cdpPort === 0 ? undefined : cdpPort, headless: false });
    console.error("[chrome-browser-mcp] Chrome connected");
  } catch (err) {
    console.error("[chrome-browser-mcp] Chrome connect error: " + err);
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  const server = createServer();
  await server.connect(transport);

  process.on("SIGINT", async () => { console.error("Shutting down..."); await closeChrome(); process.exit(0); });
  process.on("SIGTERM", async () => { console.error("Shutting down..."); await closeChrome(); process.exit(0); });
}

main().catch(err => { console.error("Fatal: " + err); process.exit(1); });
