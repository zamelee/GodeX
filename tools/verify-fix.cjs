const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 800, height: 600}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file:///D:/tmp_test_fix.html');
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => window.testResult());
  console.log('BEFORE:', JSON.stringify(before, null, 2));

  // Drag sash-main-log
  const tgt = await page.evaluate(() => {
    const s = document.getElementById('sash-main-log');
    const r = s.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height };
  });
  console.log('drag from:', tgt);
  await page.mouse.move(tgt.x, tgt.y);
  await page.mouse.down();
  await page.mouse.move(tgt.x, tgt.y - 80, {steps: 5});
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => {
    const m = document.getElementById('main');
    const l = document.getElementById('log-region');
    return { mainFlex: m.style.flex, mainH: m.getBoundingClientRect().height, logFlex: l.style.flex, logH: l.getBoundingClientRect().height, stored: localStorage.getItem('x') };
  });
  console.log('AFTER:', JSON.stringify(after, null, 2));
  console.log('Errors:', errors);
  await browser.close();
})();
