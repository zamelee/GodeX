/**
 * Extension-based browser control
 * Communicates with the Chrome extension via WebSocket (ws://localhost:9225/ext).
 */

import { extSend, extIsConnected } from "../ext-ws.js";

export async function extIsAvailable(): Promise<boolean> {
  return extIsConnected();
}

export async function extPing(): Promise<unknown> {
  return extSend("ping");
}

export async function extClick(selector: string): Promise<string> {
  return extSend("click", { selector }) as Promise<string>;
}

export async function extTypeText(selector: string, text: string): Promise<string> {
  return extSend("typeText", { selector, text }) as Promise<string>;
}

export async function extEvaluate(js: string): Promise<unknown> {
  return extSend("evaluate", { js });
}

export async function extGetElementInfo(selector: string): Promise<unknown> {
  return extSend("getElementInfo", { selector });
}

export async function extGetAllInputs(): Promise<unknown[]> {
  return extSend("getAllInputs", {}) as Promise<unknown[]>;
}

export async function extScrollIntoView(selector: string): Promise<string> {
  return extSend("scrollIntoView", { selector }) as Promise<string>;
}

export async function extNavigate(url: string): Promise<string> {
  return extSend("navigate", { url }) as Promise<string>;
}

export async function extScreenshot(): Promise<string> {
  return extSend("screenshot", {}) as Promise<string>;
}

export async function extListPages(): Promise<unknown[]> {
  return extSend("list_pages", {}) as Promise<unknown[]>;
}

export async function extGetActiveTab(): Promise<unknown> {
  return extSend("get_active_tab", {});
}
