// GodeX Studio — Layer 4 UI Server
import { existsSync, readFileSync as fs_read, writeFileSync as fs_write } from "node:fs";
import { resolve } from "node:path";
import { spawn as cp_spawn, execSync } from "node:child_process";

const GODEX_BASE = process.env.GODEX_BASE ?? "http://127.0.0.1:5678";
const PORT = Number(process.env.STUDIO_PORT ?? "56791");
const TRACE_DB_PATH = process.env.GODEX_DATA
  ? resolve(process.env.GODEX_DATA, "trace.db")
  : resolve(import.meta.dirname ?? ".", "../../godex-new/data/trace.db");
const GODEX_CONFIG = process.env.GODEX_CONFIG ?? "C:\\Users\\Bliss\\.godex\\config.yaml";
const GODEX_BINARY = process.env.GODEX_BINARY ?? "D:\\Documents\\VibeCoding\\GodeX\\platforms\\win32-x64\\bin\\godex2.exe";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const JSON_H = { "Content-Type": "application/json", ...CORS };
const HTML_H = { "Content-Type": "text/html; charset=utf-8", ...CORS };

interface TraceRow { created_at: number; event_name: string; request_id: string; provider?: string; model?: string; message?: string; }

async function queryTraceLogs(limit = 60): Promise<TraceRow[]> {
  try {
    const { DatabaseSync } = await import("bun");
    if (!existsSync(TRACE_DB_PATH)) return [];
    const db = new DatabaseSync(TRACE_DB_PATH);
    const rows = db.query(
      "SELECT created_at, event_name, request_id, provider, model, message FROM trace_events ORDER BY created_at DESC LIMIT ?"
    ).all(limit) as TraceRow[];
    db.close();
    return rows;
  } catch { return []; }
}

async function proxyToGodex(path: string, timeoutMs = 5000): Promise<Response> {
  try {
    const r = await fetch(GODEX_BASE + path, { signal: AbortSignal.timeout(timeoutMs) });
    return new Response(await r.text(), { headers: JSON_H });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), { status: 502, headers: JSON_H });
  }
}

// Parse existing aliases from config.yaml (simple regex parser)
function readExistingAliases(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(GODEX_CONFIG)) return out;
  try {
    const raw = fs_read(GODEX_CONFIG, "utf-8");
    const m = raw.match(/aliases:\s*\n([\s\S]*?)(?:\n[a-z]|$)/);
    if (m) {
      for (const line of m[1].split("\n")) {
        const am = line.match(/^\s+['"]([^'"]+)['"]\s*:\s*(\S+)\s*$/);
        if (am) out[am[1]] = am[2];
      }
    }
  } catch {}
  return out;
}

function writeConfigYaml(provider: string, baseUrl: string, apiKey: string, timeoutMs: number, aliases: Record<string, string>): void {
  const aliasesYaml = Object.entries(aliases)
    .map(([k, v]) => '    "' + k + '": ' + v).join("\n");
  const yaml = [
    "server:",
    "  port: " + (new URL(GODEX_BASE).port || "5678"),
    "  host: 127.0.0.1",
    "default_provider: " + provider,
    "providers:",
    "  " + provider + ":",
    "    spec: " + provider,
    "    credentials:",
    "      api_key: " + apiKey,
    "    endpoint:",
    "      base_url: " + baseUrl,
    "    timeout_ms: " + timeoutMs,
    "models:",
    "  aliases:",
    aliasesYaml,
    "session:",
    "  backend: sqlite",
    "logging:",
    "  level: info",
    "trace:",
    "  capture_payload: true",
    "",
  ].join("\n");
  fs_write(GODEX_CONFIG, yaml, "utf-8");
}

function killExistingGodex(): void {
  const port = new URL(GODEX_BASE).port || "5678";
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ' + port + ' -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Select-Object -First 1"',
      { encoding: "utf-8" }
    ).trim();
    if (out && /^\d+$/.test(out)) {
      try { execSync("taskkill /F /PID " + out, { stdio: "ignore" }); } catch {}
    }
  } catch {}
}

function startNewGodex(): number | undefined {
  if (!existsSync(GODEX_BINARY)) throw new Error("binary not found: " + GODEX_BINARY);
  const child = cp_spawn(GODEX_BINARY, [], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  return child.pid;
}

async function applyConfig(body: { provider?: string; base_url?: string; api_key?: string; timeout_ms?: number; alias_default?: string; alias_target?: string }) {
  const provider = body.provider || "minimax";
  const baseUrl = body.base_url || "https://api.example.com/v1";
  const apiKey = body.api_key || "";
  const timeoutMs = body.timeout_ms || 60000;
  const aliasDefault = body.alias_default || (provider + "-model");
  const aliasTarget = body.alias_target || (provider + "/Model");

  const aliases = readExistingAliases();
  aliases[aliasDefault] = aliasTarget;
  if (!aliases["*"]) aliases["*"] = aliasTarget;

  try { writeConfigYaml(provider, baseUrl, apiKey, timeoutMs, aliases); }
  catch (e: unknown) { return { ok: false, error: "write failed: " + (e as Error).message }; }

  killExistingGodex();
  await new Promise(r => setTimeout(r, 1500));

  try {
    const pid = startNewGodex();
    return { ok: true, pid, config_path: GODEX_CONFIG };
  } catch (e: unknown) {
    return { ok: false, error: "start failed: " + (e as Error).message };
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === "OPTIONS") return new Response(null, { headers: { ...CORS } });
    if (path === "/" || path === "/index.html") return new Response(HTML, { headers: HTML_H });
    if (path === "/api/health" || path === "/health") return proxyToGodex("/health", 3000);
    if (path === "/api/v1/models" || path === "/v1/models") return proxyToGodex("/v1/models", 8000);
    if (path === "/api/logs" && req.method === "GET") return new Response(JSON.stringify(await queryTraceLogs(60)), { headers: JSON_H });
    if (path === "/api/config" && req.method === "POST") {
      try {
        const body = await req.json() as Record<string, unknown>;
        const result = await applyConfig(body as { provider?: string; base_url?: string; api_key?: string; timeout_ms?: number; alias_default?: string; alias_target?: string });
        return new Response(JSON.stringify(result), { headers: JSON_H });
      } catch (e: unknown) {
        return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 400, headers: JSON_H });
      }
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log("GodeX Studio listening on http://127.0.0.1:" + PORT);
console.log("  -> GodeX:     " + GODEX_BASE);
console.log("  -> Trace DB:  " + TRACE_DB_PATH);
console.log("  -> Config:    " + GODEX_CONFIG);
console.log("  -> Binary:    " + GODEX_BINARY);

const HTML = "<!DOCTYPE html>\n<html lang=\"zh\">\n<head>\n<meta charset=\"utf-8\"/>\n<title>GodeX Studio</title>\n<style>\n*{box-sizing:border-box;margin:0;padding:0}\n:root{--bg:#0d1117;--bg2:#161b22;--bg3:#21262d;--border:#30363d;--text:#c9d1d9;--text2:#8b949e;--blue:#58a6ff;--green:#3fb950;--red:#f85149;--yellow:#d29922;--purple:#8957e5}\nbody{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);display:flex;flex-direction:column;height:100vh;overflow:hidden}\nheader{background:var(--bg2);border-bottom:1px solid var(--border);padding:10px 16px;display:flex;align-items:center;gap:12px}\nh1{font-size:15px;font-weight:700;color:var(--blue);letter-spacing:-.3px}\n.dot{width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block;vertical-align:middle}\n.dot.ok{background:var(--green)}\n.layout{display:flex;flex:1;overflow:hidden;min-height:0}\n.col-left{width:200px;flex-shrink:0;border-right:1px solid var(--border);display:flex;flex-direction:column}\n.col-center{flex:1;display:flex;flex-direction:column;overflow:hidden}\n.col-right{width:240px;flex-shrink:0;border-left:1px solid var(--border);display:flex;flex-direction:column}\n.sec{background:var(--bg2);border-bottom:1px solid var(--border);padding:6px 12px;font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.05em}\n.provider-list{padding:8px;flex:1;overflow-y:auto}\n.provider-item{background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:6px;cursor:pointer;font-size:13px;font-weight:600}\n.provider-item:hover{border-color:var(--blue)}\n.provider-item.active{border-color:var(--blue);background:rgba(88,166,255,.1);color:var(--blue)}\n.provider-item .sub{font-size:11px;color:var(--text2);font-weight:400;margin-top:2px}\n.forms-area{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}\n.form-section{background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow:hidden}\n.form-section-head{background:rgba(255,255,255,.03);padding:8px 12px;font-size:12px;font-weight:600;color:var(--text);border-bottom:1px solid var(--border)}\n.form-grid{display:grid;grid-template-columns:130px 1fr;gap:0}\n.form-row{display:contents}\n.form-row label{padding:7px 12px;font-size:12px;color:var(--text2);display:flex;align-items:center;border-bottom:1px solid rgba(48,54,61,.5)}\n.form-row label .req{color:var(--red);margin-left:2px}\ninput,select{background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:5px 8px;font-size:12px;width:100%;font-family:inherit}\ninput:focus,select:focus{outline:none;border-color:var(--blue)}\ninput[type=number]{-moz-appearance:textfield}\ninput[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}\n.preset-hint{padding:4px 12px;font-size:11px;color:var(--text2);background:rgba(255,255,255,.02);border-top:1px solid rgba(48,54,61,.5)}\n.action-bar{padding:10px 12px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-shrink:0}\n.btn{background:#238636;border:none;border-radius:5px;color:#fff;padding:7px 16px;font-size:13px;cursor:pointer;font-weight:600}\n.btn:hover{background:#2ea043}\n.btn.purple{background:#6e40c9}\n.btn.purple:hover{background:var(--purple)}\n.btn.gray{background:var(--bg3);color:var(--text)}\n.btn.gray:hover{background:#3a3f47}\n.msg{font-size:12px;margin-left:8px}\n.msg.ok{color:var(--green)}\n.msg.err{color:var(--red)}\n.model-list{flex:1;overflow-y:auto;padding:8px}\n.model-card{background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:5px;cursor:pointer}\n.model-card:hover{border-color:var(--blue)}\n.model-card.active{border-color:var(--blue);background:rgba(88,166,255,.08)}\n.model-card .name{font-size:12px;font-weight:600}\n.model-card.active .name{color:var(--blue)}\n.model-card .preset{font-size:10px;color:var(--green);margin-top:2px}\n.model-card .hint{font-size:10px;color:var(--yellow);margin-top:2px}\n.bottom{height:180px;flex-shrink:0;border-top:1px solid var(--border);display:flex;flex-direction:column;background:var(--bg)}\n.bottom-header{background:var(--bg2);padding:5px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border)}\n.bottom-header span{font-size:11px;color:var(--text2);font-weight:600;text-transform:uppercase}\n.bottom-body{flex:1;overflow-y:auto;font-family:ui-monospace,monospace;font-size:11px}\n.log-line{padding:2px 12px;border-bottom:1px solid rgba(22,27,34,.8);display:flex;gap:8px}\n.log-line:hover{background:rgba(255,255,255,.02)}\n.log-line .ts{color:#6e7681;flex-shrink:0}\n.log-line .msg{color:var(--text);word-break:break-all}\n.log-line.error{background:rgba(248,81,73,.06);border-left:3px solid var(--red)}\n.log-line.error .msg{color:var(--red)}\n.log-line.warn{border-left:3px solid var(--yellow)}\n.log-line.warn .msg{color:var(--yellow)}\n.log-line.ok{border-left:3px solid var(--green)}\n.header-right{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2)}\n</style>\n</head>\n<body>\n\n<header>\n  <h1>&#9881; GodeX Studio</h1>\n  <div class=\"dot ok\" id=\"godex-dot\"></div>\n  <span style=\"font-size:12px;color:var(--text2)\" id=\"godex-label\">checking godex...</span>\n  <div class=\"header-right\">\n    <span>Studio :56791</span><span>&#8594;</span><span id=\"godex-url\">http://127.0.0.1:5678</span>\n  </div>\n</header>\n\n<div class=\"layout\">\n\n  <!-- LEFT: Provider -->\n  <div class=\"col-left\">\n    <div class=\"sec\">Provider</div>\n    <div class=\"provider-list\">\n      <div class=\"provider-item active\" data-provider=\"minimax\" onclick=\"selectProvider('minimax')\">\n        MiniMax<div class=\"sub\">minnimax.chat</div>\n      </div>\n      <div class=\"provider-item\" data-provider=\"deepseek\" onclick=\"selectProvider('deepseek')\">\n        DeepSeek<div class=\"sub\">api.deepseek.com</div>\n      </div>\n      <div class=\"provider-item\" data-provider=\"openai\" onclick=\"selectProvider('openai')\">\n        OpenAI<div class=\"sub\">api.openai.com</div>\n      </div>\n      <div class=\"provider-item\" data-provider=\"zhipu\" onclick=\"selectProvider('zhipu')\">\n        智谱 GLM<div class=\"sub\">bigmodel.cn</div>\n      </div>\n    </div>\n  </div>\n\n  <!-- CENTER: Settings Forms -->\n  <div class=\"col-center\">\n    <div class=\"forms-area\">\n\n      <!-- Connection -->\n      <div class=\"form-section\">\n        <div class=\"form-section-head\">&#128279; 连接设置</div>\n        <div class=\"form-grid\">\n          <div class=\"form-row\"><label>Base URL <span class=\"req\">*</span></label>\n            <input id=\"f-base_url\" type=\"text\" placeholder=\"https://api.example.com/v1\" value=\"https://minnimax.chat/v1\"/>\n          </div>\n          <div class=\"form-row\"><label>API Key <span class=\"req\">*</span></label>\n            <input id=\"f-api_key\" type=\"password\" placeholder=\"gw-xxxxxxxxxxxxxxxx\"/>\n          </div>\n          <div class=\"form-row\"><label>Timeout (ms)</label>\n            <input id=\"f-timeout\" type=\"number\" min=\"5000\" max=\"300000\" step=\"5000\" value=\"120000\"/>\n          </div>\n        </div>\n      </div>\n\n      <!-- Model params -->\n      <div class=\"form-section\">\n        <div class=\"form-section-head\">&#128203; 模型参数（右侧选模型自动填入）</div>\n        <div class=\"form-grid\">\n          <div class=\"form-row\"><label>Context Window</label>\n            <input id=\"f-context\" type=\"number\" min=\"1024\" max=\"2000000\" step=\"1024\" placeholder=\"点击右侧模型自动填入\"/>\n          </div>\n          <div class=\"form-row\"><label>Max Output</label>\n            <input id=\"f-max_output\" type=\"number\" min=\"1\" max=\"65536\" value=\"16384\"/>\n          </div>\n          <div class=\"form-row\"><label>Temperature</label>\n            <input id=\"f-temperature\" type=\"number\" min=\"0\" max=\"2\" step=\"0.1\" value=\"0.7\"/>\n          </div>\n          <div class=\"form-row\"><label>Top P</label>\n            <input id=\"f-top_p\" type=\"number\" min=\"0\" max=\"1\" step=\"0.05\" value=\"1.0\"/>\n          </div>\n          <div class=\"form-row\"><label>Top K</label>\n            <input id=\"f-top_k\" type=\"number\" min=\"1\" max=\"100\" placeholder=\"不限制\"/>\n          </div>\n        </div>\n      </div>\n\n      <!-- Advanced -->\n      <div class=\"form-section\">\n        <div class=\"form-section-head\">&#9889; 高级参数</div>\n        <div class=\"form-grid\">\n          <div class=\"form-row\"><label>Thinking</label>\n            <select id=\"f-thinking\">\n              <option value=\"disabled\">disabled</option>\n              <option value=\"adaptive\" selected>adaptive</option>\n              <option value=\"enabled\">enabled</option>\n            </select>\n          </div>\n          <div class=\"form-row\"><label>Reasoning Effort</label>\n            <select id=\"f-reasoning_effort\">\n              <option value=\"\">默认</option>\n              <option value=\"low\">low</option>\n              <option value=\"medium\" selected>medium</option>\n              <option value=\"high\">high</option>\n            </select>\n          </div>\n          <div class=\"form-row\"><label>Seed</label>\n            <input id=\"f-seed\" type=\"number\" min=\"1\" max=\"9999999999\" placeholder=\"随机\"/>\n          </div>\n          <div class=\"form-row\"><label>Stream</label>\n            <select id=\"f-stream\">\n              <option value=\"true\" selected>SSE 流式</option>\n              <option value=\"false\">同步</option>\n            </select>\n          </div>\n        </div>\n      </div>\n\n      <!-- Alias -->\n      <div class=\"form-section\">\n        <div class=\"form-section-head\">&#128278; 模型别名映射</div>\n        <div class=\"form-grid\">\n          <div class=\"form-row\"><label>默认别名 *</label>\n            <input id=\"f-alias_default\" type=\"text\" value=\"minimax-m3\" placeholder=\"minimax-m3\" oninput=\"this.dataset.userEdited='1'\"/>\n          </div>\n          <div class=\"form-row\"><label>指向模型</label>\n            <input id=\"f-alias_target\" type=\"text\" value=\"minimax/MiniMax-M3\" placeholder=\"minimax/MiniMax-M3\"/>\n          </div>\n        </div>\n        <div class=\"preset-hint\">* Codex 发送 model 字段时用别名匹配，如输入 \"minimax-m3\" → 映射到 \"minimax/MiniMax-M3\"</div>\n      </div>\n\n    </div>\n\n    <!-- Action bar -->\n    <div class=\"action-bar\">\n      <button class=\"btn\" onclick=\"saveConfig()\">&#128190; 保存</button>\n      <button class=\"btn purple\" onclick=\"applyConfig()\">&#9989; 应用到 godex</button>\n      <button class=\"btn gray\" onclick=\"generateAndCopy()\">&#128203; 复制 YAML</button>\n      <button class=\"btn gray\" onclick=\"resetForm()\">&#128260; 重置</button>\n      <span class=\"msg\" id=\"action-msg\"></span>\n    </div>\n  </div>\n\n  <!-- RIGHT: Model List -->\n  <div class=\"col-right\">\n    <div class=\"sec\">&#128203; 模型列表</div>\n    <div class=\"model-list\" id=\"model-list\">\n      <div style=\"padding:16px;text-align:center;color:var(--text2);font-size:12px\">加载中...</div>\n    </div>\n  </div>\n\n</div>\n\n<!-- BOTTOM: Logs -->\n<div class=\"bottom\">\n  <div class=\"bottom-header\">\n    <span>Logs</span>\n    <button class=\"btn gray\" style=\"padding:2px 8px;font-size:11px\" onclick=\"clearLogs()\">Clear</button>\n    <span id=\"log-count\" style=\"margin-left:auto;font-size:11px;color:var(--text2)\"></span>\n  </div>\n  <div class=\"bottom-body\" id=\"logs-body\"></div>\n</div>\n\n<script>\nconst GODEX = \"http://127.0.0.1:5678\";\nconst $ = id => document.getElementById(id);\nconst esc = s => String(s||\"\").replace(/&/g,\"&amp;\").replace(/</g,\"&lt;\").replace(/>/g,\"&gt;\");\n\nlet logCount = 0;\nlet activeProvider = localStorage.getItem(\"studio:provider\") || \"minimax\";\nlet activeModel = localStorage.getItem(\"studio:active\") || \"\";\n\n// Known model presets: context window, max_output, thinking\nconst PRESETS = {\n  \"minimax/MiniMax-M3\":                  { ctx: 1000000, out: 16384, think: \"adaptive\" },\n  \"minimax/MiniMax-M2.7\":                { ctx: 204800,  out: 16384, think: \"adaptive\" },\n  \"minimax/MiniMax-M2.7-highspeed\":      { ctx: 204800,  out: 16384, think: \"adaptive\" },\n  \"minimax/MiniMax-M2\":        { ctx: 100000, out: 8192,  think: \"adaptive\" },\n  \"minimax/MiniMax-M1.5\":      { ctx: 100000, out: 8192,  think: \"adaptive\" },\n  \"minimax/MiniMax-Text-01\":   { ctx: 100000, out: 8192,  think: \"disabled\" },\n  \"deepseek/deepseek-chat\":    { ctx: 64000,  out: 8192,  think: \"disabled\" },\n  \"deepseek/deepseek-coder\":   { ctx: 64000,  out: 8192,  think: \"disabled\" },\n  \"openai/gpt-4o\":             { ctx: 128000, out: 16384, think: \"disabled\" },\n  \"openai/gpt-4o-mini\":       { ctx: 128000, out: 16384, think: \"disabled\" },\n  \"openai/gpt-4-turbo\":        { ctx: 128000, out: 16384, think: \"disabled\" },\n  \"zhipu/glm-4\":               { ctx: 128000, out: 8192,  think: \"disabled\" },\n  \"zhipu/glm-4-flash\":         { ctx: 128000, out: 8192,  think: \"disabled\" },\n};\n\nconst PROVIDER_DEFAULTS = {\n  minimax:  { base: \"https://minnimax.chat/v1\", timeout: 120000, think: \"adaptive\" },\n  deepseek: { base: \"https://api.deepseek.com/v1\", timeout: 60000, think: \"disabled\" },\n  openai:   { base: \"https://api.openai.com/v1\", timeout: 60000, think: \"disabled\" },\n  zhipu:    { base: \"https://open.bigmodel.cn/api/paas/v4\", timeout: 60000, think: \"disabled\" },\n};\n\nfunction log(msg, type=\"ok\") {\n  const body = $(\"logs-body\");\n  const d = document.createElement(\"div\");\n  d.className = \"log-line \" + type;\n  d.innerHTML = \"<span class=ts>\"+new Date().toTimeString().slice(0,8)+\"</span><span class=msg>\"+esc(msg)+\"</span>\";\n  body.insertBefore(d, body.firstChild);\n  logCount++;\n  $(\"log-count\").textContent = logCount + \" 条\";\n  if (body.children.length > 200) body.removeChild(body.lastChild);\n}\n\nfunction setGodexStatus(text, ok) {\n  $(\"godex-label\").textContent = text;\n  $(\"godex-dot\").className = \"dot\" + (ok ? \" ok\" : \"\");\n}\n\nfunction showMsg(text, type) {\n  const el = $(\"action-msg\");\n  el.textContent = text; el.className = \"msg \" + (type||\"\");\n  setTimeout(() => { el.textContent = \"\"; }, 4000);\n}\n\nfunction selectProvider(p) {\n  activeProvider = p;\n  localStorage.setItem(\"studio:provider\", p);\n  document.querySelectorAll(\".provider-item\").forEach(el => el.classList.toggle(\"active\", el.dataset.provider === p));\n  const def = PROVIDER_DEFAULTS[p] || {};\n  $(\"f-base_url\").value = def.base || \"\";\n  $(\"f-timeout\").value = def.timeout || 60000;\n  $(\"f-thinking\").value = def.think || \"adaptive\";\n  log(\"切换到 \" + p);\n}\n\nfunction deriveAlias(modelId) {\n  const parts = modelId.split(\"/\");\n  return parts[parts.length - 1].toLowerCase();\n}\nfunction selectModel(id) {\n  activeModel = id;\n  localStorage.setItem(\"studio:active\", id);\n  document.querySelectorAll(\".model-card\").forEach(el => el.classList.toggle(\"active\", el.dataset.id === id));\n  $(\"f-alias_target\").value = id;\n  const af = $(\"f-alias_default\");\n  if (!af.dataset.userEdited) af.value = deriveAlias(id);\n  const p = PRESETS[id];\n  if (p) {\n    $(\"f-context\").value = p.ctx;\n    $(\"f-max_output\").value = p.out;\n    if (p.think) $(\"f-thinking\").value = p.think;\n    log(\"已选 \" + id + \" → alias: \" + af.value + \" (ctx:\" + p.ctx + \")\", \"ok\");\n  } else {\n    $(\"f-context\").value = \"\";\n    $(\"f-max_output\").value = 16384;\n    log(\"已选 \" + id + \" → alias: \" + af.value + \" (无预设)\", \"warn\");\n  }\n}\n\nasync function loadModels() {\n  try {\n    const json = await fetch(\"/api/v1/models\", {signal:AbortSignal.timeout(5000)}).then(r=>r.json());\n    const list = json.data || [];\n    const el = $(\"model-list\");\n    if (!list.length) { el.innerHTML = \"<div style='padding:16px;color:var(--text2)'>无模型</div>\"; return; }\n    const byP = {};\n    for (const m of list) { const pr = (m.id||\"\").split(\"/\")[0]||\"unknown\"; (byP[pr]=byP[pr]||[]).push(m); }\n    el.innerHTML = \"\";\n    for (const [pr, ms] of Object.entries(byP)) {\n      const grp = document.createElement(\"div\");\n      grp.innerHTML = \"<div style='font-size:10px;color:#6e7681;padding:4px 0 2px'>\"+esc(pr)+\"</div>\";\n      for (const m of ms) {\n        const card = document.createElement(\"div\");\n        const p2 = PRESETS[m.id];\n        card.className = \"model-card\" + (m.id===activeModel?\" active\":\"\");\n        card.dataset.id = m.id;\n        let extra = \"\";\n        if (p2) extra = \"<div class=preset>ctx:\"+p2.ctx+\" out:\"+p2.out+\"</div>\";\n        else extra = \"<div class=hint>请手动填参数</div>\";\n        card.innerHTML = \"<div class=name>\"+esc(m.id)+\"</div>\"+extra;\n        card.onclick = () => selectModel(m.id);\n        grp.appendChild(card);\n      }\n      el.appendChild(grp);\n    }\n  } catch(e) { $(\"model-list\").innerHTML = \"<div style='padding:16px;color:var(--red)'>加载失败: \"+esc(e.message)+\"</div>\"; }\n}\n\nasync function checkGodex() {\n  try {\n    const h = await fetch(\"/api/health\",{signal:AbortSignal.timeout(3000)}).then(r=>r.json());\n    setGodexStatus(\"godex: \"+(h.providers||[]).join(\", \"), true);\n  } catch(e) { setGodexStatus(\"godex offline\", false); }\n}\n\nfunction saveConfig() {\n  const cfg = {\n    provider: activeProvider,\n    base_url: $(\"f-base_url\").value,\n    api_key: $(\"f-api_key\").value,\n    timeout: parseInt($(\"f-timeout\").value)||60000,\n    context: parseInt($(\"f-context\").value)||0,\n    max_output: parseInt($(\"f-max_output\").value)||16384,\n    temperature: parseFloat($(\"f-temperature\").value)||0.7,\n    top_p: parseFloat($(\"f-top_p\").value)||1,\n    top_k: $(\"f-top_k\").value?parseInt($(\"f-top_k\").value):null,\n    thinking: $(\"f-thinking\").value,\n    reasoning_effort: $(\"f-reasoning_effort\").value||null,\n    seed: $(\"f-seed\").value?parseInt($(\"f-seed\").value):null,\n    stream: $(\"f-stream\").value===\"true\",\n    alias_default: $(\"f-alias_default\").value,\n    alias_target: $(\"f-alias_target\").value,\n  };\n  localStorage.setItem(\"studio:config\", JSON.stringify(cfg));\n  showMsg(\"已保存到浏览器\", \"ok\");\n  log(\"配置已保存: \" + cfg.provider + \"/\" + cfg.alias_default);\n}\n\nfunction loadConfig() {\n  try {\n    const cfg = JSON.parse(localStorage.getItem(\"studio:config\")||\"{}\");\n    if (!cfg.provider) return;\n    selectProvider(cfg.provider);\n    $(\"f-base_url\").value = cfg.base_url||\"\";\n    $(\"f-api_key\").value = cfg.api_key||\"\";\n    $(\"f-timeout\").value = cfg.timeout||60000;\n    $(\"f-context\").value = cfg.context||\"\";\n    $(\"f-max_output\").value = cfg.max_output||16384;\n    $(\"f-temperature\").value = cfg.temperature??0.7;\n    $(\"f-top_p\").value = cfg.top_p??1;\n    $(\"f-top_k\").value = cfg.top_k||\"\";\n    $(\"f-thinking\").value = cfg.thinking||\"adaptive\";\n    $(\"f-reasoning_effort\").value = cfg.reasoning_effort||\"medium\";\n    $(\"f-seed\").value = cfg.seed||\"\";\n    $(\"f-stream\").value = cfg.stream?\"true\":\"false\";\n    $(\"f-alias_default\").value = cfg.alias_default||\"minimax-m3\";\n    $(\"f-alias_target\").value = cfg.alias_target||\"\";\n    log(\"配置已恢复\");\n  } catch {}\n}\n\nfunction getGodexPort() { try { return new URL(GODEX).port||\"5678\"; } catch { return \"5678\"; } }\n\nfunction generateAndCopy() {\n  saveConfig();\n  const p = activeProvider;\n  const alias = $(\"f-alias_default\").value || p+\"-model\";\n  const target = $(\"f-alias_target\").value || p+\"/Model\";\n  const yaml = `server:\n  port: ${getGodexPort()}\n  host: 127.0.0.1\ndefault_provider: ${p}\nproviders:\n  ${p}:\n    spec: ${p}\n    credentials:\n      api_key: ${$(\"f-api_key\").value || \"YOUR_API_KEY\"}\n    endpoint:\n      base_url: ${$(\"f-base_url\").value || \"https://api.example.com/v1\"}\n    timeout_ms: ${$(\"f-timeout\").value || 60000}\nmodels:\n  aliases:\n    \"${alias}\": ${target}\nsession:\n  backend: sqlite\nlogging:\n  level: info\ntrace:\n  enabled: true\n  capture_payload: true\n`;\n  navigator.clipboard.writeText(yaml).then(() => { showMsg(\"config.yaml 已复制到剪贴板！\", \"ok\"); log(\"config.yaml 已复制\"); }).catch(e => { showMsg(e.message, \"err\"); });\n}\n\nasync function applyConfig() {\n  saveConfig();\n  const msg = $(\"param-msg\");\n  msg.textContent = \"正在写 config.yaml + 重启 godex...\";\n  msg.className = \"msg\";\n  log(\"Apply: writing config + restarting godex...\");\n  try {\n    const cfg = JSON.parse(localStorage.getItem(\"studio:config\") || \"{}\");\n    const res = await fetch(\"/api/config\", {\n      method: \"POST\",\n      headers: { \"Content-Type\": \"application/json\" },\n      body: JSON.stringify({\n        provider: cfg.provider, base_url: cfg.base_url, api_key: cfg.api_key,\n        timeout_ms: cfg.timeout, alias_default: cfg.alias_default, alias_target: cfg.alias_target,\n      }),\n    });\n    const out = await res.json();\n    if (out.ok) {\n      msg.textContent = \"已应用！重启中... (PID: \" + out.pid + \")\";\n      msg.className = \"msg ok\";\n      log(\"Config applied: \" + out.config_path);\n      log(\"New godex PID: \" + out.pid);\n      setTimeout(checkGodex, 3000);\n      setTimeout(() => location.reload(), 6000);\n    } else {\n      msg.textContent = \"失败: \" + out.error;\n      msg.className = \"msg err\";\n      log(\"Apply failed: \" + out.error, \"error\");\n    }\n  } catch (e) {\n    msg.textContent = \"错误: \" + e.message;\n    msg.className = \"msg err\";\n    log(e.message, \"error\");\n  }\n}\nfunction resetForm() {\n  selectProvider(activeProvider);\n  $(\"f-context\").value = \"\";\n  $(\"f-max_output\").value = \"16384\";\n  $(\"f-temperature\").value = \"0.7\";\n  $(\"f-top_p\").value = \"1.0\";\n  $(\"f-top_k\").value = \"\";\n  $(\"f-reasoning_effort\").value = \"medium\";\n  $(\"f-seed\").value = \"\";\n  $(\"f-stream\").value = \"true\";\n  showMsg(\"已重置\", \"\");\n}\n\nfunction clearLogs() { $(\"logs-body\").innerHTML = \"\"; logCount=0; $(\"log-count\").textContent=\"\"; }\n\nasync function pollLogs() {\n  try {\n    const logs = await fetch(\"/api/logs\",{signal:AbortSignal.timeout(5000)}).then(r=>r.json());\n    if (!logs||!logs.length) return;\n    const el = $(\"logs-body\");\n    const existing = new Set([...el.querySelectorAll(\".log-line\")].map(d=>d.dataset.req));\n    for (const l of logs) {\n      if (existing.has(l.request_id)) continue;\n      const d = document.createElement(\"div\");\n      d.className = \"log-line \" + (l.event_name?.includes(\"error\")?\"error\":l.event_name?.includes(\"warn\")?\"warn\":\"ok\");\n      d.dataset.req = l.request_id;\n      const ts = l.created_at?new Date(l.created_at*1000).toTimeString().slice(0,8):\"--:--:--\";\n      d.innerHTML = \"<span class=ts>\"+ts+\"</span><span class=msg>\"+esc(l.event_name||\"?\")+\"</span>\";\n      el.insertBefore(d, el.firstChild);\n      if (el.children.length > 200) el.removeChild(el.lastChild);\n    }\n  } catch {}\n}\n\nselectProvider(activeProvider);\nloadConfig();\nloadModels();\ncheckGodex();\nsetInterval(checkGodex, 8000);\nsetInterval(pollLogs, 5000);\nlog(\"GodeX Studio 已启动\");\n</script>\n</body>\n</html>";
