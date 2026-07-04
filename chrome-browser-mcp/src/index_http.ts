/**
 * HTTP 入口 - 简单 REST 风格，直接暴露工具
 * Codex 可通过 HTTP 调用工具
 */
import * as z from "zod";
import { closeChrome } from "./chrome.js";
import { openUrl, navigate, screenshot, click, typeText, getText, waitFor, evaluate, scrollTo, listAllPages } from "./tools/basic.js";
import { getActiveTab, switchTab, getElementInfo } from "./tools/enhanced.js";

const DEFAULT_PORT = 9224;

const toolHandlers = {
  open_url: async ({ url }: { url: string }) => ({ content: [{ type: "text", text: await openUrl(url) }] }),
  navigate: async ({ url }: { url: string }) => ({ content: [{ type: "text", text: await navigate(url) }] }),
  screenshot: async () => { const r = await screenshot(); return { content: [{ type: "image", data: r.split(",")[1], mimeType: "image/png" }] }; },
  click: async ({ selector }: { selector: string }) => ({ content: [{ type: "text", text: await click(selector) }] }),
  type_text: async ({ selector, text }: { selector: string; text: string }) => ({ content: [{ type: "text", text: await typeText(selector, text) }] }),
  get_text: async ({ selector }: { selector: string }) => ({ content: [{ type: "text", text: await getText(selector) }] }),
  wait_for: async ({ selector, timeout }: { selector: string; timeout?: number }) => ({ content: [{ type: "text", text: await waitFor(selector, timeout) }] }),
  evaluate: async ({ js }: { js: string }) => ({ content: [{ type: "text", text: String(await evaluate(js)) }] }),
  scroll_to: async ({ selector }: { selector: string }) => ({ content: [{ type: "text", text: await scrollTo(selector) }] }),
  list_pages: async () => ({ content: [{ type: "text", text: JSON.stringify(await listAllPages()) }] }),
  get_active_tab: async () => ({ content: [{ type: "text", text: JSON.stringify(await getActiveTab()) }] }),
  switch_tab: async ({ url_pattern }: { url_pattern: string }) => ({ content: [{ type: "text", text: await switchTab(url_pattern) }] }),
  get_element_info: async ({ selector }: { selector: string }) => ({ content: [{ type: "text", text: JSON.stringify(await getElementInfo(selector)) }] }),
};

const TOOL_SCHEMAS: Record<string, z.ZodObject<any>> = {
  open_url: z.object({ url: z.string() }),
  navigate: z.object({ url: z.string() }),
  screenshot: z.object({}),
  click: z.object({ selector: z.string() }),
  type_text: z.object({ selector: z.string(), text: z.string() }),
  get_text: z.object({ selector: z.string() }),
  wait_for: z.object({ selector: z.string(), timeout: z.number().optional() }),
  evaluate: z.object({ js: z.string() }),
  scroll_to: z.object({ selector: z.string() }),
  list_pages: z.object({}),
  get_active_tab: z.object({}),
  switch_tab: z.object({ url_pattern: z.string() }),
  get_element_info: z.object({ selector: z.string() }),
};

async function main() {
  const port = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  const cdpPort = parseInt(process.env.CDP_PORT || "0", 10);
  const headless = process.env.HEADLESS !== "true";

  console.error(`[chrome-browser-mcp] HTTP 启动 (端口 ${port})`);
  (globalThis as any).__chromeOptions = {
    preferredPort: cdpPort === 0 ? undefined : cdpPort,
    headless,
  };

  const express = (await import("express")).default;
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // 健康检查
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", tools: Object.keys(toolHandlers) });
  });

  // 工具列表
  app.get("/tools", (_req, res) => {
    res.json({
      tools: Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
        name,
        description: name.replace(/_/g, " "),
        inputSchema: schema,
      })),
    });
  });

  // 调用工具
  app.post("/call", async (req, res) => {
    const { tool, arguments: args = {} } = req.body;
    if (!tool || !toolHandlers[tool as keyof typeof toolHandlers]) {
      res.status(400).json({ error: `Unknown tool: ${tool}` });
      return;
    }
    try {
      const schema = TOOL_SCHEMAS[tool as keyof typeof TOOL_SCHEMAS];
      const parsed = schema.parse(args);
      const result = await (toolHandlers as any)[tool](parsed);
      res.json({ result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(port, () => {
    console.error(`[chrome-browser-mcp] ✅ 就绪`);
    console.error(`  工具列表: GET  http://localhost:${port}/tools`);
    console.error(`  调用工具: POST http://localhost:${port}/call`);
    console.error(`  Body: {"tool":"open_url","arguments":{"url":"https://mail.163.com"}}`);
  });

  process.on("SIGINT", async () => {
    console.error("关闭中...");
    await closeChrome();
    process.exit(0);
  });
}

main().catch((err: Error) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
