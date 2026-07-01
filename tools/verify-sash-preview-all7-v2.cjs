const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  await page.addInitScript(() => { localStorage.clear(); });
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/tools/sash-preview.html');
  await page.waitForTimeout(500);

  // Map sash -> {before, after} for proper height check
  const sashMap = {
    'sash-cols':          {beforeId:'studio-col-left',           beforeSize:'width',  defaultRatio: 0.22},
    'sash-forms':         {beforeId:'studio-fs-provider',        beforeSize:'height', defaultRatio: 0.35, mode:'px'},
    'sash-main-log':      {beforeId:'studio-main',               beforeSize:'height', defaultRatio: 0.6},
    'probe-sash-models':  {beforeId:'probe-section-provider',    beforeSize:'height', defaultRatio: 0.18},
    'probe-sash-caps':    {beforeId:'probe-section-models',      beforeSize:'height', defaultRatio: 0.18},
    'probe-sash-results': {beforeId:'probe-section-caps',        beforeSize:'height', defaultRatio: 0.24},
    'probe-sash-log':     {beforeId:'probe-section-results',     beforeSize:'height', defaultRatio: 0.30},
  };

  async function testSash(id, dx, dy) {
    const cfg = sashMap[id];
    const beforeRect = await page.evaluate((cid, sz) => {
      const el = document.getElementById(cid);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {size: sz === 'width' ? r.width : r.height, flex: el.style.flex};
    }, cfg.beforeId, cfg.beforeSize);
    if (!beforeRect) return {id, status: 'before element not found'};

    // Make sure target is visible (if hidden, skip)
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

    const afterRect = await page.evaluate((cid, sz) => {
      const el = document.getElementById(cid);
      const r = el.getBoundingClientRect();
      return {size: sz === 'width' ? r.width : r.height, flex: el.style.flex};
    }, cfg.beforeId, cfg.beforeSize);

    const changed = Math.abs(beforeRect.size - afterRect.size) > 1;
    return {id, before: `${beforeRect.size.toFixed(1)}px (flex=${beforeRect.flex||'-'})`, after: `${afterRect.size.toFixed(1)}px (flex=${afterRect.flex||'-'})`, delta: (afterRect.size - beforeRect.size).toFixed(1)+'px', status: changed ? '✅' : '⚠️ no change'};
  }

  console.log('=== Studio layout (3 sashes) ===');
  for (const id of ['sash-cols', 'sash-forms', 'sash-main-log']) {
    const r = await testSash(id, id==='sash-cols'?80:0, id==='sash-cols'?0:(id==='sash-forms'?-40:-100));
    console.log(' ', JSON.stringify(r));
  }

  console.log('\n--- Switch to Probe ---');
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

  await page.screenshot({path: 'D:\\Documents\VibeCoding\\GodeX\\tools\\sash-preview-final.png', fullPage: false});
  await browser.close();
})();
