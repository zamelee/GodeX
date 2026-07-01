const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  const logs = [];
  page.on('console', m => { if(['error','warning'].includes(m.type())) logs.push('['+m.type()+'] ' + m.text()); });
  page.on('pageerror', e => logs.push('PAGEERR: ' + e.message));

  await page.addInitScript(() => {
    const MOCK_PROVIDERS = [
      { name: 'minnimax.chat', spec: 'minimax', base_url: 'https://minnimax.chat/v1', api_key: 'test-key' },
    ];
    const MOCK_ENABLED = [
      { provider: 'minnimax.chat', model: 'MiniMax-M2.7', context_window: 204800 },
      { provider: 'minnimax.chat', model: 'MiniMax-M2.7-highspeed', context_window: 204800 },
      { provider: 'minnimax.chat', model: 'MiniMax-M3', context_window: 1000000 },
      { provider: 'minnimax.chat', model: 'MiniMax-M3-7B', context_window: 128000 },
      { provider: 'minnimax.chat', model: 'MiniMax-M5-Pro', context_window: 500000 },
    ];
    window.__TAURI__ = {
      core: {
        invoke: function(cmd, args) {
          if (cmd === 'list_providers') return Promise.resolve(MOCK_PROVIDERS);
          if (cmd === 'read_enabled_models') return Promise.resolve({ enabled: MOCK_ENABLED });
          return Promise.reject(new Error('stubbed: ' + cmd));
        },
      },
      event: { listen: function(){ return Promise.resolve(function(){}); } },
    };
  });

  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/index.html');
  await page.waitForTimeout(1500);

  // Open probe modal
  await page.evaluate(() => {
    try { window.launchModelProbe(); } catch(e) { document.getElementById('probe-modal').style.display='flex'; }
  });
  await page.waitForTimeout(300);

  // Select minnimax.chat
  await page.evaluate(() => {
    const sel = document.getElementById('probe-provider');
    sel.value = 'minnimax.chat';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);

  const grid = await page.evaluate(() => {
    const items = document.querySelectorAll('#probe-models-list .probe-model-item');
    return {
      count: items.length,
      pills: Array.from(items).map(it => ({
        text: it.textContent.trim(),
        isCustom: it.classList.contains('custom'),
        isAddPill: it.classList.contains('add-pill'),
        checked: it.querySelector('input.probe-model-check')?.checked,
        value: it.querySelector('input.probe-model-check')?.value,
      })),
    };
  });
  console.log('=== Test 1: Select minnimax.chat ===');
  console.log('Count:', grid.count, '(expected 5+1=6)');
  console.log(JSON.stringify(grid.pills, null, 2));

  // Add custom
  await page.focus('.probe-custom-input');
  await page.type('.probe-custom-input', 'gpt-test-1');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);

  const g2 = await page.evaluate(() => {
    const items = document.querySelectorAll('#probe-models-list .probe-model-item');
    return {
      count: items.length,
      custom: Array.from(items).filter(it => it.classList.contains('custom')).map(it => ({
        text: it.textContent.trim(),
        borderColor: getComputedStyle(it).borderColor,
      })),
      addPillLast: items[items.length-1]?.classList.contains('add-pill'),
    };
  });
  console.log('\n=== Test 2: Add "gpt-test-1" ===');
  console.log('Count:', g2.count, '(expected 7)');
  console.log('Custom border:', g2.custom[0]?.borderColor);
  console.log('Add-pill at end:', g2.addPillLast);

  // Duplicate
  await page.focus('.probe-custom-input');
  await page.type('.probe-custom-input', 'gpt-test-1');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const g3 = await page.evaluate(() => document.querySelectorAll('#probe-models-list .probe-model-item').length);
  console.log('\n=== Test 3: Duplicate (should stay 7) ===');
  console.log('Count:', g3);

  // Add another
  await page.focus('.probe-custom-input');
  await page.type('.probe-custom-input', 'MiniMax-M9-Future');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const g4 = await page.evaluate(() => document.querySelectorAll('#probe-models-list .probe-model-item').length);
  console.log('\n=== Test 4: Add second custom (count 8) ===');
  console.log('Count:', g4);

  // Screenshot
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\probe_after_DI3_wide.png', fullPage: false});
  await page.setViewportSize({width: 760, height: 900});
  await page.waitForTimeout(300);
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\probe_after_DI3_narrow.png', fullPage: false});

  console.log('\n=== ERRORS / WARNINGS ===');
  logs.filter(l => !l.includes('stubbed:') && !l.includes('preset')).slice(0,5).forEach(l => console.log(' ', l));
  await browser.close();
})();
