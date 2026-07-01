const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console.error: ' + msg.text()); });
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/sash_full_test.html');
  await page.waitForTimeout(800);

  // Output diag display
  const diagText = await page.evaluate(() => document.getElementById('diag').textContent);
  console.log('DIAG:', diagText);

  // Get all sashes directly via DOM
  const sashes = await page.evaluate(() => {
    const all = document.querySelectorAll('.sash');
    return Array.from(all).map(s => {
      const r = s.getBoundingClientRect();
      return { id: s.id, x: r.x+r.width/2, y: r.y+r.height/2, w: r.width, h: r.height, parent: s.parentElement.tagName };
    });
  });
  console.log('SASHES:', JSON.stringify(sashes, null, 2));

  // Try a real click+drag on sash-main-log
  const target = sashes.find(s => s.id === 'sash-main-log');
  console.log('Target:', target);
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(50);
  await page.mouse.down();
  await page.waitForTimeout(100);
  
  const afterDown = await page.evaluate(() => {
    const sm = document.getElementById('sash-main-log');
    return { has_dragging_class: sm.classList.contains('dragging'), cursor: document.body.style.cursor };
  });
  console.log('After mouse.down on sash-main-log:', afterDown);

  await page.mouse.move(target.x, target.y - 100, {steps: 8});
  await page.waitForTimeout(100);

  const afterMove = await page.evaluate(() => {
    const m = document.querySelector('main');
    const l = document.getElementById('log-region');
    return { main_h: m.getBoundingClientRect().height, main_flex: m.style.flex, log_h: l.getBoundingClientRect().height, log_flex: l.style.flex, info: document.getElementById('info').textContent };
  });
  console.log('After mouse.move up 100px:', afterMove);

  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterUp = await page.evaluate(() => {
    const m = document.querySelector('main');
    const l = document.getElementById('log-region');
    return { main_h: m.getBoundingClientRect().height, main_flex: m.style.flex, log_h: l.getBoundingClientRect().height, log_flex: l.style.flex, stored: localStorage.getItem('godex-studio.mainLogRatio') };
  });
  console.log('After mouse.up:', afterUp);
  console.log('Errors:', errors);
  await browser.close();
})();
