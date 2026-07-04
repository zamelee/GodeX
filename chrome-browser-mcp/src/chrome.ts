/**
 * Chrome 连接管理器
 * 支持：1) 连接已有 Chrome 调试端口  2) Playwright 启动独立 Chrome
 */

import { chromium, Browser, Page, BrowserContext } from "playwright";
import { findChromePort, ChromeConnectionInfo, savePortToRegistry, loadPortFromRegistry } from "./utils/port-finder.js";

export interface ChromeOptions {
  /** 优先使用的调试端口，0 表示自动查找 */
  preferredPort?: number;
  /** 固定端口列表（自动查找时使用） */
  ports?: number[];
  /** 是否在 Playwright 启动 Chrome 时使用 headful 模式 */
  headless?: boolean;
  /** 用户数据目录（仅启动新 Chrome 时使用） */
  userDataDir?: string;
  /** 调试端口（仅启动新 Chrome 时使用） */
  debugPort?: number;
}

export interface ChromeInstance {
  /** Playwright Browser 实例 */
  browser: Browser;
  /** 是否由 Playwright 启动（vs 接管已有） */
  launchedByPlaywright: boolean;
  /** 使用的端口 */
  port: number;
  /** WebSocket URL */
  wsUrl: string;
}

const DEFAULT_MCP_PORT = 9224;

let cachedInstance: ChromeInstance | null = null;

/**
 * 获取 Chrome 实例（连接已有或启动新实例）
 */
export async function getChrome(options: ChromeOptions = {}): Promise<ChromeInstance> {
  if (cachedInstance) {
    return cachedInstance;
  }

  const { preferredPort, ports = [9222, 9223, 9224, 9225], headless = false, debugPort = 9222 } = options;

  // 优先尝试注册表记录的端口
  const registryPort = loadPortFromRegistry();
  const orderedPorts = registryPort ? [registryPort, ...ports.filter((p) => p !== registryPort)] : ports;

  // 尝试连接已有 Chrome
  let info: ChromeConnectionInfo | null = null;
  if (!preferredPort || preferredPort === 0) {
    info = await findChromePort(orderedPorts);
  } else {
    info = await findChromePort([preferredPort]);
  }

  if (info) {
 // 连接已有 Chrome
   console.log(`[chrome] 接管已有 Chrome 调试端口 ${info.port}`);
    savePortToRegistry(info.port);
    const browser = await chromium.connect(info.wsUrl);
    cachedInstance = {
      browser,
      launchedByPlaywright: false,
      port: info.port,
      wsUrl: info.wsUrl,
    };
    return cachedInstance;
  }

 // 启动 Playwright 管理的 Chrome
  console.log(`[chrome] 未找到可用调试端口，启动独立 Chrome（端口 ${debugPort}）`);
  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless,
    args: [
      `--remote-debugging-port=${debugPort}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  };

  if (options.userDataDir) {
    (launchOptions as any).userDataDir = options.userDataDir;
  }

  const browser = await chromium.launch(launchOptions);
  savePortToRegistry(debugPort);

  cachedInstance = {
    browser,
    launchedByPlaywright: true,
    port: debugPort,
    wsUrl: "",
  };

  return cachedInstance;
}

/**
 * 获取当前活动页面
 */
export async function getActivePage(): Promise<Page | null> {
  const inst = await getChrome();
  const pages = inst.browser.contexts()[0]?.pages() || [];
  return pages[0] || null;
}

/**
 * 列出所有页面
 */
export async function listPages(): Promise<{ id: string; url: string; title: string }[]> {
  const inst = await getChrome();
  const pages: { id: string; url: string; title: string }[] = [];
  
  for (const ctx of inst.browser.contexts()) {
    for (const page of ctx.pages()) {
      pages.push({
        id: page.url(),
        url: page.url(),
        title: await page.title(),
      });
    }
  }
  
  return pages;
}

/**
 * 关闭 Chrome 实例
 */
export async function closeChrome(): Promise<void> {
  if (cachedInstance) {
    await cachedInstance.browser.close();
    cachedInstance = null;
  }
}
/**
 * Lazy Chrome init - logs to stderr for stdio mode.
 * Safe to call multiple times (getChrome has internal caching).
 */
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
