/**
 * Codex Browser Control - Page Inject Script
 * Auto-injected via CDP Page.addScriptToEvaluateOnNewDocument.
 * Polls MCP server for commands, executes DOM ops, reports results.
 */

const MCP_BASE = "http://localhost:9224";
const POLL_MS = 1500;

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
}

function updateTabInfo() {
  const el = document.getElementById("__codex_tab_marker__");
  if (el) {
    el.setAttribute("data-codex-tab-info", JSON.stringify({
      url: location.href, title: document.title, ready: true,
    }));
  } else {
    injectTabInfo();
  }
}

injectTabInfo();

function domAction(action, args) {
  switch (action) {
    case "click": {
      const el = document.querySelector(args.selector);
      if (!el) return { error: "Element not found: " + args.selector };
      el.click();
      return "Clicked " + el.tagName;
    }
    case "typeText": {
      const el = document.querySelector(args.selector);
      if (!el) return { error: "Element not found: " + args.selector };
      el.focus();
      el.value = args.text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return "Typed into " + el.tagName;
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
        text: el.textContent ? el.textContent.trim().slice(0, 200) : "",
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
          text: e.textContent ? e.textContent.trim().slice(0, 50) : "",
          visible: box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none",
        };
      });
    }
    case "scrollIntoView": {
      const el = document.querySelector(args.selector);
      if (!el) return { error: "Element not found: " + args.selector };
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return "Scrolled to " + el.tagName;
    }
    case "ping": {
      return { url: location.href, title: document.title, ready: true };
    }
    default:
      return { error: "Unknown action: " + action };
  }
}

let lastCmdId = "";

async function pollAndExecute() {
  try {
    const resp = await fetch(MCP_BASE + "/ext/poll", { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return;
    const data = await resp.json();
    const cmds = data.commands || [];
    for (const cmd of cmds) {
      if (cmd.id === lastCmdId) continue;
      lastCmdId = cmd.id;
      const result = domAction(cmd.action, cmd.args || {});
      try {
        await fetch(MCP_BASE + "/ext/result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: cmd.id, success: !result.error, result: result.error ? undefined : result, error: result.error }),
          signal: AbortSignal.timeout(3000),
        });
      } catch {}
    }
  } catch {}
}

setInterval(pollAndExecute, POLL_MS);
pollAndExecute();

setInterval(updateTabInfo, 3000);

console.log("[Codex Inject] Loaded on " + location.href);
