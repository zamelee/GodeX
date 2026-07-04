/**
 * Codex Browser Control - Content Script
 * Injects into every page. Polls MCP server for commands, executes DOM ops, returns results.
 * No extra ports needed — content script can fetch localhost:9224 directly.
 */

const MCP_BASE = "http://localhost:9224";
const POLL_MS = 2000;

// Inject tab info marker so Playwright MCP can read it as fallback
function injectTabInfo() {
  const el = document.createElement("div");
  el.id = "__codex_tab_marker__";
  el.setAttribute("data-codex-tab-info", JSON.stringify({
    url: location.href,
    title: document.title,
    ready: true,
  }));
  el.style.cssText = "display:none !important;";
  (document.body || document.documentElement).appendChild(el);
  const update = () => el.setAttribute("data-codex-tab-info", JSON.stringify({
    url: location.href, title: document.title, ready: true,
  }));
  new MutationObserver(update).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", update);
}

injectTabInfo();

// ── DOM operation handlers ────────────────────────────────────────────────────

function domAction(action, args) {
  switch (action) {
    case "click": {
      const el = document.querySelector(args.selector);
      if (!el) return { error: "Element not found: " + args.selector };
      el.click();
      return el.tagName;
    }
    case "typeText": {
      const el = document.querySelector(args.selector);
      if (!el) return { error: "Element not found: " + args.selector };
      el.focus();
      el.value = args.text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.tagName;
    }
    case "evaluate": {
      try { return eval(args.js); } catch (e) { return { error: e.message }; }
    }
    case "getElementInfo": {
      const el = document.querySelector(args.selector);
      if (!el) return { error: "Element not found: " + args.selector };
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        selector: args.selector,
        tagName: el.tagName,
        text: el.textContent?.trim().slice(0, 200),
        boundingBox: { x: box.x, y: box.y, width: box.width, height: box.height },
        visible: box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none",
      };
    }
    case "getAllInputs": {
      return Array.from(document.querySelectorAll("input, button, a, [role=button], select, textarea")).slice(0, 100).map(e => {
        const box = e.getBoundingClientRect();
        const style = getComputedStyle(e);
        return {
          tag: e.tagName,
          id: e.id,
          name: e.name,
          type: e.type || "",
          placeholder: e.placeholder || "",
          text: e.textContent?.trim().slice(0, 50),
          visible: box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none",
        };
      });
    }
    case "scrollIntoView": {
      const el = document.querySelector(args.selector);
      if (!el) return { error: "Element not found: " + args.selector };
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return el.tagName;
    }
    case "ping": {
      return { url: location.href, title: document.title, ready: true };
    }
    default:
      return { error: "Unknown action: " + action };
  }
}

// ── Polling loop ──────────────────────────────────────────────────────────────

let lastCmdId = "";

async function pollAndExecute() {
  try {
    // Fetch pending commands from MCP server
    const resp = await fetch(MCP_BASE + "/ext/poll", {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return;
    const { commands } = await resp.json();
    if (!commands || commands.length === 0) return;

    for (const cmd of commands) {
      if (cmd.id === lastCmdId) continue;
      lastCmdId = cmd.id;
      const result = domAction(cmd.action, cmd.args || {});
      // Report result back to MCP server
      try {
        await fetch(MCP_BASE + "/ext/result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: cmd.id, success: !result?.error, result, error: result?.error }),
          signal: AbortSignal.timeout(3000),
        });
      } catch {}
    }
  } catch {}
}

// Start polling
setInterval(pollAndExecute, POLL_MS);
pollAndExecute(); // run immediately

// Also listen for messages from service worker
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const { action, args } = msg;
  if (!action) { sendResponse({ success: false, error: "no action" }); return true; }
  const result = domAction(action, args);
  sendResponse({ success: !result?.error, result, error: result?.error });
  return true;
});

console.log("[Codex Extension] Content script loaded on", location.href);
