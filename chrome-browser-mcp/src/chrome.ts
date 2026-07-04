/**
 * Chrome 连接管理器
 * 支持：1) 连接已有 Chrome 调试端口  2) Playwright 启动独立 Chrome
 */

import { chromium, Browser, Page } from "playwright";
import { findChromePort, ChromeConnectionInfo, savePortToRegistry, loadPortFromRegistry } from "./utils/port-finder.js";

export interface ChromeOptions {
  preferredPort?: number;
  ports?: number[];
  headless?: boolean;
  userDataDir?: string;
  debugPort?: number;
}

export interface ChromeInstance {
  browser: Browser;
  launchedByPlaywright: boolean;
  port: number;
  wsUrl: string;
}

let cachedInstance: ChromeInstance | null = null;

export async function getChrome(options: ChromeOptions = {}): Promise<ChromeInstance> {
  // 默认可见模式（headless=false），通过 CHROME_HEADLESS=1 可切换为无头
  const headlessEnv = process.env.CHROME_HEADLESS;
  const wantHeadless = headlessEnv === "1";
  const _opts: any = (globalThis as any).__chromeOptions || {};
  options = { headless: wantHeadless, ..._opts, ...options };
  console.error("[chrome-getChrome] headless=" + options.headless);

  if (cachedInstance) {
    console.error("[chrome-getChrome] returning cached instance");
    return cachedInstance;
  }

  const { preferredPort, ports = [9222, 9223, 9224, 9225], headless = false, debugPort = 9222 } = options;

  const registryPort = loadPortFromRegistry();
  const orderedPorts = registryPort ? [registryPort, ...ports.filter((p) => p !== registryPort)] : ports;

  let info: ChromeConnectionInfo | null = null;
  if (!preferredPort || preferredPort === 0) {
    info = await findChromePort(orderedPorts);
    console.error("[chrome] findChromePort result:", info ? `port=${info.port} wsUrl=${info.wsUrl.slice(0, 60)}` : "null");
  } else {
    info = await findChromePort([preferredPort]);
    console.error("[chrome] findChromePort result:", info ? `port=${info.port} wsUrl=${info.wsUrl.slice(0, 60)}` : "null");
  }

  if (info) {
    console.log("[chrome] 连接已有 Chrome 调试端口 " + info.port);
    savePortToRegistry(info.port);
    try {
      const browser = await chromium.connectOverCDP("http://127.0.0.1:" + info.port);
      cachedInstance = { browser, launchedByPlaywright: false, port: info.port, wsUrl: info.wsUrl };
      return cachedInstance;
    } catch (connectErr: any) {
      console.error("[chrome] 连接失败 detail:", connectErr?.stack || connectErr?.message || String(connectErr));
      info = null;
    }
  }

  console.log("[chrome] 未找到可用调试端口，启动独立 Chrome（端口 " + debugPort + "，headless=" + headless + "）");
  // 当 CDP_PORT 显式设置时，不允许启动新 Chrome（必须由用户预先启动）
  if (process.env.CDP_PORT) {
    throw new Error("CDP_PORT=" + process.env.CDP_PORT + " 指定端口无可用 Chrome，且禁用自动启动。请先手动启动 Chrome: chrome.exe --remote-debugging-port=" + process.env.CDP_PORT + " --load-extension=...");
  }
  const extPath = process.env.CHROME_EXTENSION_PATH || "";
  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless,
    args: ["--remote-debugging-port=" + debugPort, "--no-first-run", "--no-default-browser-check"],
  };
  if (extPath) {
    (launchOptions.args as string[]).push("--load-extension=" + extPath);
    console.log("[chrome] Loading extension from: " + extPath);
  }
  if (options.userDataDir) {
    (launchOptions as any).userDataDir = options.userDataDir;
  }

  const browser = await chromium.launch(launchOptions);
  savePortToRegistry(debugPort);
  cachedInstance = { browser, launchedByPlaywright: true, port: debugPort, wsUrl: "" };
  return cachedInstance;
}

export async function getActivePage(): Promise<Page | null> {
  const inst = await getChrome();
  const pages = inst.browser.contexts()[0]?.pages() || [];
  return pages[0] || null;
}

export async function listPages(): Promise<{ id: string; url: string; title: string }[]> {
  const inst = await getChrome();
  const pages: { id: string; url: string; title: string }[] = [];
  for (const ctx of inst.browser.contexts()) {
    for (const page of ctx.pages()) {
      pages.push({ id: page.url(), url: page.url(), title: await page.title() });
    }
  }
  return pages;
}

export async function closeChrome(): Promise<void> {
  if (cachedInstance) {
    await cachedInstance.browser.close();
    cachedInstance = null;
  }
}

export async function ensureChrome(): Promise<ChromeInstance> {
  console.error("[chrome] Initializing Chrome...");
  try {
    const inst = await getChrome();
    console.error("[chrome] Ready on port " + inst.port);
    return inst;
  } catch (err) {
    console.error("[chrome] Init failed: " + err);
    throw err;
  }
}
