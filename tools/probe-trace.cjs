const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const errors = [];
  page.on('pageerror', e => errors.push({msg: e.message, stack: e.stack}));
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/sash_full_test.html');
  await page.waitForTimeout(800);

  // Try drag on sash-main-log
  const target = await page.evaluate(() => {
    const s = document.getElementById('sash-main-log');
    const r = s.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  console.log('Target:', target);

  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(target.x, target.y - 100, {steps: 4});
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(200);

  for (const e of errors.slice(0,3)) {
    console.log('---');
    console.log('MSG:', e.msg);
    console.log('STACK:', e.stack.split('\n').slice(0,8).join('\n'));
  }
  await browser.close();
})();
