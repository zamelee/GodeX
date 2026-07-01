const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  const logs = [];
  page.on('console', m => logs.push('['+m.type()+'] ' + m.text()));
  await page.addInitScript(() => {
    window.__TAURI__ = {
      core: { invoke: function(){ return Promise.reject(new Error('stubbed')); } },
      event: { listen: function(){ return Promise.resolve(function(){}); } },
    };
  });
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/index.html');
  await page.waitForTimeout(1000);

  // Open probe modal
  await page.evaluate(() => {
    const fn = window.launchModelProbe || (() => document.getElementById('probe-modal').style.display='flex');
    try { fn(); } catch(e) { document.getElementById('probe-modal').style.display='flex'; }
  });
  await page.waitForTimeout(500);

  // Try to populate provider dropdown
  await page.evaluate(() => {
    const sel = document.getElementById('probe-provider');
    const opt1 = document.createElement('option');
    opt1.value = 'minnimax.chat'; opt1.text = 'minnimax.chat';
    sel.appendChild(opt1);
    const opt2 = document.createElement('option');
    opt2.value = 'other.provider'; opt2.text = 'other.provider';
    sel.appendChild(opt2);
    // Try populate models for first
    try { sel.value = 'minnimax.chat'; sel.dispatchEvent(new Event('change')); } catch(e) {}
  });
  await page.waitForTimeout(300);

  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\probe_current.png', fullPage: true});
  console.log('Screenshot saved.');
  console.log('Errors:', logs.filter(l => l.startsWith('[error]') || l.startsWith('[warning]')).slice(0,5));
  await browser.close();
})();
