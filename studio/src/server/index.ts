// Studio UI HTTP server on 56791
// Reads profiles.yaml, proxies to godex /v1/models, provides static HTML
// Configured via env: STUDIO_PROFILES, STUDIO_HTML, GODEX_BASE
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const GODEX_BASE = (typeof process !== "undefined" && process.env.GODEX_BASE) || "http://127.0.0.1:5678";
const PROFILES_PATH = (typeof process !== "undefined" && process.env.STUDIO_PROFILES)
	? resolve(process.env.STUDIO_PROFILES)
	: resolve(import.meta.dir, "../profiles.yaml");
const HTML_PATH = (typeof process !== "undefined" && process.env.STUDIO_HTML)
	? resolve(process.env.STUDIO_HTML)
	: resolve(import.meta.dir, "../public/index.html");
const PORT = 56791;

const HTML = `
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<title>GodeX Studio</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0f1117; color: #e6edf3; min-height: 100vh; display: flex; flex-direction: column; }
  header { background: #161b22; border-bottom: 1px solid #30363d; padding: 8px 16px; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 15px; font-weight: 600; color: #58a6ff; }
  header .status { font-size: 12px; color: #8b949e; }
  .cols { display: flex; flex: 1; overflow: hidden; }
  .col { border-right: 1px solid #21262d; overflow-y: auto; }
  .col-header { background: #161b22; padding: 8px 12px; font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #21262d; }
  .col-content { padding: 8px; }
  .logs-panel { background: #0d1117; flex: 1; overflow-y: auto; font-family: ui-monospace, monospace; font-size: 12px; }
  .logs-header { background: #161b22; padding: 6px 12px; border-top: 1px solid #30363d; display: flex; gap: 8px; align-items: center; }
  .logs-header span { font-size: 11px; color: #8b949e; }
  .log-entry { padding: 4px 12px; border-bottom: 1px solid #161b22; }
  .log-entry.error { background: rgba(248,81,73,.1); border-left: 3px solid #f85149; }
  .log-entry.info { border-left: 3px solid #58a6ff; }
  .log-entry.warn { border-left: 3px solid #d29922; }
  .log-entry.debug { border-left: 3px solid #8b949e; }
  .log-ts { color: #6e7681; font-size: 10px; }
  .log-msg { color: #c9d1d9; word-break: break-all; }
  .model-card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; cursor: pointer; }
  .model-card:hover { border-color: #58a6ff; }
  .model-card.active { border-color: #58a6ff; background: rgba(88,166,255,.08); }
  .model-card .name { font-size: 13px; font-weight: 600; color: #c9d1d9; }
  .model-card .meta { font-size: 11px; color: #8b949e; margin-top: 2px; }
  .params-form { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; font-size: 12px; align-items: center; padding: 8px; }
  .params-form label { color: #8b949e; }
  .params-form input, .params-form select { background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; padding: 4px 8px; font-size: 12px; width: 100%; }
  .params-form .span2 { grid-column: 1 / -1; }
  .btn { background: #238636; color: #fff; border: none; border-radius: 4px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
  .btn:hover { background: #2ea043; }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .error-box { background: rgba(248,81,73,.1); border: 1px solid #f85149; border-radius: 4px; padding: 8px; color: #f85149; font-size: 12px; margin: 8px; }
</style>
</head>
<body>
<header>
  <h1>GodeX Studio</h1>
  <span id="godex-status" class="status">godex: --</span>
</header>
<div class="cols">
  <div class="col" style="width: 220px; flex-shrink: 0">
    <div class="col-header">Provider / Model</div>
    <div class="col-content" id="models-list"></div>
  </div>
  <div class="col" style="flex: 1">
    <div class="col-header">Parameters</div>
    <div class="col-content">
      <div class="params-form" id="params-form">
        <label>Provider</label><select id="param-provider"><option value="minimax">MiniMax</option></select>
        <label>Temperature</label><input id="param-temperature" type="number" min="0" max="2" step="0.1" value="0.7"/>
        <label>Top P</label><input id="param-top_p" type="number" min="0" max="1" step="0.05" value="1.0"/>
        <label>Max Output</label><input id="param-max_output" type="number" min="1" max="65536" value="16384"/>
        <label>Stream</label><select id="param-stream"><option value="true">true</option><option value="false">false</option></select>
        <div class="span2" style="margin-top: 8px; display:flex; gap: 8px">
          <button class="btn" id="btn-apply">Apply &amp; Restart godex</button>
          <button class="btn" id="btn-save" style="background:#6e40c9">Save Profile</button>
        </div>
        <div id="param-save-msg" style="grid-column: 1 / -1; font-size:11px; color:#8b949e; margin-top: 4px;"></div>
      </div>
    </div>
  </div>
  <div class="col" style="width: 280px">
    <div class="col-header">Active Model</div>
    <div class="col-content" id="active-model" style="font-size: 13px"></div>
  </div>
</div>
<div class="logs-panel" id="logs-panel">
  <div class="logs-header">
    <span>Logs</span>
    <button class="btn" id="btn-refresh" style="background:#21262d; font-size: 11px; padding: 2px 8px;">Refresh</button>
    <button class="btn" id="btn-clear-logs" style="background:#21262d; font-size: 11px; padding: 2px 8px;">Clear</button>
  </div>
  <div id="logs-content"></div>
</div>
<script>
const GODEX = "http://127.0.0.1:5678";
let activeProvider = "minimax";
let activeModel = null;

function $(id) { return document.getElementById(id); }

async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}

async function checkGodex() {
  try {
    const health = await fetch(GODEX + "/health").then(r => r.json()).catch(() => null);
    const models = await fetch(GODEX + "/v1/models").then(r => r.json()).catch(() => null);
    $("godex-status").textContent = health
      ? "godex: " + health.providers.join(", ")
      : "godex: offline";
    if (models && models.data) {
      renderModels(models.data, activeProvider);
    }
  } catch(e) {
    $("godex-status").textContent = "godex: " + e.message;
  }
}

function renderModels(list, current) {
  const el = $("models-list");
  const byProvider = {};
  for (const m of list) {
    const parts = m.id.split("/");
    const provider = parts[0] || "unknown";
    if (!byProvider[provider]) byProvider[provider] = [];
    byProvider[provider].push(m);
  }
  el.innerHTML = "";
  for (const [p, ms] of Object.entries(byProvider)) {
    const g = document.createElement("div");
    g.innerHTML = "<div style=\'font-size:11px;color:#8b949e;padding:4px 0 2px\'>" + p + "</div>";
    for (const m of ms) {
      const card = document.createElement("div");
      card.className = "model-card" + (m.id === current ? " active" : "");
      card.innerHTML = "<div class=\'name\'>" + m.id + "</div><div class=\'meta\'>" + (m.owned_by || "") + "</div>";
      card.onclick = () => { activeModel = m.id; activeProvider = p; renderModels(list, m.id); };
      g.appendChild(card);
    }
    el.appendChild(g);
  }
}

$("btn-save")?.addEventListener("click", async () => {
  const msg = $("param-save-msg");
  try {
    await api("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temperature: parseFloat($("param-temperature")?.value), top_p: parseFloat($("param-top_p")?.value), max_output_tokens: parseInt($("param-max_output")?.value), stream: $("param-stream")?.value === "true" })
    });
    msg.textContent = "Profiles saved. Restart godex to apply.";
    msg.style.color = "#3fb950";
  } catch(e) {
    msg.textContent = "Error: " + e.message;
    msg.style.color = "#f85149";
  }
});

$("btn-apply")?.addInit("click", () => {
  $("param-save-msg").textContent = "Edit config.yaml manually, then restart godex.";
});

async function loadLogs() {
  try {
    const logs = await api("/api/logs");
    const el = $("logs-content");
    el.innerHTML = "";
    for (const l of (logs || []).slice(0, 50)) {
      const div = document.createElement("div");
      const level = l.event_name?.includes("error") ? "error" : l.event_name?.includes("warn") ? "warn" : l.event_name?.includes("debug") ? "debug" : "info";
      div.className = "log-entry " + level;
      const ts = new Date(l.created_at * 1000).toISOString().replace("T", " ").slice(0, 19);
      div.innerHTML = "<span class=\'log-ts\'>" + ts + "</span> <span class=\'log-msg\'>" + escapeHtml(l.event_name || "") + "</span>";
      el.appendChild(div);
    }
  } catch(e) {
    $("logs-content").innerHTML = "<div class=\'log-entry error\'>" + escapeHtml(e.message) + "</div>";
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

$("btn-refresh")?.addEventListener("click", loadLogs);
$("btn-clear-logs")?.addEventListener("click", () => { $("logs-content").innerHTML = ""; });

checkGodex();
setInterval(checkGodex, 8000);
setInterval(loadLogs, 5000);
</script>
</body>
</html>
`;

export { HTML, PORT, PROFILES_PATH };
export function createStudioHandler() { return async (req: Request) => new Response(HTML, { headers: { "Content-Type": "text/html" } }); }
