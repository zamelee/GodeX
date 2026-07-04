/**
 * 基础浏览器工具（无需 Chrome Extension）
 */

import { ensureChrome, listPages } from "../chrome.js";

async function getOrCreatePage() {
  const inst = await ensureChrome();
  const context = inst.browser.contexts()[0] || await inst.browser.newContext();
  const pages = context.pages();
  if (pages.length > 0) return pages[0];
  return context.newPage();
}

export async function openUrl(url: string): Promise<string> {
  const inst = await ensureChrome();
  const context = inst.browser.contexts()[0] || await inst.browser.newContext();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  return `Opened ${url} in new tab`;
}

export async function navigate(url: string): Promise<string> {
  const page = await getOrCreatePage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  return `Navigated to ${url}`;
}

export async function screenshot(): Promise<string> {
  const page = await getOrCreatePage();
  const buffer = await page.screenshot({ type: "png", timeout: 15000 });
  return "data:image/png;base64," + Buffer.from(buffer).toString("base64");
}

export async function click(selector: string): Promise<string> {
  const page = await getOrCreatePage();
  try {
    await page.click(selector, { timeout: 10000 });
    return `Clicked ${selector}`;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Click failed for "${selector}": element not found or not interactable. ${msg}`;
  }
}

export async function typeText(selector: string, text: string): Promise<string> {
  const page = await getOrCreatePage();
  try {
    await page.locator(selector).click({ timeout: 5000 });
    await page.keyboard.type(text, { delay: 50 });
  } catch {
    try {
      await page.fill(selector, text, { timeout: 10000 });
    } catch (e2: unknown) {
      const msg2 = e2 instanceof Error ? e2.message : String(e2);
      return `typeText failed for "${selector}": element not found or not interactable. ${msg2}`;
    }
  }
  return `Typed "${text}" into ${selector}`;
}

export async function getText(selector: string): Promise<string> {
  const page = await getOrCreatePage();
  return await page.locator(selector).textContent() || "";
}

export async function waitFor(selector: string, timeout = 10000): Promise<string> {
  const page = await getOrCreatePage();
  const count = await page.locator(selector).count();
  if (count > 0) return `Element ${selector} found (${count})`;
  try {
    await page.waitForSelector(selector, { timeout, state: "attached" });
    return `Element ${selector} appeared`;
  } catch (e: unknown) {
    return `Element ${selector} not found within ${timeout}ms`;
  }
}

export async function evaluate(js: string): Promise<unknown> {
  const page = await getOrCreatePage();
  return page.evaluate(js);
}

export async function scrollTo(selector: string): Promise<string> {
  const page = await getOrCreatePage();
  await page.locator(selector).scrollIntoViewIfNeeded({ timeout: 10000 });
  return `Scrolled to ${selector}`;
}

export async function listAllPages() {
  return listPages();
}
