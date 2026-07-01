const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  await page.addInitScript(() => { localStorage.clear(); });
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/tools/sash-preview.html');
  await page.waitForTimeout(500);

  const sashMap = {
    'sash-cols':          {beforeId:'studio-col-left',        sz:'w'},
    'sash-forms':         {beforeId:'studio-fs-provider',     sz:'h'},
    'sash-main-log':      {beforeId:'studio-main',            sz:'h'},
    'probe-sash-models':  {beforeId:'probe-section-provider', sz:'h'},
    'probe-sash-caps':    {beforeId:'probe-section-models',   sz:'h'},
    'probe-sash-results': {beforeId:'probe-section-caps',     sz:'h'},
    'probe-sash-log':     {beforeId:'probe-section-results',  sz:'h'},
  };

  async function measure(cfg) {
    return await page.evaluate(o => {
      const el = document.getElementById(o.id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {size: o.sz === 'w' ? r.width : r.height, flex: el.style.flex};
    }, {id: cfg.beforeId, sz: cfg.sz});
  }

  async function testSash(id, dx, dy) {
    const cfg = sashMap[id];
    const before = await measure(cfg);
    if (!before) return {id, status: 'before element not found'};
    const t = await page.evaluate(sid => {
      const s = document.getElementById(sid);
      if (!s) return null;
      const r = s.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return {x: r.x + r.width/2, y: r.y + r.height/2};
    }, id);
    if (!t) return {id, status: 'HIDDEN'};
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + dx, t.y + dy, {steps: 10});
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await measure(cfg);
    const changed = Math.abs(before.size - after.size) > 1;
    return {id, before: `${before.size.toFixed(1)}px`, after: `${after.size.toFixed(1)}px`, delta: (after.size - before.size).toFixed(1)+'px', flex: after.flex, status: changed ? 'OK' : 'NO-CHANGE'};
  }

  console.log('=== Studio layout (3 sashes) ===');
  for (const id of ['sash-cols', 'sash-forms', 'sash-main-log']) {
    const r = await testSash(id, id==='sash-cols'?80:0, id==='sash-cols'?0:(id==='sash-forms'?-40:-100));
    console.log(' ', JSON.stringify(r));
  }

  await page.evaluate(() => {
    const btns = document.querySelectorAll('header button');
    for (const b of btns) if (b.textContent.includes('Probe 弹窗')) { b.click(); break; }
  });
  await page.waitForTimeout(500);

  console.log('\n=== Probe layout (4 sashes) ===');
  for (const id of ['probe-sash-models', 'probe-sash-caps', 'probe-sash-results', 'probe-sash-log']) {
    const r = await testSash(id, 0, 40);
    console.log(' ', JSON.stringify(r));
  }

  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\sash-preview-final.png', fullPage: false});
  await browser.close();
})();
