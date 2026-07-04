/**
 * HTTP entry - exposes MCP tools over HTTP
 * Tools like click/type_text/navigate/screenshot route through Chrome extension (chrome.debugger) when available,
 * fall back to Playwright when extension is not connected.
 */
import * as z from "zod";
import { closeChrome } from "./chrome.js";
import { openUrl, navigate, screenshot as pwScreenshot, click, typeText, getText, waitFor, evaluate as pwEvaluate, scrollTo, listAllPages as pwListPages } from "./tools/basic.js";
import { getActiveTab as extGetActiveTabFn, switchTab, getElementInfo as extGetElementInfoFn } from "./tools/enhanced.js";
import { extPing, extIsAvailable, extNavigate, extScreenshot, extClick as extClickFn, extTypeText as extTypeTextFn, extGetAllInputs, extListPages, extEvaluate as extEvalFn, extGetElementInfo as extGetElInfoFn } from "./tools/ext.js";
import { startExtWsServer } from "./ext-ws.js";

const DEFAULT_PORT = 9224;

// Smart wrappers: extension first, Playwright fallback
async function smartNavigate(url: string): Promise<string> {
  if (await extIsAvailable()) {
    try { return await extNavigate(url); } catch {}
  }
  return navigate(url);
}

async function smartScreenshot(): Promise<string> {
  if (await extIsAvailable()) {
    try { return await extScreenshot(); } catch {}
  }
  return pwScreenshot();
}

async function smartClick(selector: string): Promise<string> {
  if (await extIsAvailable()) {
    try { return await extClickFn(selector); } catch (e) { return "Extension: " + (e as Error).message; }
  }
  return click(selector);
}

async function smartTypeText(selector: string, text: string): Promise<string> {
  if (await extIsAvailable()) {
    try { return await extTypeTextFn(selector, text); } catch (e) { return "Extension: " + (e as Error).message; }
  }
  return typeText(selector, text);
}

async function smartEvaluate(js: string): Promise<string> {
  if (await extIsAvailable()) {
    try {
      const r = await extEvalFn(js);
      return String(r);
    } catch (e) {
      // Fall through to Playwright
    }
  }
  return String(await pwEvaluate(js));
}

async function smartListPages(): Promise<unknown[]> {
  if (await extIsAvailable()) {
    try { return await extListPages(); } catch {}
  }
  return pwListPages();
}

async function smartGetActiveTab(): Promise<unknown> {
  if (await extIsAvailable()) {
    try { return await extGetActiveTabFn(); } catch {}
  }
  // Fallback: Playwright via enhanced.ts
  const tab = await extGetActiveTabFn();
  return tab;
}

async function smartGetElementInfo(selector: string): Promise<unknown> {
  if (await extIsAvailable()) {
    try { return await extGetElInfoFn(selector); } catch {}
  }
  return extGetElementInfoFn(selector);
}

const toolHandlers: Record<string, (args: any) => Promise<any>> = {
  open_url: async ({ url }: { url: string }) => ({ content: [{ type: "text", text: await openUrl(url) }] }),
  navigate: async ({ url }: { url: string }) => ({ content: [{ type: "text", text: await smartNavigate(url) }] }),
  screenshot: async () => {
    const r = await smartScreenshot();
    return { content: [{ type: "image", data: r.split(",")[1], mimeType: "image/png" }] };
  },
  click: async ({ selector }: { selector: string }) => ({ content: [{ type: "text", text: await smartClick(selector) }] }),
  type_text: async ({ selector, text }: { selector: string; text: string }) => ({ content: [{ type: "text", text: await smartTypeText(selector, text) }] }),
  get_text: async ({ selector }: { selector: string }) => ({ content: [{ type: "text", text: await getText(selector) }] }),
  wait_for: async ({ selector, timeout }: { selector: string; timeout?: number }) => ({ content: [{ type: "text", text: await waitFor(selector, timeout) }] }),
  evaluate: async ({ js }: { js: string }) => ({ content: [{ type: "text", text: await smartEvaluate(js) }] }),
  scroll_to: async ({ selector }: { selector: string }) => ({ content: [{ type: "text", text: await scrollTo(selector) }] }),
  list_pages: async () => ({ content: [{ type: "text", text: JSON.stringify(await smartListPages()) }] }),
  get_active_tab: async () => ({ content: [{ type: "text", text: JSON.stringify(await smartGetActiveTab()) }] }),
  switch_tab: async ({ url_pattern }: { url_pattern: string }) => ({ content: [{ type: "text", text: await switchTab(url_pattern) }] }),
  get_element_info: async ({ selector }: { selector: string }) => ({ content: [{ type: "text", text: JSON.stringify(await smartGetElementInfo(selector)) }] }),
  ext_ping: async () => ({ content: [{ type: "text", text: JSON.stringify(await extPing()) }] }),
  ext_get_inputs: async () => {
    if (await extIsAvailable()) {
      const inputs = await extGetAllInputs();
      return { content: [{ type: "text", text: JSON.stringify(inputs) }] };
    }
    return { content: [{ type: "text", text: "Extension not available" }] };
  },
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
  ext_ping: z.object({}),
  ext_get_inputs: z.object({}),
};

async function main() {
  const port = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  const cdpPort = parseInt(process.env.CDP_PORT || "0", 10);
  const headless = process.env.HEADLESS === "1";

  console.error("[chrome-browser-mcp] HTTP 启动 (端口 " + port + ")");
  (globalThis as any).__chromeOptions = {
    preferredPort: cdpPort === 0 ? undefined : cdpPort,
    headless,
  };

  // Start extension WebSocket server (port 9225)
  startExtWsServer();

  const express = (await import("express")).default;
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", async (_req, res) => {
    const { extIsConnected } = await import("./ext-ws.js");
    res.json({ status: "ok", tools: Object.keys(toolHandlers), extConnected: extIsConnected() });
  });

  app.get("/tools", (_req, res) => {
    res.json({
      tools: Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
        name,
        description: name.replace(/_/g, " "),
        inputSchema: schema,
      })),
    });
  });

  app.post("/call", async (req, res) => {
    const { tool, arguments: args = {} } = req.body;
    if (!tool || !toolHandlers[tool]) {
      res.status(400).json({ error: "Unknown tool: " + tool });
      return;
    }
    try {
      const schema = TOOL_SCHEMAS[tool];
      const parsed = schema.parse(args);
      const result = await toolHandlers[tool](parsed);
      res.json({ result });
    } catch (err: any) {
      res.status(200).json({ result: { content: [{ type: "text", text: "Error: " + err.message }] } });
    }
  });

  app.listen(port, () => {
    console.error("[chrome-browser-mcp] \u2713 就绪");
    console.error("  HTTP tools: http://localhost:" + port + "/call");
    console.error("  Extension WS: ws://localhost:9225/ext");
  });

  process.on("SIGINT", async () => {
    console.error("关闭中...");
    await closeChrome();
    process.exit(0);
  });
}

main().catch((err: Error) => {
  console.error("Fatal: " + err.message);
  process.exit(1);
});
