/* Patch studio-tauri/src/index.html - 4 edits for #7
   1. stripUndef: pass through reasoning, probe_raw, probed_at
   2. Add validateModel() + parseProbedAt() + formatProbeAge()
   3. Hook validateModel into saveEnabled
   4. renderModels: reasoning select + probe freshness badge
   File is CRLF. */
const fs = require("fs");
const path = "studio-tauri/src/index.html";
let s = fs.readFileSync(path, "utf8");
const CRLF = "\r\n";
const findReplace = (find, repl) => {
  if (!s.includes(find)) { console.error("NOT FOUND:\n" + find.slice(0, 250)); process.exit(1); }
  s = s.replace(find, repl);
};

/* === Edit 1: stripUndef - add new fields === */
findReplace(
  "function stripUndef(o) {" + CRLF +
  "  const out = { provider: o.provider, model: o.model };" + CRLF +
  "  if (o.id) out.id = String(o.id);" + CRLF +
  "  if (o.context_window !== undefined && o.context_window !== null) out.context_window = o.context_window;" + CRLF +
  "  if (o.max_tokens !== undefined && o.max_tokens !== null) out.max_tokens = o.max_tokens;" + CRLF +
  "  if (o.margin !== undefined && o.margin !== null) out.margin = o.margin;" + CRLF +
  "  if (o.multimodal !== undefined) out.multimodal = !!o.multimodal;" + CRLF +
  "  if (o.capabilities && typeof o.capabilities === \"object\") {",
  "function stripUndef(o) {" + CRLF +
  "  const out = { provider: o.provider, model: o.model };" + CRLF +
  "  if (o.id) out.id = String(o.id);" + CRLF +
  "  if (o.context_window !== undefined && o.context_window !== null) out.context_window = o.context_window;" + CRLF +
  "  if (o.max_tokens !== undefined && o.max_tokens !== null) out.max_tokens = o.max_tokens;" + CRLF +
  "  if (o.margin !== undefined && o.margin !== null) out.margin = o.margin;" + CRLF +
  "  if (o.reasoning != null && o.reasoning !== \"\") out.reasoning = String(o.reasoning);" + CRLF +
  "  if (o.probe_raw != null && Number.isFinite(o.probe_raw)) out.probe_raw = Math.floor(o.probe_raw);" + CRLF +
  "  if (o.probed_at) out.probed_at = String(o.probed_at);" + CRLF +
  "  if (o.multimodal !== undefined) out.multimodal = !!o.multimodal;" + CRLF +
  "  if (o.capabilities && typeof o.capabilities === \"object\") {"
);
console.log("Edit 1 done (stripUndef)");

/* === Edit 2: Add validateModel + parseProbedAt + formatProbeAge === */
findReplace(
  "async function saveProvider() {" + CRLF +
  "  if (!activeProvider) return;" + CRLF +
  "  const origName = $(\"form-provider-name\").textContent;" + CRLF +
  "  const base_url = $(\"f-base_url\").value.trim();" + CRLF +
  "  const api_key = $(\"f-api_key\").value.trim();",
  "/** ABE validation. Returns null on success, or an error string describing the failure." + CRLF +
  " *  A: context_window must be >= 1 when present." + CRLF +
  " *  B: max_tokens must not exceed context_window when both are set. */" + CRLF +
  "function validateModel(m) {" + CRLF +
  "  const cw = m.context_window;" + CRLF +
  "  const mt = m.max_tokens;" + CRLF +
  "  if (cw != null && Number.isFinite(cw) && cw < 1) return \"上下文必须 >= 1\";" + CRLF +
  "  if (cw != null && mt != null && Number.isFinite(cw) && Number.isFinite(mt) && mt > cw) {" + CRLF +
  "    return \"输出上限不能超过上下文 (max=\" + mt + \" > ctx=\" + cw + \")\";" + CRLF +
  "  }" + CRLF +
  "  if (m.margin != null && (m.margin < 0 || m.margin > 1)) return \"余量必须在 0-100% 之间\";" + CRLF +
  "  if (m.reasoning != null && m.reasoning !== \"\") {" + CRLF +
  "    const r = String(m.reasoning);" + CRLF +
  "    if (![\"none\", \"enabled\", \"max\"].includes(r)) return \"reasoning 必须是 none / enabled / max\";" + CRLF +
  "  }" + CRLF +
  "  return null;" + CRLF +
  "}" + CRLF + CRLF +
  "/** Parse an ISO-8601 timestamp; return ms-since-epoch or null on failure. */" + CRLF +
  "function parseProbedAt(s) {" + CRLF +
  "  if (!s) return null;" + CRLF +
  "  const t = Date.parse(s);" + CRLF +
  "  return Number.isFinite(t) ? t : null;" + CRLF +
  "}" + CRLF + CRLF +
  "/** Format probe age: just now / N min ago / N hr ago / N days ago. */" + CRLF +
  "function formatProbeAge(probedAtMs) {" + CRLF +
  "  const ms = Date.now() - probedAtMs;" + CRLF +
  "  if (ms < 60_000) return \"刚刚\";" + CRLF +
  "  if (ms < 3_600_000) return Math.floor(ms / 60_000) + \" 分钟前\";" + CRLF +
  "  if (ms < 86_400_000) return Math.floor(ms / 3_600_000) + \" 小时前\";" + CRLF +
  "  return Math.floor(ms / 86_400_000) + \" 天前\";" + CRLF +
  "}" + CRLF + CRLF +
  "async function saveProvider() {" + CRLF +
  "  if (!activeProvider) return;" + CRLF +
  "  const origName = $(\"form-provider-name\").textContent;" + CRLF +
  "  const base_url = $(\"f-base_url\").value.trim();" + CRLF +
  "  const api_key = $(\"f-api_key\").value.trim();"
);
console.log("Edit 2 done (validateModel + helpers)");

/* === Edit 3: Hook validateModel into saveEnabled === */
findReplace(
  "async function saveEnabled() {" + CRLF +
  "  if (!activeProvider) return;" + CRLF +
  "  let all;" + CRLF +
  "  try { all = await invoke(\"read_enabled_models\"); }" + CRLF +
  "  catch (e) { showMsg(\"读取失败: \" + e, \"err\"); return; }",
  "async function saveEnabled() {" + CRLF +
  "  if (!activeProvider) return;" + CRLF +
  "  // ABE validation: catch bad inputs before round-tripping through Rust." + CRLF +
  "  for (const m of enabled) {" + CRLF +
  "    const err = validateModel(m);" + CRLF +
  "    if (err) { showMsg(\"校验失败 [\" + esc(m.model) + \"]: \" + err, \"err\"); return; }" + CRLF +
  "  }" + CRLF +
  "  let all;" + CRLF +
  "  try { all = await invoke(\"read_enabled_models\"); }" + CRLF +
  "  catch (e) { showMsg(\"读取失败: \" + e, \"err\"); return; }"
);
console.log("Edit 3 done (saveEnabled validate)");

/* === Edit 4: renderModels - reasoning select + probe freshness badge === */
findReplace(
  "    html += '<div class=\"params\">';" + CRLF +
  "    html += `<label>上下文</label><input type=\"number\" min=\"0\" placeholder=\"(留空)\" value=\"${m.context_window ?? \"\"}\" oninput=\"setModelParam('${mid}','context_window',this.value)\"/>`;" + CRLF +
  "    html += `<label>输出上限</label><input type=\"number\" min=\"0\" placeholder=\"(留空)\" value=\"${m.max_tokens ?? \"\"}\" oninput=\"setModelParam('${mid}','max_tokens',this.value)\"/>`;" + CRLF +
  "    html += '</div>';" + CRLF +
  "    html += '<div class=\"params\">';" + CRLF +
  "    const margin = m.margin != null ? m.margin : 0.95;" + CRLF +
  "    html += `<label>余量</label><input type=\"range\" min=\"0\" max=\"100\" value=\"${Math.round(margin * 100)}\" style=\"width:70px\" oninput=\"setModelParam('${mid}','margin',(this.value/100).toFixed(3))\"/><span style=\"font-size:11px;color:var(--text2);min-width:32px\">${Math.round(margin * 100)}%</span>`;" + CRLF +
  "    html += '</div>';",
  "    html += '<div class=\"params\">';" + CRLF +
  "    html += `<label>上下文</label><input type=\"number\" min=\"1\" placeholder=\"(留空)\" value=\"${m.context_window ?? \"\"}\" oninput=\"setModelParam('${mid}','context_window',this.value)\"/>`;" + CRLF +
  "    html += `<label>输出上限</label><input type=\"number\" min=\"1\" placeholder=\"(留空)\" value=\"${m.max_tokens ?? \"\"}\" oninput=\"setModelParam('${mid}','max_tokens',this.value)\"/>`;" + CRLF +
  "    // Probe freshness badge: cyan if fresh, yellow if > 30d, hidden if never probed." + CRLF +
  "    const probedAtMs = parseProbedAt(m.probed_at);" + CRLF +
  "    if (probedAtMs) {" + CRLF +
  "      const ageMs = Date.now() - probedAtMs;" + CRLF +
  "      const isStale = ageMs > 30 * 86_400_000;" + CRLF +
  "      const badgeColor = isStale ? \"var(--yellow)\" : \"var(--blue)\";" + CRLF +
  "      const badgeBg = isStale ? \"rgba(210,153,34,.15)\" : \"rgba(88,166,255,.15)\";" + CRLF +
  "      const raw = m.probe_raw != null ? \"raw \" + Number(m.probe_raw).toLocaleString() + \" / \" : \"\";" + CRLF +
  "      html += `<span title=\"# probe_raw / # probed_at from yaml\" style=\"display:inline-block;margin-left:4px;padding:1px 6px;border-radius:3px;font-size:9px;background:${badgeBg};color:${badgeColor};cursor:help\">${raw}探测 ${esc(formatProbeAge(probedAtMs))}</span>`;" + CRLF +
  "    }" + CRLF +
  "    html += '</div>';" + CRLF +
  "    html += '<div class=\"params\">';" + CRLF +
  "    const margin = m.margin != null ? m.margin : 0.95;" + CRLF +
  "    html += `<label>余量</label><input type=\"range\" min=\"0\" max=\"100\" value=\"${Math.round(margin * 100)}\" style=\"width:70px\" oninput=\"setModelParam('${mid}','margin',(this.value/100).toFixed(3))\"/><span style=\"font-size:11px;color:var(--text2);min-width:32px\">${Math.round(margin * 100)}%</span>`;" + CRLF +
  "    const curReasoning = m.reasoning || \"none\";" + CRLF +
  "    html += `<label style=\"margin-left:8px\">推理</label><select style=\"width:auto;min-width:80px\" onchange=\"setModelParam('${mid}','reasoning',this.value)\" title=\"OpenAI reasoning effort (传递到 Codex 端)\">`;" + CRLF +
  "    for (const [v, lab] of [[\"none\", \"无\"], [\"enabled\", \"开启\"], [\"max\", \"最大\"]]) {" + CRLF +
  "      html += `<option value=\"${v}\" ${v === curReasoning ? \"selected\" : \"\"}>${lab}</option>`;" + CRLF +
  "    }" + CRLF +
  "    html += '</select>';" + CRLF +
  "    html += '</div>';"
);
console.log("Edit 4 done (renderModels)");

fs.writeFileSync(path, s);
console.log("OK: wrote", path);