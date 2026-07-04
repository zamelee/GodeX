/**
 * Codex Browser Control - Service Worker (MV3)
 * Uses chrome.debugger (F12-level CDP access) to control tabs.
 * Connects to MCP server via WebSocket.
 */

const MCP_WS = "ws://localhost:9225/ext";
const RECONNECT_DELAY_MS = 2000;

let ws = null;
let connected = false;

function log(...args) {
  console.log("[Codex SW]", ...args);
}

function connect() {
  try {
    ws = new WebSocket(MCP_WS);
  } catch (e) {
    log("WS constructor failed:", e.message);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    log("Connected to MCP at", MCP_WS);
    connected = true;
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "exec") {
        const { id, action, args } = msg;
        try {
          const result = await dispatchAction(action, args || {});
          ws.send(JSON.stringify({ id, success: true, result }));
        } catch (err) {
          ws.send(JSON.stringify({ id, success: false, error: err.message }));
        }
      }
    } catch (e) {
      log("Message handling error:", e.message);
    }
  };

  ws.onclose = () => {
    log("Disconnected from MCP");
    connected = false;
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    log("WS error:", err.message || String(err));
  };
}

function scheduleReconnect() {
  setTimeout(connect, RECONNECT_DELAY_MS);
}

async function getTargetTabId(args) {
  if (args.tabId) return args.tabId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function ensureDebugger(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (e) {
    if (!String(e.message).includes("already attached")) {
      throw e;
    }
  }
}

async function cdp(tabId, method, params = {}) {
  await ensureDebugger(tabId);
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

async function dispatchAction(action, args) {
  const tabId = await getTargetTabId(args);
  if (!tabId) throw new Error("No active tab");

  switch (action) {
    case "ping":
      return { tabId, url: "", title: "", ready: true };

    case "navigate": {
      await cdp(tabId, "Page.enable");
      await cdp(tabId, "Page.navigate", { url: args.url });
      return "Navigated to " + args.url;
    }

    case "evaluate": {
      await cdp(tabId, "Runtime.enable");
      const r = await cdp(tabId, "Runtime.evaluate", {
        expression: args.js,
        returnByValue: true,
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.text + ": " + (r.exceptionDetails.exception?.description || ""));
      }
      return r.result.value;
    }

    case "screenshot": {
      await cdp(tabId, "Page.enable");
      const r = await cdp(tabId, "Page.captureScreenshot", { format: "png" });
      return "data:image/png;base64," + r.data;
    }

    case "click": {
      await cdp(tabId, "Runtime.enable");
      const expr = `(() => {
        const el = document.querySelector(${JSON.stringify(args.selector)});
        if (!el) return { error: "Element not found: " + ${JSON.stringify(args.selector)} };
        el.click();
        return { ok: true, tag: el.tagName };
      })()`;
      const r = await cdp(tabId, "Runtime.evaluate", { expression: expr, returnByValue: true });
      if (r.result.value?.error) throw new Error(r.result.value.error);
      return "Clicked " + (r.result.value?.tag || args.selector);
    }

    case "typeText": {
      await cdp(tabId, "Runtime.enable");
      const expr = `(() => {
        const el = document.querySelector(${JSON.stringify(args.selector)});
        if (!el) return { error: "Element not found: " + ${JSON.stringify(args.selector)} };
        el.focus();
        el.value = ${JSON.stringify(args.text || "")};
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, tag: el.tagName };
      })()`;
      const r = await cdp(tabId, "Runtime.evaluate", { expression: expr, returnByValue: true });
      if (r.result.value?.error) throw new Error(r.result.value.error);
      return "Typed into " + (r.result.value?.tag || args.selector);
    }

    case "getElementInfo": {
      await cdp(tabId, "Runtime.enable");
      const expr = `(() => {
        const el = document.querySelector(${JSON.stringify(args.selector)});
        if (!el) return { error: "Element not found" };
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          selector: ${JSON.stringify(args.selector)},
          tagName: el.tagName,
          text: el.textContent ? el.textContent.trim().slice(0, 200) : "",
          boundingBox: { x: box.x, y: box.y, width: box.width, height: box.height },
          visible: box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none",
        };
      })()`;
      const r = await cdp(tabId, "Runtime.evaluate", { expression: expr, returnByValue: true });
      if (r.result.value?.error) throw new Error(r.result.value.error);
      return r.result.value;
    }

    case "getAllInputs": {
      await cdp(tabId, "Runtime.enable");
      const expr = "Array.from(document.querySelectorAll('input, button, a, [role=button], select, textarea')).slice(0, 100).map(e => { const box = e.getBoundingClientRect(); const style = getComputedStyle(e); return { tag: e.tagName, id: e.id, name: e.name, type: e.type || '', placeholder: e.placeholder || '', text: e.textContent ? e.textContent.trim().slice(0, 50) : '', visible: box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' }; })";
      const r = await cdp(tabId, "Runtime.evaluate", { expression: expr, returnByValue: true });
      return r.result.value;
    }

    case "list_pages": {
      const tabs = await chrome.tabs.query({});
      return tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active }));
    }

    case "get_active_tab": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return { id: tab.id, url: tab.url, title: tab.title, active: true };
    }

    default:
      throw new Error("Unknown action: " + action);
  }
}

chrome.alarms.create("keepAlive", { periodInMinutes: 0.25 });
chrome.alarms.onAlarm.addListener(() => {
  if (!connected) connect();
});

connect();
log("Service worker ready, extension ID:", chrome.runtime.id);
