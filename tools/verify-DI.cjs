const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  const logs = [];
  page.on('console', m => { if(['error','warning'].includes(m.type())) logs.push('['+m.type()+'] ' + m.text()); });
  page.on('pageerror', e => logs.push('PAGEERR: ' + e.message));

  await page.addInitScript(() => {
    window.__TAURI__ = {
      core: { invoke: function(){ return Promise.reject(new Error('stubbed')); } },
      event: { listen: function(){ return Promise.resolve(function(){}); } },
    };
  });

  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/index.html');
  await page.waitForTimeout(1000);

  // Inject mock data BEFORE opening the modal
  await page.evaluate(() => {
    window.providers = [
      { name: 'minnimax.chat', spec: 'minimax', base_url: 'https://minnimax.chat/v1', api_key: 'test-key' },
      { name: 'other', spec: 'openai', base_url: 'https://api.other.com/v1', api_key: 'k2' },
    ];
    window.enabled = [
      { provider: 'minnimax.chat', model: 'MiniMax-M2.7', context_window: 204800 },
      { provider: 'minnimax.chat', model: 'MiniMax-M2.7-highspeed', context_window: 204800 },
      { provider: 'minnimax.chat', model: 'MiniMax-M3', context_window: 1000000 },
      { provider: 'minnimax.chat', model: 'MiniMax-M3-7B', context_window: 128000 },
      { provider: 'minnimax.chat', model: 'MiniMax-M5-Pro', context_window: 500000 },
    ];
    // Populate dropdown
    const sel = document.getElementById('probe-provider');
    sel.innerHTML = '<option value="">-- 选择 Provider --</option>';
    window.providers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name; opt.textContent = p.name;
      sel.appendChild(opt);
    });
  });

  // Open probe modal
  await page.evaluate(() => {
    try { window.launchModelProbe(); } catch(e) { document.getElementById('probe-modal').style.display='flex'; }
  });
  await page.waitForTimeout(300);

  // ----- Test 1: Select provider -> grid of pills -----
  await page.evaluate(() => {
    const sel = document.getElementById('probe-provider');
    sel.value = 'minnimax.chat';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);

  const grid1 = await page.evaluate(() => {
    const items = document.querySelectorAll('#probe-models-list .probe-model-item');
    return {
      count: items.length,
      pills: Array.from(items).map(it => ({
        text: it.textContent.trim(),
        hasInput: !!it.querySelector('input.probe-model-check'),
        isCustom: it.classList.contains('custom'),
        isAddPill: it.classList.contains('add-pill'),
        inputChecked: it.querySelector('input.probe-model-check')?.checked,
      })),
    };
  });
  console.log('=== Test 1: Select minnimax.chat ===');
  console.log('Pill count (should be 5 enabled + 1 add = 6):', grid1.count);
  console.log(JSON.stringify(grid1.pills, null, 2));

  // ----- Test 2: Switch to provider with no models -----
  await page.evaluate(() => {
    const sel = document.getElementById('probe-provider');
    sel.value = 'other';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  const grid2 = await page.evaluate(() => ({
    count: document.querySelectorAll('#probe-models-list .probe-model-item').length,
    emptyMsg: document.querySelector('#probe-models-list > div[style*="text2"]')?.textContent || null,
  }));
  console.log('\n=== Test 2: Switch to "other" (no enabled models) ===');
  console.log(JSON.stringify(grid2, null, 2));

  // ----- Test 3: Switch back, add custom model -----
  await page.evaluate(() => {
    const sel = document.getElementById('probe-provider');
    sel.value = 'minnimax.chat';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);

  // Type and Enter
  await page.focus('.probe-custom-input');
  await page.type('.probe-custom-input', 'gpt-test-1');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);

  const grid3 = await page.evaluate(() => {
    const items = document.querySelectorAll('#probe-models-list .probe-model-item');
    return {
      count: items.length,
      custom: Array.from(items).filter(it => it.classList.contains('custom')).map(it => ({
        text: it.textContent.trim(),
        inputValue: it.querySelector('input.probe-model-check')?.value,
        checked: it.querySelector('input.probe-model-check')?.checked,
      })),
      checkedCount: document.querySelectorAll('.probe-model-check:checked').length,
    };
  });
  console.log('\n=== Test 3: Add "gpt-test-1" via Enter ===');
  console.log(JSON.stringify(grid3, null, 2));

  // ----- Test 4: Add duplicate (should be ignored) -----
  await page.focus('.probe-custom-input');
  await page.type('.probe-custom-input', 'gpt-test-1');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const grid4 = await page.evaluate(() => ({
    count: document.querySelectorAll('#probe-models-list .probe-model-item').length,
    customCount: document.querySelectorAll('#probe-models-list .probe-model-item.custom').length,
  }));
  console.log('\n=== Test 4: Duplicate "gpt-test-1" (should be ignored) ===');
  console.log('count:', grid4.count, ' (should equal test 3 count)');
  console.log('custom count:', grid4.customCount, ' (should be 1)');

  // ----- Test 5: Add another custom with ctx -----
  await page.focus('.probe-custom-input');
  await page.type('.probe-custom-input', 'MiniMax-M9-Future');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);

  // Check class on custom pill
  const customStyles = await page.evaluate(() => {
    const customPills = document.querySelectorAll('#probe-models-list .probe-model-item.custom');
    return Array.from(customPills).map(it => {
      const cs = getComputedStyle(it);
      return { text: it.textContent.trim(), borderColor: cs.borderColor, hasPlusSign: it.querySelector('.model-name')?.textContent?.includes('✚') };
    });
  });
  console.log('\n=== Test 5: Add "MiniMax-M9-Future" ===');
  console.log(JSON.stringify(customStyles, null, 2));

  // ----- Test 6: Click checkbox to uncheck -----
  await page.evaluate(() => {
    const firstChk = document.querySelector('.probe-model-check');
    if (firstChk) firstChk.checked = false;
  });
  const checked6 = await page.evaluate(() => document.querySelectorAll('.probe-model-check:checked').length);
  console.log('\n=== Test 6: Uncheck first ===');
  console.log('checked count (was 7, now 6):', checked6);

  // Screenshot
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\probe_after_DI_wide.png', fullPage: false});
  await page.setViewportSize({width: 760, height: 900});
  await page.waitForTimeout(300);
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\probe_after_DI_narrow.png', fullPage: false});

  console.log('\n=== ERRORS / WARNINGS ===');
  logs.filter(l => !l.includes('stubbed')).slice(0,5).forEach(l => console.log(' ', l));
  await browser.close();
})();
