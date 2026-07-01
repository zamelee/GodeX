const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({viewport: {width: 1280, height: 800}});
  const page = await context.newPage();
  const logs = [];
  page.on('pageerror', e => logs.push('ERR: ' + e.message));

  const sashMap = {
    'sash-cols':          {beforeId:'studio-col-left',        sz:'w', layout:'studio'},
    'sash-forms':         {beforeId:'studio-fs-provider',     sz:'h', layout:'studio'},
    'sash-main-log':      {beforeId:'studio-main',            sz:'h', layout:'studio'},
    'probe-sash-models':  {beforeId:'probe-section-provider', sz:'h', layout:'probe'},
    'probe-sash-caps':    {beforeId:'probe-section-models',   sz:'h', layout:'probe'},
    'probe-sash-results': {beforeId:'probe-section-caps',     sz:'h', layout:'probe'},
    'probe-sash-log':     {beforeId:'probe-section-results',  sz:'h', layout:'probe'},
  };

  // First navigate to establish localStorage access
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/tools/sash-preview.html');
  await page.waitForTimeout(500);

  async function resetPage() {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(500);
  }

  async function switchLayout(name) {
    await page.evaluate(n => {
      const btns = document.querySelectorAll('header button');
      for (const b of btns) if (b.textContent.includes(n==='studio'?'Studio 主页':'Probe 弹窗')) { b.click(); break; }
    }, name);
    await page.waitForTimeout(400);
  }

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
    const t = await page.evaluate(sid => {
      const s = document.getElementById(sid);
      if (!s) return null;
      const r = s.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return {x: r.x + r.width/2, y: r.y + r.height/2};
    }, id);
    if (!t) return {id, status: 'NOT FOUND / HIDDEN'};
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + dx, t.y + dy, {steps: 10});
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await measure(cfg);
    const changed = Math.abs(before.size - after.size) > 1;
    return {id, before: `${before.size.toFixed(1)}px`, after: `${after.size.toFixed(1)}px`, delta: (after.size-before.size).toFixed(1), status: changed?'OK':'NO-CHANGE'};
  }

  console.log('=== Test each sash in CLEAN state (reset between tests) ===\n');
  for (const id of Object.keys(sashMap)) {
    await resetPage();
    const cfg = sashMap[id];
    await switchLayout(cfg.layout);
    const r = await testSash(id, id==='sash-cols'?80:0, id==='sash-cols'?0:50);
    console.log(' ', JSON.stringify(r));
  }

  console.log('\nerrors:', logs);
  await browser.close();
})();
