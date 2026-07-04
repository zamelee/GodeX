/**
 * 基础浏览器工具（无需 Chrome Extension）
 */

import { ensureChrome, getActivePage, listPages } from "../chrome.js";

export async function openUrl(url: string): Promise<string> {
  const inst = await ensureChrome();
  const context = inst.browser.contexts()[0] || await inst.browser.newContext();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  return `Opened ${url} in new tab`;
}

export async function navigate(url: string): Promise<string> {
  const page = await getActivePage();
  if (!page) throw new Error("No active page");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  return `Navigated to ${url}`;
}

export async function screenshot(): Promise<string> {
  const page = await getActivePage();
  if (!page) throw new Error("No active page");
  const buffer = await page.screenshot({ type: "png" });
  const base64 = Buffer.from(buffer).toString("base64");
  return "data:image/png;base64," + base64;
}

export async function click(selector: string): Promise<string> {
  const page = await getActivePage();
  if (!page) throw new Error("No active page");
  await page.click(selector, { timeout: 10000 });
  return `Clicked ${selector}`;
}

export async function typeText(selector: string, text: string): Promise<string> {
  const page = await getActivePage();
  if (!page) throw new Error("No active page");
  await page.fill(selector, text);
  return `Typed "${text}" into ${selector}`;
}

export async function getText(selector: string): Promise<string> {
  const page = await getActivePage();
  if (!page) throw new Error("No active page");
  const el = page.locator(selector);
  return await el.textContent() || "";
}

export async function waitFor(selector: string, timeout = 10000): Promise<string> {
  const page = await getActivePage();
  if (!page) throw new Error("No active page");
  await page.waitForSelector(selector, { timeout });
  return `Element ${selector} appeared`;
}

export async function evaluate(js: string): Promise<unknown> {
  const page = await getActivePage();
  if (!page) throw new Error("No active page");
  return await page.evaluate(js);
}

export async function scrollTo(selector: string): Promise<string> {
  const page = await getActivePage();
  if (!page) throw new Error("No active page");
  await page.locator(selector).scrollIntoViewIfNeeded();
  return `Scrolled to ${selector}`;
}

export async function listAllPages() {
  return listPages();
}
