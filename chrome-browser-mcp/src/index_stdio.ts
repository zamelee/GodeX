import { closeChrome } from "./chrome.js";
import { openUrl, navigate, screenshot, click, typeText, getText, waitFor, evaluate, scrollTo, listAllPages } from "./tools/basic.js";
import { getActiveTab, switchTab, getElementInfo } from "./tools/enhanced.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

async function main() {
  const { McpServer: ServerClass } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport: TransportClass } = await import("@modelcontextprotocol/sdk/server/stdio.js");

  const cdpPort = parseInt(process.env.CDP_PORT || "0", 10);
  const headless = process.env.HEADLESS !== "false";
  console.error("[chrome-browser-mcp] Starting stdio mode (headless=" + headless + ")");

  (globalThis as any).__chromeOptions = {
    preferredPort: cdpPort === 0 ? undefined : cdpPort,
    headless,
  };

  const server = new ServerClass({ name: "chrome-browser-mcp", version: "0.1.0" }, { capabilities: {} });

  server.registerTool("open_url", { description: "Open URL in new tab", inputSchema: z.object({ url: z.string() }) }, async ({ url }: any) => ({ content: [{ type: "text", text: await openUrl(url) }] }));
  server.registerTool("navigate", { description: "Navigate current tab", inputSchema: z.object({ url: z.string() }) }, async ({ url }: any) => ({ content: [{ type: "text", text: await navigate(url) }] }));
  server.registerTool("screenshot", { description: "Screenshot", inputSchema: z.object({}) }, async () => { const r = await screenshot(); return { content: [{ type: "image", data: r.split(",")[1], mimeType: "image/png" }] }; });
  server.registerTool("click", { description: "Click element", inputSchema: z.object({ selector: z.string() }) }, async ({ selector }: any) => ({ content: [{ type: "text", text: await click(selector) }] }));
  server.registerTool("type_text", { description: "Type text", inputSchema: z.object({ selector: z.string(), text: z.string() }) }, async ({ selector, text }: any) => ({ content: [{ type: "text", text: await typeText(selector, text) }] }));
  server.registerTool("get_text", { description: "Get element text", inputSchema: z.object({ selector: z.string() }) }, async ({ selector }: any) => ({ content: [{ type: "text", text: await getText(selector) }] }));
  server.registerTool("wait_for", { description: "Wait for element", inputSchema: z.object({ selector: z.string(), timeout: z.number().optional() }) }, async ({ selector, timeout }: any) => ({ content: [{ type: "text", text: await waitFor(selector, timeout) }] }));
  server.registerTool("evaluate", { description: "Run JS in page", inputSchema: z.object({ js: z.string() }) }, async ({ js }: any) => ({ content: [{ type: "text", text: String(await evaluate(js)) }] }));
  server.registerTool("scroll_to", { description: "Scroll to element", inputSchema: z.object({ selector: z.string() }) }, async ({ selector }: any) => ({ content: [{ type: "text", text: await scrollTo(selector) }] }));
  server.registerTool("list_pages", { description: "List all tabs", inputSchema: z.object({}) }, async () => ({ content: [{ type: "text", text: JSON.stringify(await listAllPages()) }] }));
  server.registerTool("get_active_tab", { description: "Get active tab", inputSchema: z.object({}) }, async () => ({ content: [{ type: "text", text: JSON.stringify(await getActiveTab()) }] }));
  server.registerTool("switch_tab", { description: "Switch tab", inputSchema: z.object({ url_pattern: z.string() }) }, async ({ url_pattern }: any) => ({ content: [{ type: "text", text: await switchTab(url_pattern) }] }));
  server.registerTool("get_element_info", { description: "Element info", inputSchema: z.object({ selector: z.string() }) }, async ({ selector }: any) => ({ content: [{ type: "text", text: JSON.stringify(await getElementInfo(selector)) }] }));

  const transport = new TransportClass() as any;
  await server.connect(transport);

  process.on("SIGINT", async () => { await closeChrome(); process.exit(0); });
  process.on("SIGTERM", async () => { await closeChrome(); process.exit(0); });
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
