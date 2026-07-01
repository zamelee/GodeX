const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const logs = [];
  page.on('pageerror', e => logs.push('ERR: ' + e.message));
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/tools/sash-preview.html');
  await page.waitForTimeout(800);

  // ==== Initial state ====
  const init = await page.evaluate(() => {
    const sashes = document.querySelectorAll('.sash');
    return {
      count: sashes.length,
      list: Array.from(sashes).map(s => ({id: s.id, parent: s.parentElement.tagName, rect: s.getBoundingClientRect().toJSON()})),
      diag: document.getElementById('diag').textContent,
    };
  });
  console.log('Initial sashes:', JSON.stringify(init, null, 2));

  // Take screenshot of initial state
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\sash-preview-init-studio.png', fullPage: false});

  async function dragSash(id, dx, dy, desc) {
    const t = await page.evaluate(sid => {
      const s = document.getElementById(sid);
      const r = s.getBoundingClientRect();
      return {x: r.x + r.width/2, y: r.y + r.height/2};
    }, id);
    if (!t) return {id, ok: false, reason: 'not found'};
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.waitForTimeout(50);
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(t.x + (dx * i / 10), t.y + (dy * i / 10), {steps: 1});
    }
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(150);
    return {id, desc, ok: true};
  }

  // ==== Layout A sashes ====
  console.log('\n--- Layout A (Studio) ---');
  await dragSash('sash-cols',     60,    0,  'cols +60px right');
  await dragSash('sash-forms',     0,   -50, 'forms -50px up');
  await dragSash('sash-main-log',  0,   -150,'main-log -150px up');
  await page.waitForTimeout(300);
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\sash-preview-after-studio.png', fullPage: false});

  // Verify heights changed
  const afterStudio = await page.evaluate(() => ({
    fsProvider: document.getElementById('studio-fs-provider').getBoundingClientRect().height,
    fsModels:   document.getElementById('studio-fs-models').getBoundingClientRect().height,
    colLeft:    document.getElementById('studio-col-left').getBoundingClientRect().width,
    logRegion:  document.getElementById('studio-log-region').getBoundingClientRect().height,
  }));
  console.log('After drags:', JSON.stringify(afterStudio, null, 2));

  // ==== Layout B (Probe) ====
  console.log('\n--- Layout B (Probe) ---');
  await page.evaluate(() => {
    const btns = document.querySelectorAll('header button');
    for (const b of btns) if (b.textContent.includes('Probe 弹窗')) { b.click(); break; }
  });
  await page.waitForTimeout(500);
  await dragSash('probe-sash-models',  0,  -30, 'probe-models');
  await dragSash('probe-sash-caps',    0,  -30, 'probe-caps');
  await dragSash('probe-sash-results', 0,  -50, 'probe-results');
  await dragSash('probe-sash-log',     0,  +50, 'probe-log');
  await page.waitForTimeout(300);
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\sash-preview-after-probe.png', fullPage: false});

  // ==== Switch back to studio and verify persistence ====
  console.log('\n--- Persistence test ---');
  await page.evaluate(() => {
    const btns = document.querySelectorAll('header button');
    for (const b of btns) if (b.textContent.includes('Studio 主页')) { b.click(); break; }
  });
  await page.waitForTimeout(500);
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\sash-preview-back-to-studio.png', fullPage: false});

  // Check that ratios are persisted in localStorage
  const persisted = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  });
  console.log('localStorage:', JSON.stringify(persisted, null, 2));

  console.log('\nerrors:', logs.filter(l => !l.includes('stub')));
  await browser.close();
})();
