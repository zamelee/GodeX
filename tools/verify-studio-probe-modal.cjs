// verify-studio-probe-modal.cjs
// 加载 studio index.html，stub Tauri invoke，验证：
// 1. 主页面正确加载
// 2. 点 "模型探测" 按钮弹出 modal
// 3. Provider 下拉列表正确填充
// 4. 选 Provider 后，已启用模型列表正确显示
// 5. 控制台没有报错
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  page.on('console', m => {
    if (['error', 'warning'].includes(m.type())) errs.push('[' + m.type() + '] ' + m.text());
  });

  // ---- stub Tauri APIs ----
  await page.addInitScript(() => {
    const stubProviders = [
      { name: 'minnimax.chat', base_url: 'https://minnimax.chat/v1', api_key: 'gw-ced****', spec: 'minimax' },
      { name: 'openai',        base_url: 'https://api.openai.com/v1', api_key: 'sk-****', spec: 'openai' },
    ];
    const stubEnabled = [
      { provider: 'minnimax.chat', model: 'MiniMax-M2.7',         context_window: 204800, max_tokens: 8192 },
      { provider: 'minnimax.chat', model: 'MiniMax-M2.7-highspeed', context_window: 204800, max_tokens: 8192 },
      { provider: 'minnimax.chat', model: 'MiniMax-M3',            context_window: 1000000, max_tokens: 131072 },
      { provider: 'openai',        model: 'gpt-4o',                 context_window: 128000, max_tokens: 16384 },
    ];
    const stubPresets = [
      { model: 'gpt-4o',           context_window: 128000, max_tokens: 16384 },
      { model: 'gpt-4o-mini',      context_window: 128000, max_tokens: 16384 },
      { model: 'MiniMax-M3',       context_window: 1000000, max_tokens: 131072 },
    ];
    const inv = (cmd, args) => {
      // simulate IPC roundtrip
      switch (cmd) {
        case 'list_providers':         return Promise.resolve(stubProviders);
        case 'read_enabled_models':    return Promise.resolve({ enabled: stubEnabled, disabled: [] });
        case 'load_model_presets':     return Promise.resolve(stubPresets);
        case 'match_model_preset':     return Promise.resolve(null);
        case 'get_config_paths':       return Promise.resolve({ godex_config: '/x/godex.yaml', godex_binary: '/x/godex.exe', godex_log: '/x/godex.log', studio_log: '/x/studio.log' });
        case 'godex_status':           return Promise.resolve({ running: true, port: 5678, pid: 4360, mode: 'builtin' });
        case 'godex_logs_tail':        return Promise.resolve([]);
        case 'tail_trace_logs':        return Promise.resolve([]);
        case 'get_replica_status':     return Promise.resolve({ enabled: false, running: false, pid: null, replica_path: null });
        default: return Promise.resolve(null);
      }
    };
    window.__TAURI__ = {
      core: { invoke: inv },
      event: { listen: () => Promise.resolve(() => {}) },
      dialog: { open: () => Promise.resolve(null) },
    };
  });

  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/index.html');
  await page.waitForTimeout(800);

  // 1) main page ready
  const mainReady = await page.evaluate(() => ({
    title: document.title,
    btnProbeExists: !!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('模型探测')),
    providersLoaded: (window.providers ?? []).length,
    enabledLoaded: (window.enabled ?? []).length,
  }));
  console.log('[1] main page ready:', mainReady);

  // 2) click 模型探测 button
  await page.evaluate(() => { launchModelProbe(); });
  await page.waitForTimeout(300);
  const modalShown = await page.evaluate(() => {
    const m = document.getElementById('probe-modal');
    return { exists: !!m, display: m?.style.display };
  });
  console.log('[2] probe modal:', modalShown);

  // 3) Provider dropdown
  const providers = await page.evaluate(() => {
    const sel = document.getElementById('probe-provider');
    return Array.from(sel?.options ?? []).map(o => o.value);
  });
  console.log('[3] probe provider options:', providers);

  // 4) pick minnimax.chat and check models list
  await page.evaluate(() => {
    const sel = document.getElementById('probe-provider');
    sel.value = 'minnimax.chat';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  const modelsShown = await page.evaluate(() => {
    const list = document.getElementById('probe-models-list');
    return Array.from(list?.querySelectorAll('.probe-model-item:not(.add-pill)') ?? [])
      .map(el => el.querySelector('.model-name')?.textContent?.trim())
      .filter(Boolean);
  });
  console.log('[4] probe models for minnimax.chat:', modelsShown);

  // 5) capability checkboxes
  const caps = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('.probe-cap-item, label')).map(l => l.textContent.trim()).filter(t => t && t.length < 50);
    return labels;
  });
  console.log('[5] probe caps labels (first 20):', caps.slice(0, 20));

  console.log('\nERRORS:', errs.length === 0 ? 'NONE' : errs);
  await browser.close();
})();