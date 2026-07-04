/**
 * 插件增强工具（需要 Chrome Extension 支持）
 * 无插件时自动降级
 */

import { getActivePage } from "../chrome.js";

export interface TabInfo {
  url: string;
  title: string;
  active: boolean;
}

/**
 * 获取当前焦点 Tab 信息（Extension 模式优先）
 */
export async function getActiveTab(): Promise<TabInfo> {
  const page = await getActivePage();
  if (!page) throw new Error("No active page");

  // 尝试从 Extension 消息通道获取
  const extInfo = await page.evaluate(() => {
    const el = document.querySelector("[data-codex-tab-info]");
    if (el) {
      try {
        return JSON.parse(el.getAttribute("data-codex-tab-info") || "{}");
      } catch {
        return null;
      }
    }
    return null;
  });

  if (extInfo && extInfo.url) {
    return {
      url: extInfo.url,
      title: extInfo.title || "",
      active: true,
    };
  }

  // Fallback: 直接用 Playwright 的当前 page
  return {
    url: page.url(),
    title: await page.title(),
    active: true,
  };
}

/**
 * 切换到指定标签页（通过 URL 匹配）
 */
export async function switchTab(urlPattern: string): Promise<string> {
  const inst = await import("../chrome.js").then((m) => m.ensureChrome());
  const browser = (await inst).browser;

  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      const pageUrl = page.url();
      if (pageUrl.includes(urlPattern) || urlPattern === pageUrl) {
        await page.bringToFront();
        return `Switched to tab: ${pageUrl}`;
      }
    }
  }

  throw new Error(`Tab matching ${urlPattern} not found`);
}

/**
 * 获取元素详情（通过 Extension 获取精确坐标）
 */
export async function getElementInfo(selector: string): Promise<unknown> {
  const page = await getActivePage();
  if (!page) throw new Error("No active page");

  const box = await page.locator(selector).boundingBox();
  const isVisible = await page.locator(selector).isVisible();

  return {
    selector,
    boundingBox: box,
    visible: isVisible,
    tagName: await page.locator(selector).evaluate((el) => el.tagName),
    text: await page.locator(selector).textContent(),
  };
}
