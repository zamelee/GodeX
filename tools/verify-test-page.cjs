const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const logs = [];
  page.on('pageerror', e => logs.push('PAGEERR: ' + e.message));
  page.on('console', m => { if(['error','warning'].includes(m.type())) logs.push('['+m.type()+'] ' + m.text()); });

  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/sash_full_test.html');
  await page.waitForTimeout(800);

  // Reset localStorage (test page uses key 'godex-studio.mainLogRatio' etc)
  await page.evaluate(() => {
    localStorage.removeItem('godex-studio.mainLogRatio');
    localStorage.removeItem('godex-studio.formsRatio');
    localStorage.removeItem('godex-studio.colsRatio');
  });
  await page.reload();
  await page.waitForTimeout(800);

  console.log('=== state at load ===');
  const before = await page.evaluate(() => {
    const ob = {
      mainH: document.querySelector('main').getBoundingClientRect().height,
      mainHasId: document.querySelector('main').id,
      mainFlexStyle: document.querySelector('main').style.flex,
      colLeftWidth: document.getElementById('col-left').getBoundingClientRect().width,
      fsProviderHeight: document.getElementById('fs-provider').getBoundingClientRect().height,
      logH: document.getElementById('log-region').getBoundingClientRect().height,
    };
    return ob;
  });
  console.log(JSON.stringify(before, null, 2));

  const grab = (id) => page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { id, x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height };
  }, id);

  async function dragSash(id, dx, dy) {
    const target = await grab(id);
    if (!target) return { id, ok: false, reason: 'not found' };
    console.log(`\n--- Drag ${id} from (${target.x.toFixed(0)}, ${target.y.toFixed(0)}) delta (${dx}, ${dy}) ---`);
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.waitForTimeout(50);
    const onDown = await page.evaluate(() => ({
      classes: document.getElementById('sash-main-log').className,
      cursor: document.body.style.cursor,
    }));
    console.log('  on mousedown:', onDown);
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(target.x + (dx * i / 10), target.y + (dy * i / 10), {steps: 1});
    }
    await page.waitForTimeout(100);
    const onMove = await page.evaluate(() => ({
      mainH: document.querySelector('main').getBoundingClientRect().height,
      mainFlex: document.querySelector('main').style.flex,
      colLeft: document.getElementById('col-left').getBoundingClientRect().width,
      colLeftFlex: document.getElementById('col-left').style.flex,
      fsProviderH: document.getElementById('fs-provider').getBoundingClientRect().height,
      fsProviderFlex: document.getElementById('fs-provider').style.flex,
      logH: document.getElementById('log-region').getBoundingClientRect().height,
      logFlex: document.getElementById('log-region').style.flex,
      info: document.getElementById('info').textContent,
    }));
    console.log('  on mousemove:', onMove);
    await page.mouse.up();
    await page.waitForTimeout(200);
    const onUp = await page.evaluate(() => ({
      mainH: document.querySelector('main').getBoundingClientRect().height,
      mainFlex: document.querySelector('main').style.flex,
      colLeft: document.getElementById('col-left').getBoundingClientRect().width,
      colLeftFlex: document.getElementById('col-left').style.flex,
      fsProviderH: document.getElementById('fs-provider').getBoundingClientRect().height,
      fsProviderFlex: document.getElementById('fs-provider').style.flex,
      logH: document.getElementById('log-region').getBoundingClientRect().height,
      logFlex: document.getElementById('log-region').style.flex,
      stored: localStorage.getItem('godex-studio.mainLogRatio') || localStorage.getItem('godex-studio.colsRatio') || localStorage.getItem('godex-studio.formsRatio'),
    }));
    console.log('  on mouseup:',   onUp);
    return { id, ok: true, onDown, onMove, onUp };
  }

  const r1 = await dragSash('sash-main-log',  0,   -150);  // vertical drag
  const r2 = await dragSash('sash-cols',     60,   0);     // horizontal drag
  const r3 = await dragSash('sash-forms',    0,    -60);   // vertical inside form

  console.log('\n=== ERRORS / WARNINGS ===');
  logs.forEach(l => console.log(' ', l));
  console.log('\n=== SUMMARY ===');
  console.log('Test 1 (sash-main-log):',  r1.onUp.mainH !== before.mainH ? '✅ heights changed' : '❌');
  console.log('Test 2 (sash-cols):    ',  r2.onUp.colLeft !== before.colLeftWidth ? '✅ col-left width changed' : '❌');
  console.log('Test 3 (sash-forms):   ',  r3.onUp.fsProviderH !== before.fsProviderHeight ? '✅ fs-provider height changed' : '❌');
  await browser.close();
})();
