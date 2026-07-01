const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/sash_full_test.html');
  await page.waitForTimeout(800);

  // Get initial measurements
  const before = await page.evaluate(() => {
    const s = document.getElementById('sash-main-log');
    const m = document.querySelector('main');
    const l = document.getElementById('log-region');
    return {
      sashRect: s.getBoundingClientRect().toJSON(),
      mainHeight: m.getBoundingClientRect().height,
      mainFlex: getComputedStyle(m).flex,
      logHeight: l.getBoundingClientRect().height,
      logFlex: getComputedStyle(l).flex,
      initialStored: localStorage.getItem('godex-studio.mainLogRatio'),
    };
  });
  console.log('BEFORE:', JSON.stringify(before, null, 2));

  // Try drag with mouse
  const x = before.sashRect.x + before.sashRect.width / 2;
  const startY = before.sashRect.y + before.sashRect.height / 2;
  const targetY = startY - 200; // drag up by 200px
  await page.mouse.move(x, startY);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x, startY - (targetY - startY) * (i / 10), {steps: 1});
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => {
    const s = document.getElementById('sash-main-log');
    const m = document.querySelector('main');
    const l = document.getElementById('log-region');
    const sashes = window._godexSashes ? window._godexSashes.map(s => ({sashId: s.sash.id, dragging: !!s.dragging})) : null;
    return {
      sashRect: s.getBoundingClientRect().toJSON(),
      mainHeight: m.getBoundingClientRect().height,
      mainFlex: m.style.flex,
      logHeight: l.getBoundingClientRect().height,
      logFlex: l.style.flex,
      finalStored: localStorage.getItem('godex-studio.mainLogRatio'),
      sashes: sashes,
    };
  });
  console.log('AFTER:', JSON.stringify(after, null, 2));
  console.log('Console errors during drag:', errors);
  await browser.close();
})();
