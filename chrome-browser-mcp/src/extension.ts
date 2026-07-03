/**
 * Chrome Extension 消息通道解析器
 * 
 * 方案 1（推荐）：Extension 通过 CDP Runtime.evaluate() 注入消息
 *  -> MCP Server 监听 CDP DOM 事件检测消息
 * 
 * 方案 2（备选）：Extension 发 HTTP POST 到独立端点
 *  -> MCP Server 提供 /extension 路由
 */

import type { Page } from "playwright";

export interface ExtensionMessage {
  type: "codex_tab_info" | "codex_element_hover" | "codex_element_click";
  url?: string;
  title?: string;
  selector?: string;
  x?: number;
  y?: number;
}

let lastTabInfo: ExtensionMessage | null = null;
let lastHoverInfo: ExtensionMessage | null = null;

/**
 * 从页面 DOM 中读取 Extension 注入的消息（方案 1 降级）
 * 适用于 Extension 无法通过 CDP 直接通讯的场景
 */
export async function readMessageFromDOM(page: Page): Promise<ExtensionMessage | null> {
  // 尝试读取注入的 DOM 标记
  try {
    const el = page.locator("[data-codex-mcp-msg]");
    if ((await el.count()) > 0) {
      const raw = await el.first().getAttribute("data-codex-mcp-msg");
      if (raw) {
        return JSON.parse(raw) as ExtensionMessage;
      }
    }
  } catch {
    // DOM 读取失败，正常
  }
  return null;
}

/**
 * 设置 Extension 消息（当 MCP Server 作为 Extension 端点时调用）
 * 方案 2
 */
export function setExtensionMessage(msg: ExtensionMessage): void {
  if (msg.type === "codex_tab_info") {
    lastTabInfo = msg;
  } else if (msg.type === "codex_element_hover" || msg.type === "codex_element_click") {
    lastHoverInfo = msg;
  }
}

/**
 * 获取最新的 Tab 信息
 */
export function getLastTabInfo(): ExtensionMessage | null {
  return lastTabInfo;
}

/**
 * 获取最新的 Hover/Click 元素信息
 */
export function getLastElementInfo(): ExtensionMessage | null {
  return lastHoverInfo;
}