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
  await page.waitForTimeout(1200);

  // open probe modal
  await page.evaluate(() => { try{window.launchModelProbe();}catch(e){document.getElementById('probe-modal').style.display='flex';} });
  await page.waitForTimeout(400);

  // Verify structure
  const structure = await page.evaluate(() => {
    const items = document.querySelectorAll('.cap-item');
    const out = {
      capItemCount: items.length,
      capZhCount: document.querySelectorAll('.cap-zh').length,
      capTopCount: document.querySelectorAll('.cap-top').length,
      capItems: Array.from(items).map(it => ({
        id: it.querySelector('input')?.id,
        checked: it.querySelector('input')?.checked,
        en: it.querySelector('.cap-top > span:nth-child(2)')?.textContent,
        zh: it.querySelector('.cap-zh')?.textContent,
        // measure
        rect: it.getBoundingClientRect().toJSON(),
        cssFontSize: getComputedStyle(it.querySelector('.cap-zh')).fontSize,
      })),
    };
    return out;
  });
  console.log('Structure:', JSON.stringify(structure, null, 2));

  // Screenshot 1280x900
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\probe_after_A_wide.png', fullPage: false});

  // Narrow viewport
  await page.setViewportSize({width: 760, height: 900});
  await page.waitForTimeout(300);
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\probe_after_A_narrow.png', fullPage: false});

  console.log('Console logs:', logs);
  await browser.close();
})();
