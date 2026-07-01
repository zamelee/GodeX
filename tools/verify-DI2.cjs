const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  const logs = [];
  page.on('console', m => { if(['error','warning'].includes(m.type())) logs.push('['+m.type()+'] ' + m.text()); });
  page.on('pageerror', e => logs.push('PAGEERR: ' + e.message));

  // Smart Tauri stub: make invoke() return mock data for the things we need
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
          if (cmd === 'get_providers' || cmd === 'load_providers') {
            return Promise.resolve({ providers: MOCK_PROVIDERS, enabled: MOCK_ENABLED });
          }
          return Promise.reject(new Error('stubbed: ' + cmd));
        },
      },
      event: { listen: function(){ return Promise.resolve(function(){}); } },
    };
  });

  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/index.html');
  await page.waitForTimeout(1500);

  // Check that data loaded
  const dataLoaded = await page.evaluate(() => {
    return {
      // The vars are script-local, so we cannot access them directly. But we can check side effects:
      providerItems: document.getElementById('provider-items')?.textContent?.trim().slice(0,200),
      modelList: document.getElementById('model-list')?.textContent?.trim().slice(0,200),
    };
  });
  console.log('=== Data loaded check ===');
  console.log('provider items text:', dataLoaded.providerItems);
  console.log('model list text:', dataLoaded.modelList);

  // Open probe modal
  await page.evaluate(() => {
    try { window.launchModelProbe(); } catch(e) { document.getElementById('probe-modal').style.display='flex'; }
  });
  await page.waitForTimeout(300);

  // Check if dropdown has been populated by launchModelProbe
  const dropdownOptions = await page.evaluate(() => {
    const sel = document.getElementById('probe-provider');
    return Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent }));
  });
  console.log('Dropdown options:', JSON.stringify(dropdownOptions, null, 2));

  // Select minnimax.chat
  await page.evaluate(() => {
    const sel = document.getElementById('probe-provider');
    sel.value = 'minnimax.chat';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);

  // Verify pills
  const grid = await page.evaluate(() => {
    const items = document.querySelectorAll('#probe-models-list .probe-model-item');
    return {
      count: items.length,
      pills: Array.from(items).map(it => ({
        text: it.textContent.trim(),
        hasInput: !!it.querySelector('input.probe-model-check'),
        isCustom: it.classList.contains('custom'),
        isAddPill: it.classList.contains('add-pill'),
        checked: it.querySelector('input.probe-model-check')?.checked,
        value: it.querySelector('input.probe-model-check')?.value,
      })),
    };
  });
  console.log('\n=== Test 1: Select minnimax.chat (5 enabled + 1 add = 6) ===');
  console.log('Count:', grid.count, '(expected 6)');
  console.log(JSON.stringify(grid.pills, null, 2));

  // Add custom via Enter
  await page.focus('.probe-custom-input');
  await page.type('.probe-custom-input', 'gpt-test-1');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);

  const grid2 = await page.evaluate(() => {
    const items = document.querySelectorAll('#probe-models-list .probe-model-item');
    return {
      count: items.length,
      customItems: Array.from(items).filter(it => it.classList.contains('custom')).map(it => ({
        text: it.textContent.trim(),
        value: it.querySelector('input.probe-model-check')?.value,
        checked: it.querySelector('input.probe-model-check')?.checked,
        borderColor: getComputedStyle(it).borderColor,
      })),
      addPillStillLast: items[items.length-1]?.classList.contains('add-pill'),
    };
  });
  console.log('\n=== Test 2: Add custom "gpt-test-1" ===');
  console.log('Count:', grid2.count, '(expected 7)');
  console.log('Custom pill border:', grid2.customItems);
  console.log('Add-pill still at end:', grid2.addPillStillLast);

  // Add duplicate (should be ignored)
  await page.focus('.probe-custom-input');
  await page.type('.probe-custom-input', 'gpt-test-1');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const grid3 = await page.evaluate(() => document.querySelectorAll('#probe-models-list .probe-model-item').length);
  console.log('\n=== Test 3: Duplicate "gpt-test-1" (should stay 7) ===');
  console.log('Count:', grid3);

  // Add another
  await page.focus('.probe-custom-input');
  await page.type('.probe-custom-input', 'MiniMax-M9-Future');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const grid4 = await page.evaluate(() => document.querySelectorAll('#probe-models-list .probe-model-item').length);
  console.log('\n=== Test 4: Add "MiniMax-M9-Future" ===');
  console.log('Count:', grid4, '(expected 8)');

  // Screenshot
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\probe_after_DI2_wide.png', fullPage: false});
  await page.setViewportSize({width: 760, height: 900});
  await page.waitForTimeout(300);
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\probe_after_DI2_narrow.png', fullPage: false});

  // Check that startProbeRun still works (reads .probe-model-check:checked)
  // We won't actually run it, just verify the check would find items
  const checkCount = await page.evaluate(() => document.querySelectorAll('.probe-model-check:checked').length);
  console.log('\n=== Test 5: pre-probe check ===');
  console.log('.probe-model-check:checked count:', checkCount, '(expected 8)');

  console.log('\n=== ERRORS / WARNINGS ===');
  logs.filter(l => !l.includes('stubbed:') && !l.includes('preset') && !l.includes('reset ext mode')).slice(0,5).forEach(l => console.log(' ', l));
  await browser.close();
})();
