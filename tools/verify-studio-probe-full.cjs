// verify-studio-probe-full.cjs
// 加载真实 godex.yaml，把里面的 provider 直接喂给 stub Tauri.invoke("list_providers")
// 然后跑 launchModelProbe -> onProbeProviderChange -> 检查模型列表渲染
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  // Load godex.yaml and convert to ProviderInfo JSON (same shape backend returns)
  const yamlRaw = fs.readFileSync('D:/Documents/VibeCoding/GodeX/godex.yaml', 'utf8');
  const lines = yamlRaw.split(/\r?\n/);
  const providers = [];
  let inProv = false, cur = null;
  for (const ln of lines) {
    if (ln.startsWith('providers:')) { inProv = true; continue; }
    if (inProv && ln && !ln.startsWith(' ') && !ln.startsWith('\t')) { inProv = false; continue; }
    if (!inProv) continue;
    const trimmed = ln.trimStart();
    const indent = ln.length - trimmed.length;
    if (indent === 2 && trimmed && !trimmed.startsWith('#')) {
      if (cur) providers.push(cur);
      cur = { name: trimmed.replace(':',''), spec:'', base_url:'', api_key:'', timeout_ms: 120000 };
      continue;
    }
    if (cur) {
      if (trimmed.startsWith('spec:'))       cur.spec       = trimmed.slice(5).trim();
      else if (trimmed.startsWith('base_url:')) cur.base_url = trimmed.slice(9).trim();
      else if (trimmed.startsWith('api_key:'))  cur.api_key  = trimmed.slice(8).trim();
      else if (trimmed.startsWith('timeout_ms:')) cur.timeout_ms = parseInt(trimmed.slice(11).trim()) || 120000;
    }
  }
  if (cur) providers.push(cur);
  console.log('STUB providers:', providers.map(p => p.name).join(', '));

  // Also build enabled models
  const enabled = [
    { provider: 'minnimax.chat', model: 'MiniMax-M2.7',          context_window: 1430584, max_tokens: 196608 },
    { provider: 'minnimax.chat', model: 'MiniMax-M2.7-highspeed', context_window: 1271631, max_tokens: 196608 },
    { provider: 'minnimax.chat', model: 'MiniMax-M3',             context_window: 4967702, max_tokens: 200000 },
    { provider: 'deepseek',      model: 'deepseek-chat',          context_window: 128000,  max_tokens: 8192 },
  ];

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  page.on('console', m => {
    if (['error', 'warning', 'log'].includes(m.type())) errs.push('[' + m.type() + '] ' + m.text());
  });

  await page.addInitScript((stubProviders, stubEnabled) => {
    window.__TAURI__ = {
      core: { invoke: (cmd, args) => {
        switch (cmd) {
          case 'list_providers':       return Promise.resolve(stubProviders);
          case 'read_enabled_models':  return Promise.resolve({ enabled: stubEnabled, disabled: [] });
          case 'load_model_presets':   return Promise.resolve([]);
          case 'match_model_preset':   return Promise.resolve(null);
          case 'get_config_paths':     return Promise.resolve({ godex_config: '/x/godex.yaml', godex_binary: '/x/godex.exe', godex_log: '/x/godex.log', studio_log: '/x/studio.log' });
          case 'godex_status':         return Promise.resolve({ running: true, port: 5678, pid: 4360, mode: 'builtin' });
          case 'godex_logs_tail':      return Promise.resolve([]);
          case 'tail_trace_logs':      return Promise.resolve([]);
          case 'get_replica_status':   return Promise.resolve({ enabled: false, running: false, pid: null, replica_path: null });
          case 'fetch_remote_models':  return Promise.resolve([]);
          default: return Promise.resolve(null);
        }
      }},
      event: { listen: () => Promise.resolve(() => {}) },
    };
  }, providers, enabled);

  console.log('goto...');
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/index.html', { waitUntil: 'load' });
  console.log('loaded, waiting 1.5s for init...');
  await page.waitForTimeout(1500);

  // Probe state
  const state = await page.evaluate(() => ({
    providersLen: (window.providers || []).length,
    providersNames: (window.providers || []).map(p => p.name),
    enabledLen: (window.enabled || []).length,
  }));
  console.log('STATE after init:', state);

  // Click 模型探测 button
  await page.evaluate(() => { launchModelProbe(); });
  await page.waitForTimeout(400);

  const modal = await page.evaluate(() => {
    const sel = document.getElementById('probe-provider');
    return {
      display: document.getElementById('probe-modal')?.style.display,
      providerOptions: Array.from(sel?.options || []).map(o => o.value),
    };
  });
  console.log('MODAL state:', modal);

  // Select minnimax.chat
  await page.evaluate(() => {
    const sel = document.getElementById('probe-provider');
    sel.value = 'minnimax.chat';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(400);

  const models = await page.evaluate(() => {
    const list = document.getElementById('probe-models-list');
    return {
      html: list?.innerHTML?.slice(0, 500),
      items: Array.from(list?.querySelectorAll('.probe-model-item:not(.add-pill)') || [])
        .map(el => el.querySelector('.model-name')?.textContent?.trim()),
    };
  });
  console.log('MODELS after pick minnimax.chat:', models);

  console.log('\nERRORS:', errs.length === 0 ? 'NONE' : errs.slice(0, 10));
  await browser.close();
})().catch(e => { console.log('CAUGHT:', e.message); process.exit(1); });