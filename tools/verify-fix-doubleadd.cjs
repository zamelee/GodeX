const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1100, height: 1000}});
  const logs = [];
  page.on('pageerror', e => logs.push('ERR: ' + e.message));
  await page.addInitScript(() => {
    window.__TAURI__ = {
      core: { invoke: function(c){ if(c==='list_providers')return Promise.resolve([{name:'minnimax.chat',base_url:'https://minnimax.chat/v1',api_key:'k'},{name:'other.api',base_url:'https://api.other.com/v1',api_key:'k'}]);if(c==='read_enabled_models')return Promise.resolve({enabled:[{provider:'minnimax.chat',model:'MiniMax-M2.7',context_window:204800},{provider:'minnimax.chat',model:'MiniMax-M3',context_window:1000000}]});return Promise.reject(new Error('stub:'+c));},},
      event: { listen: function(){ return Promise.resolve(function(){}); } },
    };
  });
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/index.html');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { try { window.launchModelProbe(); } catch(e) {} });
  await page.waitForTimeout(300);

  // Test empty provider (other.api has 0 enabled models)
  await page.evaluate(() => {
    const sel = document.getElementById('probe-provider');
    sel.value = 'other.api';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  const result1 = await page.evaluate(() => {
    const items = document.querySelectorAll('#probe-models-list .probe-model-item');
    const addPills = document.querySelectorAll('#probe-models-list .probe-model-item.add-pill');
    return {
      totalPills: items.length,
      addPills: addPills.length,
      emptyMsg: document.querySelector('#probe-models-list > div')?.textContent || null,
    };
  });
  console.log('=== Empty Provider ===');
  console.log('total pills:', result1.totalPills, '(expected: 1 add-pill only)');
  console.log('add-pills:', result1.addPills, '(expected: 1, was 2 before fix)');
  console.log('empty msg:', result1.emptyMsg);

  // Test no provider
  await page.evaluate(() => {
    const sel = document.getElementById('probe-provider');
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  const result2 = await page.evaluate(() => {
    const items = document.querySelectorAll('#probe-models-list .probe-model-item');
    const addPills = document.querySelectorAll('#probe-models-list .probe-model-item.add-pill');
    return {
      totalPills: items.length,
      addPills: addPills.length,
    };
  });
  console.log('\n=== No Provider ===');
  console.log('total pills:', result2.totalPills);
  console.log('add-pills:', result2.addPills, '(expected: 1)');

  // Test loaded
  await page.evaluate(() => {
    const sel = document.getElementById('probe-provider');
    sel.value = 'minnimax.chat';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  const result3 = await page.evaluate(() => {
    const items = document.querySelectorAll('#probe-models-list .probe-model-item');
    const addPills = document.querySelectorAll('#probe-models-list .probe-model-item.add-pill');
    return { totalPills: items.length, addPills: addPills.length };
  });
  console.log('\n=== Loaded (2 enabled) ===');
  console.log('total pills:', result3.totalPills, '(expected: 2 enabled + 1 add = 3)');
  console.log('add-pills:', result3.addPills, '(expected: 1)');

  console.log('\nerrors:', logs);
  await browser.close();
})();
