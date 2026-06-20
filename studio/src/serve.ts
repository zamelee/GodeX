// GodeX Studio HTTP Server — Layer 4
// Listens on :56791, proxies godex, serves UI, exposes /api/logs and /api/profiles.
// Usage:
//   bun run src/serve.ts
//   GODEX_BASE=http://127.0.0.1:5679 STUDIO_PORT=56791 bun run src/serve.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const GODEX_BASE = process.env.GODEX_BASE ?? "http://127.0.0.1:5678";
const PROFILES_PATH = process.env.STUDIO_PROFILES
	? resolve(process.env.STUDIO_PROFILES)
	: resolve(import.meta.dirname, "../profiles.json");
const PORT = Number(process.env.STUDIO_PORT ?? "56791");
const TRACE_DB_PATH = process.env.GODEX_DATA
	? resolve(process.env.GODEX_DATA, "trace.db")
	: resolve(import.meta.dirname, "../../godex-new/trace.db");

// ─── Static HTML ─────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<title>GodeX Studio</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #0f1117; color: #e6edf3; min-height: 100vh; display: flex; flex-direction: column; }
header { background: #161b22; border-bottom: 1px solid #30363d; padding: 8px 16px; display: flex; align-items: center; gap: 16px; }
header h1 { font-size: 15px; font-weight: 600; color: #58a6ff; }
header .status { font-size: 12px; color: #8b949e; }
header .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #f85149; margin-right: 6px; vertical-align: middle; }
header .dot.ok { background: #3fb950; }
.cols { display: flex; flex: 1; overflow: hidden; min-height: 0; }
.col { border-right: 1px solid #21262d; overflow-y: auto; }
.col-header { background: #161b22; padding: 8px 12px; font-size: 11px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #21262d; position: sticky; top: 0; z-index: 1; }
.col-content { padding: 8px; }
.model-card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; cursor: pointer; }
.model-card:hover { border-color: #58a6ff; }
.model-card.active { border-color: #58a6ff; background: rgba(88,166,255,.08); }
.model-card .name { font-size: 13px; font-weight: 600; color: #c9d1d9; }
.model-card .meta { font-size: 11px; color: #8b949e; margin-top: 2px; }
.params-form { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; font-size: 12px; align-items: center; padding: 8px 8px 0; }
.params-form label { color: #8b949e; }
.params-form input, .params-form select { background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; padding: 5px 8px; font-size: 12px; width: 100%; }
.params-form .actions { grid-column: 1 / -1; display: flex; gap: 8px; margin-top: 4px; }
.btn { background: #238636; color: #fff; border: none; border-radius: 4px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.btn:hover { background: #2ea043; }
.btn.sec { background: #21262d; }
.btn.sec:hover { background: #30363d; }
.btn.info { background: #6e40c9; }
.btn.info:hover { background: #8957e5; }
.msg { font-size: 11px; color: #8b949e; margin-top: 4px; }
.msg.ok { color: #3fb950; }
.msg.err { color: #f85149; }
.logs-panel { background: #0d1117; height: 180px; display: flex; flex-direction: column; flex-shrink: 0; border-top: 1px solid #30363d; }
.logs-header { background: #161b22; padding: 4px 12px; display: flex; gap: 8px; align-items: center; }
.logs-header span { font-size: 11px; color: #8b949e; }
.logs-body { flex: 1; overflow-y: auto; }
.log-entry { padding: 3px 12px; border-bottom: 1px solid #161b22; font-family: ui-monospace, monospace; font-size: 11px; display: flex; gap: 8px; }
.log-entry.error { background: rgba(248,81,73,.08); border-left: 3px solid #f85149; }
.log-entry.warn { border-left: 3px solid #d29922; }
.log-entry.ok { border-left: 3px solid #3fb950; }
.log-entry .ts { color: #6e7681; flex-shrink: 0; }
.log-entry .msg { color: #c9d1d9; word-break: break-all; margin: 0; }
</style>
</head>
<body>
<header>
  <h1>GodeX Studio</h1>
  <span class="status"><span class="dot" id="dot"></span><span id="status-text">checking...</span></span>
  <span style="font-size:11px;color:#6e7681;margin-left:auto">Studio :56791 &rarr; GodeX ${GODEX_BASE}</span>
</header>
<div class="cols">
  <div class="col" style="width:220px;flex-shrink:0">
    <div class="col-header">Provider / Model</div>
    <div class="col-content" id="models-list"></div>
  </div>
  <div class="col" style="flex:1">
    <div class="col-header">Parameters</div>
    <div class="col-content">
      <div class="params-form">
        <label>Provider</label>
        <select id="param-provider"><option value="minimax">MiniMax</option></select>
        <label>Temperature</label><input id="param-temperature" type="number" min="0" max="2" step="0.1" value="0.7"/>
        <label>Top P</label><input id="param-top_p" type="number" min="0" max="1" step="0.05" value="1.0"/>
        <label>Max Output</label><input id="param-max_output" type="number" min="1" max="65536" value="16384"/>
        <label>Stream</label>
        <select id="param-stream">
          <option value="true">true (SSE)</option>
          <option value="false">false (sync)</option>
        </select>
        <div class="actions">
          <button class="btn" id="btn-save">Save Profile</button>
          <button class="btn info" id="btn-apply">Apply &amp; Restart GodeX</button>
          <button class="btn sec" id="btn-reset">Reset</button>
        </div>
        <div class="msg" id="param-msg"></div>
      </div>
    </div>
  </div>
  <div class="col" style="width:260px">
    <div class="col-header">Active Model</div>
    <div class="col-content" id="active-model">
      <div class="model-card" style="cursor:default"><div class="name" style="color:#8b949e">No model selected</div></div>
    </div>
  </div>
</div>
<div class="logs-panel">
  <div class="logs-header">
    <span>Logs</span>
    <button class="btn sec" id="btn-refresh" style="padding:2px 8px;font-size:11px">Refresh</button>
    <button class="btn sec" id="btn-clear" style="padding:2px 8px;font-size:11px">Clear</button>
  </div>
  <div class="logs-body" id="logs-content"></div>
</div>
<script>
const GODEX = "${GODEX_BASE}";
let activeModel = null;
let activeProvider = null;

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function setStatus(text, ok) { $("status-text").textContent = text; $("dot").className = "dot" + (ok ? " ok" : ""); }
function log(msg, type) {
  const el = $("logs-content");
  const d = document.createElement("div");
  d.className = "log-entry " + (type || "ok");
  d.innerHTML = "<span class=ts>" + new Date().toTimeString().slice(0,8) + "</span><span class=msg>" + esc(msg) + "</span>";
  el.insertBefore(d, el.firstChild);
  if (el.children.length > 80) el.removeChild(el.lastChild);
}
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(path + " HTTP " + r.status);
  return r.json().catch(() => ({}));
}
async function checkGodex() {
  try {
    const [h, m] = await Promise.all([
      fetch(GODEX + "/health").then(r => r.json()),
      fetch(GODEX + "/v1/models").then(r => r.json()),
    ]);
    setStatus("godex: " + (h.providers || []).join(", "), true);
    renderModels(m.data || []);
  } catch(e) { setStatus("godex offline: " + e.message, false); }
}
function renderModels(list) {
  const el = $("models-list");
  const byP = {};
  for (const x of list) { const p = (x.id || "").split("/")[0] || "unknown"; (byP[p] = byP[p] || []).push(x); }
  el.innerHTML = "";
  for (const [p, ms] of Object.entries(byP)) {
    const g = document.createElement("div");
    g.innerHTML = "<div style=\'font-size:10px;color:#6e7681;padding:4px 0 2px 4px\'>" + esc(p) + "</div>";
    for (const x of ms) {
      const c = document.createElement("div");
      c.className = "model-card" + (x.id === activeModel ? " active" : "");
      c.innerHTML = "<div class=name>" + esc(x.id) + "</div>";
      c.onclick = () => {
        activeModel = x.id; activeProvider = p;
        $("param-provider").value = p;
        $("active-model").innerHTML = "<div class=model-card><div class=name>" + esc(x.id) + "</div><div class=meta>Selected</div></div>";
        localStorage.setItem("studio:active", x.id);
        renderModels(list);
        log("Selected: " + x.id);
        loadProfile(x.id);
      };
      g.appendChild(c);
    }
    el.appendChild(g);
  }
  const saved = localStorage.getItem("studio:active");
  if (saved && !activeModel) {
    activeModel = saved; activeProvider = saved.split("/")[0];
    $("param-provider").value = activeProvider;
    $("active-model").innerHTML = "<div class=model-card><div class=name>" + esc(saved) + "</div><div class=meta>Selected</div></div>";
    loadProfile(saved);
  }
}
async function loadProfile(model) {
  try {
    const p = await api("/api/profiles?model=" + encodeURIComponent(model || ""));
    if (p.temperature !== undefined) $("param-temperature").value = p.temperature;
    if (p.top_p !== undefined) $("param-top_p").value = p.top_p;
    if (p.max_output_tokens !== undefined) $("param-max_output").value = p.max_output_tokens;
    if (p.stream !== undefined) $("param-stream").value = String(p.stream);
  } catch {}
}
$("btn-save").addEventListener("click", async () => {
  const msg = $("param-msg");
  try {
    await api("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: activeModel || "", temperature: +$("param-temperature").value, top_p: +$("param-top_p").value, max_output_tokens: +$("param-max_output").value, stream: $("param-stream").value === "true" })
    });
    msg.textContent = "Profile saved for " + (activeModel || "default"); msg.className = "msg ok";
    log("Profile saved: " + (activeModel || "default"));
  } catch(e) { msg.textContent = e.message; msg.className = "msg err"; log(e.message, "error"); }
});
$("btn-reset").addEventListener("click", () => {
  $("param-temperature").value = "0.7"; $("param-top_p").value = "1.0"; $("param-max_output").value = "16384"; $("param-stream").value = "true";
  $("param-msg").textContent = "";
});
$("btn-apply").addEventListener("click", () => {
  $("param-msg").textContent = "Edit config.yaml, then restart godex to apply.";
  $("param-msg").className = "msg";
  log("Apply requires godex restart");
});
$("btn-refresh").addEventListener("click", () => { $("logs-content").innerHTML = ""; log("cleared"); });
$("btn-clear").addEventListener("click", () => { $("logs-content").innerHTML = ""; });
async function loadLogs() {
  try {
    const logs = await api("/api/logs");
    const el = $("logs-content");
    el.innerHTML = "";
    for (const l of (logs || []).slice(0, 60)) {
      const d = document.createElement("div");
      const lvl = l.event_name?.includes("error") ? "error" : l.event_name?.includes("warn") ? "warn" : "ok";
      d.className = "log-entry " + lvl;
      d.innerHTML = "<span class=ts>" + (l.created_at ? new Date(l.created_at * 1000).toTimeString().slice(0,8) : "--:--:--") + "</span><span class=msg>" + esc(l.event_name || "?") + "</span>";
      el.appendChild(d);
    }
  } catch(e) { log("logs: " + e.message, "error"); }
}
checkGodex(); loadLogs();
setInterval(checkGodex, 8000);
setInterval(loadLogs, 6000);
</script>
</body>
</html>`;

// ─── Profiles Persistence ────────────────────────────────────────────────────

interface ProfileEntry {
	temperature: number;
	top_p: number;
	max_output_tokens: number;
	stream: boolean;
}

interface ProfilesData {
	models: Record<string, ProfileEntry>;
}

function loadProfiles(): ProfilesData {
	try {
		if (existsSync(PROFILES_PATH)) {
			return JSON.parse(readFileSync(PROFILES_PATH, "utf-8")) as ProfilesData;
		}
	} catch {}
	return { models: {} };
}

function saveProfiles(data: ProfilesData): void {
	writeFileSync(PROFILES_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// ─── Trace DB Reader (Bun built-in SQLite) ───────────────────────────────────

interface TraceLog {
	created_at: number;
	event_name: string;
	request_id: string;
	provider?: string;
	model?: string;
	message?: string;
}

async function queryTraceLogs(limit = 60): Promise<TraceLog[]> {
	try {
		const { DatabaseSync } = await import("bun");
		if (!existsSync(TRACE_DB_PATH)) return [];
		const db = new DatabaseSync(TRACE_DB_PATH);
		const rows = db.query(
			`SELECT created_at, event_name, request_id, provider, model, message
       FROM trace_events ORDER BY created_at DESC LIMIT ?`,
		).all(limit) as TraceLog[];
		db.close();
		return rows;
	} catch {
		return [];
	}
}

// ─── Bun.serve ───────────────────────────────────────────────────────────────

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);
		const path = url.pathname;

		if (req.method === "OPTIONS") {
			return new Response(null, { headers: { ...CORS } });
		}

		const jsonHeaders = { "Content-Type": "application/json", ...CORS };

		// Serve UI
		if (path === "/" || path === "/index.html") {
			return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8", ...CORS } });
		}

		// Proxy: /health
		if (path === "/health") {
			try {
				const r = await fetch(GODEX_BASE + "/health", { signal: AbortSignal.timeout(3000) });
				const body = await r.text();
				return new Response(body, { headers: { "Content-Type": "application/json", ...CORS } });
			} catch (e: unknown) {
				return new Response(JSON.stringify({ error: String((e as Error).message) }), { status: 502, headers: jsonHeaders });
			}
		}

		// Proxy: /v1/models
		if (path === "/v1/models") {
			try {
				const r = await fetch(GODEX_BASE + "/v1/models", { signal: AbortSignal.timeout(5000) });
				const body = await r.text();
				return new Response(body, { headers: { "Content-Type": "application/json", ...CORS } });
			} catch (e: unknown) {
				return new Response(JSON.stringify({ error: String((e as Error).message) }), { status: 502, headers: jsonHeaders });
			}
		}

		// API: GET /api/logs
		if (path === "/api/logs" && req.method === "GET") {
			const logs = await queryTraceLogs(60);
			return new Response(JSON.stringify(logs), { headers: jsonHeaders });
		}

		// API: GET /api/profiles?model=xxx
		if (path === "/api/profiles" && req.method === "GET") {
			const model = url.searchParams.get("model") || "";
			const profiles = loadProfiles();
			const entry = model ? (profiles.models[model] ?? profiles.models["*"]) : profiles.models["*"];
			return new Response(JSON.stringify(entry ?? {}), { headers: jsonHeaders });
		}

		// API: POST /api/profiles
		if (path === "/api/profiles" && req.method === "POST") {
			try {
				const body = await req.json() as { model?: string; temperature?: number; top_p?: number; max_output_tokens?: number; stream?: boolean };
				const profiles = loadProfiles();
				const key = body.model || "*";
				profiles.models = profiles.models ?? {};
				profiles.models[key] = {
					temperature: body.temperature ?? 0.7,
					top_p: body.top_p ?? 1.0,
					max_output_tokens: body.max_output_tokens ?? 16384,
					stream: body.stream ?? true,
				};
				saveProfiles(profiles);
				return new Response(JSON.stringify({ ok: true, model: key }), { headers: jsonHeaders });
			} catch (e: unknown) {
				return new Response(JSON.stringify({ error: String((e as Error).message) }), { status: 400, headers: jsonHeaders });
			}
		}

		return new Response("Not found", { status: 404 });
	},
});

console.log(`GodeX Studio listening on http://127.0.0.1:${PORT}`);
console.log(`  -> GodeX backend : ${GODEX_BASE}`);
console.log(`  -> Profiles file  : ${PROFILES_PATH}`);
console.log(`  -> Trace DB       : ${TRACE_DB_PATH}`);
