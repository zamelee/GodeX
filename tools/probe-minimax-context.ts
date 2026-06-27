/**
 * MiniMax Context Window Probing — Minimal API Calls Edition
 *
 * Each (model × endpoint) = 6 calls max.
 *
 * Usage:
 *   bun tools/probe-minimax-context.ts
 *   bun tools/probe-minimax-context.ts -m MiniMax-M3
 */

import { parseArgs } from "node:util";
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const DIRECT_BASE = "https://minnimax.chat/v1";
const GODEX_URL   = "http://localhost:5678";
const PROBE_CHAR  = "hello ";
const WORDS_PER_TOKEN = 6;
const LOG_DIR     = "D:/Documents/VibeCoding/GodeX/tools/logs";
const __dirname   = dirname(fileURLToPath(import.meta.url));

const MODELS = [
  { name: "MiniMax-M3",             contextWindow: 1_000_000, maxTokens: 131_072 },
  { name: "MiniMax-M2.7",           contextWindow: 204_800,  maxTokens: 131_072 },
  { name: "MiniMax-M2.7-highspeed", contextWindow: 204_800,  maxTokens: 131_072 },
];

// ── Logging ──────────────────────────────────────────────────────────────────

let runId = "";
let logPath = "";
const clients = new Set<(data: string) => void>();

function initLogger() {
  runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  logPath = join(LOG_DIR, `probe-${runId}.jsonl`);
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(logPath, JSON.stringify({ type: "run-start", runId }) + "\n");
}

function log(data: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), runId, ...data };
  appendFileSync(logPath, JSON.stringify(entry) + "\n");
  const msg = JSON.stringify(entry);
  for (const cb of clients) cb(msg);
}

// ── HTTP Server (SSE dashboard) ───────────────────────────────────────────────

function startServer(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
        const cb = (data: string) => { try { res.write(`data: ${data}\n\n`); } catch {} };
        clients.add(cb);
        req.on("close", () => { clients.delete(cb); });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(HTML.replace("__RUN_ID__", runId).replace("__LOG_PATH__", logPath));
    });
    srv.listen(0, "127.0.0.1", () => { resolve((srv.address() as { port: number }).port); });
  });
}

function openBrowser(url: string) {
  exec(`start "" "${url}"`, { cwd: __dirname }, () => {});
}

// ── API Calls ─────────────────────────────────────────────────────────────────

async function loadApiKey(): Promise<string> {
  if (process.env.MINIMAX_API_KEY) return process.env.MINIMAX_API_KEY;
  try {
    return JSON.parse(readFileSync("D:/Documents/VibeCoding/GodeX/tools/config.json", "utf-8")).providers?.default?.api_key ?? "";
  } catch { return ""; }
}

interface Result {
  tokens: number;
  maxTokens: number;
  status: number;
  error?: string;
  errorType?: string;
  finish?: string;
  promptTokens?: number;
  cachedTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

async function chatCompletion(apiKey: string, model: string, tokens: number, maxTokens: number): Promise<Result> {
  const content = PROBE_CHAR.repeat(Math.ceil(tokens / WORDS_PER_TOKEN));
  const r = await fetch(`${DIRECT_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], max_completion_tokens: maxTokens }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) return { tokens, maxTokens, status: r.status, error: String(data?.error?.message ?? data?.error?.type ?? `HTTP ${r.status}`), errorType: String(data?.error?.type ?? "unknown") };
  return {
    tokens, maxTokens, status: r.status, finish: data?.choices?.[0]?.finish_reason,
    promptTokens: data?.usage?.prompt_tokens,
    cachedTokens: data?.usage?.prompt_tokens_details?.cached_tokens,
    completionTokens: data?.usage?.completion_tokens,
    totalTokens: data?.usage?.total_tokens,
  };
}

async function godexResponses(apiKey: string, model: string, tokens: number, maxTokens: number): Promise<Result> {
  const content = PROBE_CHAR.repeat(Math.ceil(tokens / WORDS_PER_TOKEN));
  const r = await fetch(`${GODEX_URL}/v1/responses`, {
    method: "POST",
    headers: { "Authorization": "Bearer 123", "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: [{ role: "user", content }], max_output_tokens: maxTokens }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) return { tokens, maxTokens, status: r.status, error: String(data?.error?.message ?? data?.error?.type ?? `HTTP ${r.status}`), errorType: String(data?.error?.type ?? "unknown") };
  return {
    tokens, maxTokens, status: r.status, finish: data?.output?.[0]?.type === "message" ? data.output[0].status : undefined,
    promptTokens: data?.usage?.input_tokens,
    completionTokens: data?.usage?.output_tokens,
    totalTokens: data?.usage?.total_tokens,
  };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const { join } = await import("node:path");

// ── Minimal Probe ─────────────────────────────────────────────────────────────
// Call sequence per (model × endpoint):
//   1. Sanity: claimed * 0.85, maxOutput=256   → does it work?
//   2. Claimed boundary: claimed, maxOutput=256 → pass or fail?
//   3a. If #2 pass:  claimed*1.15, maxOutput=256
//   3b. If #2 fail: claimed*0.7, maxOutput=256
//   4. Max output: tokens=500, maxOutput=claimed    → pass or fail?
//   5. Max output+: tokens=500, maxOutput=claimed*1.5 → pass or fail?
//   6. Binary refinement: 1 step near boundary

interface ProbeSummary {
  model: string;
  endpoint: string;
  maxInput: number | null;
  maxOutput: number | null;
  maxInputDelta: number | null;
  maxOutputDelta: number | null;
  note: string;
}

async function probeEndpoint(
  probe: (t: number, m: number) => Promise<Result>,
  endpoint: "direct" | "godex",
  model: string,
  claimedContext: number,
  claimedMaxTokens: number,
): Promise<ProbeSummary> {
  const summary: ProbeSummary = { model, endpoint, maxInput: null, maxOutput: null, maxInputDelta: null, maxOutputDelta: null, note: "" };

  // ── Step 1: Sanity at 85% claimed ──────────────────────────────────────────
  const s1 = await probe(Math.round(claimedContext * 0.85), 256);
  log({ type: "call", endpoint, model, step: 1, tokens: Math.round(claimedContext * 0.85), maxTokens: 256, ...s1 });
  if (s1.status !== 200) {
    log({ type: "summary", endpoint, model, ...summary, note: `SANITY FAILED: ${s1.error}`, status: 500 });
    return summary;
  }
  await delay(400);

  // ── Step 2: Exact claimed context ─────────────────────────────────────────
  const s2 = await probe(claimedContext, 256);
  log({ type: "call", endpoint, model, step: 2, tokens: claimedContext, maxTokens: 256, ...s2 });
  const passAtClaimed = s2.status === 200;
  await delay(400);

  // ── Step 3: Extend boundary ───────────────────────────────────────────────
  let maxInput: number;
  if (passAtClaimed) {
    // Step 3a: test above claimed
    const s3 = await probe(Math.round(claimedContext * 1.2), 256);
    log({ type: "call", endpoint, model, step: "3a", tokens: Math.round(claimedContext * 1.2), maxTokens: 256, ...s3 });
    maxInput = s3.status === 200 ? Math.round(claimedContext * 1.2) : claimedContext;
  } else {
    // Step 3b: test below claimed
    const s3 = await probe(Math.round(claimedContext * 0.7), 256);
    log({ type: "call", endpoint, model, step: "3b", tokens: Math.round(claimedContext * 0.7), maxTokens: 256, ...s3 });
    maxInput = s3.status === 200 ? Math.round(claimedContext * 0.7) : null;
    if (maxInput === null) {
      log({ type: "summary", endpoint, model, ...summary, note: `FAILED EVEN AT 70%: ${s3.error}`, status: 500 });
      return summary;
    }
  }
  await delay(400);

  // ── Step 4: Max output at claimed value ───────────────────────────────────
  const s4 = await probe(500, claimedMaxTokens);
  log({ type: "call", endpoint, model, step: 4, tokens: 500, maxTokens: claimedMaxTokens, ...s4 });
  const passAtClaimedOut = s4.status === 200;
  await delay(400);

  // ── Step 5: Max output at 1.5x claimed ────────────────────────────────────
  const s5 = await probe(500, Math.round(claimedMaxTokens * 1.5));
  log({ type: "call", endpoint, model, step: 5, tokens: 500, maxTokens: Math.round(claimedMaxTokens * 1.5), ...s5 });
  const passAt1_5xOut = s5.status === 200;
  let maxOutput = claimedMaxTokens;
  if (passAt1_5xOut) maxOutput = Math.round(claimedMaxTokens * 1.5);
  else if (passAtClaimedOut) maxOutput = claimedMaxTokens;
  else maxOutput = Math.round(claimedMaxTokens * 0.7);
  await delay(400);

  // ── Step 6: One binary refinement step near maxInput ──────────────────────
  if (passAtClaimed) {
    // Fine-tune: test claimed + 10%
    const s6 = await probe(Math.round(claimedContext * 1.1), 256);
    log({ type: "call", endpoint, model, step: 6, tokens: Math.round(claimedContext * 1.1), maxTokens: 256, ...s6 });
    if (s6.status === 200) {
      maxInput = Math.round(claimedContext * 1.1);
      // One more step at 1.3x
      const s7 = await probe(Math.round(claimedContext * 1.3), 256);
      log({ type: "call", endpoint, model, step: "7", tokens: Math.round(claimedContext * 1.3), maxTokens: 256, ...s7 });
      if (s7.status === 200) maxInput = Math.round(claimedContext * 1.3);
    }
  }

  summary.maxInput = maxInput ?? claimedContext;
  summary.maxOutput = maxOutput;
  summary.maxInputDelta = (maxInput ?? claimedContext) - claimedContext;
  summary.maxOutputDelta = maxOutput - claimedMaxTokens;
  summary.note = `${claimedContext}|${claimedMaxTokens}`;

  log({ type: "summary", endpoint, model, ...summary, status: 200 });
  return summary;
}

// ── Dashboard HTML ────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>MiniMax Probe</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', monospace; background: #0d1117; color: #e6edf3; padding: 20px; font-size: 14px; }
h1 { color: #58a6ff; margin-bottom: 4px; }
.subtitle { color: #8b949e; font-size: 12px; margin-bottom: 16px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #30363d; font-size: 13px; }
th { color: #8b949e; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; background: #161b22; }
.pos { color: #3fb950; } .neg { color: #f85149; } .zero { color: #8b949e; }
.tag { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11px; }
.tag-direct { background: #1f3a5f; color: #58a6ff; }
.tag-godex { background: #3b1f5f; color: #bc8cff; }
.log { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; max-height: 50vh; overflow-y: auto; }
.log-entry { padding: 4px 0; border-bottom: 1px solid #21262d; font-size: 12px; display: flex; gap: 10px; align-items: center; }
.log-entry:last-child { border-bottom: none; }
.t { color: #8b949e; width: 90px; font-size: 11px; }
.phase { color: #d2a8ff; width: 120px; font-size: 11px; }
.status-ok { color: #3fb950; width: 30px; } .status-fail { color: #f85149; width: 30px; }
.msg { flex: 1; } .err { color: #f85149; }
.usage { color: #6e7681; font-size: 11px; }
.sum-row { border-left: 3px solid transparent; padding-left: 8px; }
.sum-row.ok { border-color: #3fb950; background: #0d1f12; }
.sum-row.fail { border-color: #f85149; background: #1f0d0d; }
.sum-row.running { border-color: #d29922; }
.done { color: #3fb950; font-size: 14px; font-weight: bold; margin-top: 12px; }
</style>
</head>
<body>
<h1>MiniMax Context Probe</h1>
<div class="subtitle">Run: __RUN_ID__ | Log: __LOG_PATH__</div>

<table>
<thead><tr>
  <th>Model</th><th>Endpoint</th>
  <th>Claimed Context</th><th>Real Max Input</th><th>Delta</th>
  <th>Claimed MaxOut</th><th>Real MaxOut</th><th>Delta</th>
  <th>Status</th>
</tr></thead>
<tbody id="tbody"></tbody>
</table>

<div class="log"><div id="log"></div></div>

<script>
const summaries = {};
const tbody = document.getElementById("tbody");
const logEl = document.getElementById("log");

function deltaClass(d) { return d > 0 ? 'pos' : d < 0 ? 'neg' : 'zero'; }
function fmt(d) { return d === null || d === undefined ? '—' : ((d > 0 ? '+' : '') + d.toLocaleString()); }

const es = new EventSource('/events');
es.onmessage = (e) => {
  const d = JSON.parse(e.data);

  // Log line
  const div = document.createElement('div');
  div.className = 'log-entry';
  const ok = d.status === 200;
  div.innerHTML =
    '<span class="t">' + (d.ts?.split('T')[1]?.slice(0,12) ?? '') + '</span>' +
    '<span class="tag tag-' + (d.endpoint ?? 'direct') + '">' + (d.endpoint ?? '').toUpperCase() + '</span>' +
    '<span class="phase">' + (d.step ?? d.phase ?? d.type ?? '') + '</span>' +
    '<span class="' + (ok ? 'status-ok' : 'status-fail') + '">' + (ok ? '✓' : '✗') + ' ' + (d.status ?? '') + '</span>' +
    '<span class="' + (d.error ? 'err' : 'msg') + '">' +
      (d.error ? (d.errorType + ': ' + d.error) :
       (d.type === 'summary' ? 'maxInput=' + d.maxInput + ' maxOutput=' + d.maxOutput :
        (d.promptTokens ? 'p=' + d.promptTokens + ' in=' + d.completionTokens + ' out=' + d.totalTokens + (d.cachedTokens ? ' cached=' + d.cachedTokens : '') :
         d.finish ?? d.note ?? 'OK'))) +
    '</span>';
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;

  // Summary row
  if (d.type === 'summary') {
    const key = d.endpoint + '|' + d.model;
    summaries[key] = d;
    renderTable();
  }
};

function renderTable() {
  tbody.innerHTML = '';
  for (const s of Object.values(summaries)) {
    const row = document.createElement('tr');
    const dc = deltaClass(s.maxInputDelta ?? 0);
    const doc = deltaClass(s.maxOutputDelta ?? 0);
    const [cc, cm] = (s.note ?? '|').split('|');
    const cls = s.status === 200 ? 'ok' : 'fail';
    row.innerHTML =
      '<td>' + s.model + '</td>' +
      '<td><span class="tag tag-' + s.endpoint + '">' + s.endpoint.toUpperCase() + '</span></td>' +
      '<td>' + ((cc && cc !== 'undefined') ? parseInt(cc).toLocaleString() : '—') + '</td>' +
      '<td>' + (s.maxInput?.toLocaleString() ?? '—') + '</td>' +
      '<td class="' + dc + '">' + fmt(s.maxInputDelta) + '</td>' +
      '<td>' + ((cm && cm !== 'undefined') ? parseInt(cm).toLocaleString() : '—') + '</td>' +
      '<td>' + (s.maxOutput?.toLocaleString() ?? '—') + '</td>' +
      '<td class="' + doc + '">' + fmt(s.maxOutputDelta) + '</td>' +
      '<td class="' + cls + '">' + (s.status === 200 ? '✓' : '✗') + '</td>';
    row.className = 'sum-row ' + cls;
    tbody.appendChild(row);
  }
}
</script>
</body>
</html>`;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({ options: { model: { type: "string", short: "m" } } });

  const apiKey = await loadApiKey();
  if (!apiKey) { console.error("\u274c No API key"); process.exit(1); }

  const models = values.model ? MODELS.filter((m) => m.name === values.model) : MODELS;
  if (!models.length) { console.error("\u274c Unknown model"); process.exit(1); }

  initLogger();
  const port = await startServer();
  const url = `http://127.0.0.1:${port}/`;
  openBrowser(url);
  console.log(`\u25b6 Dashboard: ${url}`);
  console.log(`  Log: ${logPath}`);
  console.log(`  Models: ${models.map((m) => m.name).join(", ")}`);
  console.log(`  Total calls: ~${models.length * 2 * 7} per run\n`);

  for (const { name, contextWindow, maxTokens } of models) {
    // Direct
    log({ type: "phase", phase: "direct", model: name, note: `Testing direct API for ${name}` });
    await probeEndpoint((t, m) => chatCompletion(apiKey, name, t, m), "direct", name, contextWindow, maxTokens);
    await delay(600);

    // GodeX
    log({ type: "phase", phase: "godex", model: name, note: `Testing GodeX for ${name}` });
    await probeEndpoint((t, m) => godexResponses(apiKey, name, t, m), "godex", name, contextWindow, maxTokens);
    await delay(600);
  }

  console.log("\n\u2713 All done. Close browser or Ctrl+C to stop.");
  appendFileSync(logPath, JSON.stringify({ type: "run-done", runId }) + "\n");
  await delay(3000);
}

main().catch(console.error);
