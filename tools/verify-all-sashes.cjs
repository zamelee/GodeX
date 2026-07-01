const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  await page.addInitScript(() => {
    window.__TAURI__ = {
      core: { invoke: function(){ return Promise.reject(new Error('stubbed')); } },
      event: { listen: function(){ return Promise.resolve(function(){}); } },
    };
  });
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/index.html');
  await page.waitForTimeout(1500);

  const getRect = (id) => page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  }, id);

  async function dragSash(id, dx, dy) {
    const t = await getRect(id);
    if (!t) return { id, ok: false, reason: 'not found' };
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + dx, t.y + dy, {steps: 8});
    await page.mouse.up();
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => {
      const states = {};
      ['sash-main-log','sash-cols','sash-forms'].forEach(sid => {
        const el = document.getElementById(sid);
        states[sid] = el ? { mainFlex: document.querySelector('main').style.flex } : { missing: true };
      });
      return states;
    });
    return { id, target: t, after };
  }

  // Test 1: sash-main-log (vertical drag)
  const r1 = await dragSash('sash-main-log', 0, -150);

  // Reset main/log ratio for next test
  await page.evaluate(() => { localStorage.removeItem('godex-studio.mainLogRatio'); });
  await page.reload();
  await page.waitForTimeout(1500);

  // Test 2: sash-cols (horizontal drag)
  const r2 = await dragSash('sash-cols', 50, 0);

  // Test 3: sash-forms (horizontal-ish vertical drag)
  const r3 = await dragSash('sash-forms', 0, -50);

  console.log('Test 1 (sash-main-log):', JSON.stringify(r1, null, 2));
  console.log('Test 2 (sash-cols):',    JSON.stringify(r2, null, 2));
  console.log('Test 3 (sash-forms):',   JSON.stringify(r3, null, 2));

  await browser.close();
})();
