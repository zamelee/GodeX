/**
 * 插件增强工具（需要 Chrome Extension 支持）
 * 优先使用 Extension（更精确），无插件时自动降级到 Playwright
 */

import { ensureChrome, listPages } from "../chrome.js";
import { extIsAvailable, extClick, extTypeText, extEvaluate, extGetElementInfo, extGetAllInputs, extScrollIntoView } from "./ext.js";

async function getOrCreatePage() {
  const inst = await ensureChrome();
  const context = inst.browser.contexts()[0] || await inst.browser.newContext();
  const pages = context.pages();
  if (pages.length > 0) return pages[0];
  return context.newPage();
}

export interface TabInfo {
  url: string;
  title: string;
  active: boolean;
}

/**
 * 获取当前焦点 Tab 信息
 */
export async function getActiveTab(): Promise<TabInfo> {
  const extOk = await extIsAvailable();
  if (extOk) {
    try {
      const info = await extEvaluate("({url: location.href, title: document.title})") as { url: string; title: string };
      return { url: info.url, title: info.title, active: true };
    } catch { /* fall through */ }
  }
  const page = await getOrCreatePage();
  return { url: page.url(), title: await page.title(), active: true };
}

/**
 * 切换到指定标签页（通过 URL 匹配）
 */
export async function switchTab(urlPattern: string): Promise<string> {
  const inst = await ensureChrome();
  for (const ctx of inst.browser.contexts()) {
    for (const page of ctx.pages()) {
      const pageUrl = page.url();
      if (pageUrl.includes(urlPattern) || urlPattern === pageUrl) {
        await page.bringToFront();
        return "Switched to tab: " + pageUrl;
      }
    }
  }
  return "Tab matching \"" + urlPattern + "\" not found";
}

/**
 * 获取元素详情 - 优先 extension（精确），降级 Playwright
 */
export async function getElementInfo(selector: string): Promise<unknown> {
  const extOk = await extIsAvailable();
  if (extOk) {
    try {
      return await extGetElementInfo(selector);
    } catch { /* fall through */ }
  }
  const page = await getOrCreatePage();
  try {
    const box = await page.locator(selector).boundingBox();
    const isVisible = await page.locator(selector).isVisible();
    return {
      selector,
      boundingBox: box,
      visible: isVisible,
      tagName: await page.locator(selector).evaluate((el) => el.tagName),
      text: await page.locator(selector).textContent(),
    };
  } catch (e: unknown) {
    return "getElementInfo failed for \"" + selector + "\": " + (e instanceof Error ? e.message : String(e));
  }
}

/**
 * Extension 专用操作（返回 null 表示 extension 不可用，调用方应 fallback）
 */
export async function extClickIfAvailable(selector: string): Promise<string | null> {
  if (!(await extIsAvailable())) return null;
  try { return await extClick(selector); } catch { return null; }
}

export async function extTypeTextIfAvailable(selector: string, text: string): Promise<string | null> {
  if (!(await extIsAvailable())) return null;
  try { return await extTypeText(selector, text); } catch { return null; }
}

export async function extGetAllInputsIfAvailable(): Promise<unknown[] | null> {
  if (!(await extIsAvailable())) return null;
  try { return await extGetAllInputs(); } catch { return null; }
}

export async function extScrollIfAvailable(selector: string): Promise<string | null> {
  if (!(await extIsAvailable())) return null;
  try { return await extScrollIntoView(selector); } catch { return null; }
}
