const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const errors = [];
  page.on('pageerror', e => errors.push({msg: e.message, stack: (e.stack||'').split('\n').slice(0,3).join('\n')}));
  page.on('console', m => { if(m.type()==='error') errors.push({msg:'[console.error] '+m.text()}); });

  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/index.html');
  await page.waitForTimeout(500);

  // Manually call initSashes since Tauri's invoke() is not available outside Tauri runtime.
  // We bypass the async IIFE in index.html and call window.initSashes directly.
  // But initSashes is inside a top-level <script> so it's at window scope? Let's check by trying.
  const manualInit = await page.evaluate(() => {
    try {
      // Try invoking initSashes which is declared at line 766 with `function initSashes() {`
      // Top-level function declarations are on window, but init() IIFE around them may shadow.
      if (typeof window.initSashes === 'function') {
        window.initSashes();
        return { ok: true, path: 'window.initSashes' };
      }
      // Try eval inside script scope
      return { ok: false, has_global: typeof window.initSashes };
    } catch(e) { return { ok: false, err: e.message }; }
  });
  console.log('Manual initSashes attempt:', manualInit);

  // Try all common ways
  const allAttempts = await page.evaluate(() => {
    const results = {};
    results.initSashes_typeof = typeof window.initSashes;
    results._godexSashes_typeof = typeof window._godexSashes;
    // Try direct call via Function constructor (won''t work due to closure)
    return results;
  });
  console.log('Globals:', allAttempts);

  await page.waitForTimeout(200);

  const before = await page.evaluate(() => {
    const m = document.querySelector('main');
    const l = document.getElementById('log-region');
    const sml = document.getElementById('sash-main-log');
    return {
      mainH: m.getBoundingClientRect().height,
      mainHasId: m.id,
      logH: l.getBoundingClientRect().height,
      smlRect: sml ? sml.getBoundingClientRect().toJSON() : null,
    };
  });
  console.log('BEFORE:', JSON.stringify(before, null, 2));

  const tgt = { x: before.smlRect.x + before.smlRect.width/2, y: before.smlRect.y + before.smlRect.height/2 };
  console.log('Drag from:', tgt);
  await page.mouse.move(tgt.x, tgt.y);
  await page.mouse.down();
  await page.mouse.move(tgt.x, tgt.y - 200, {steps: 10});
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const m = document.querySelector('main');
    const l = document.getElementById('log-region');
    const sml = document.getElementById('sash-main-log');
    const cs = getComputedStyle(m);
    return {
      mainH: m.getBoundingClientRect().height,
      mainFlexStyle: m.style.flex,
      logH: l.getBoundingClientRect().height,
      logFlexStyle: l.style.flex,
      smlClasses: sml.className,
      stored: localStorage.getItem('godex-studio.mainLogRatio'),
    };
  });
  console.log('AFTER:', JSON.stringify(after, null, 2));

  console.log('\n========================================');
  console.log('  mainH :', before.mainH.toFixed(1), '->', after.mainH.toFixed(1));
  console.log('  logH  :', before.logH.toFixed(1), '->', after.logH.toFixed(1));
  console.log('  mainFlexStyle:', JSON.stringify(after.mainFlexStyle));
  console.log('  logFlexStyle :', JSON.stringify(after.logFlexStyle));
  console.log('  Errors:', errors.length);
  errors.slice(0,5).forEach(e => console.log('   -', e.msg || e));
  console.log('========================================');
  const success = after.mainFlexStyle && after.mainFlexStyle.indexOf('0 0') === 0;
  console.log(success ? '\n✅ DRAG WORKS on real index.html' : '\n❌ FAIL: flex style not applied');
  await browser.close();
  process.exit(success ? 0 : 1);
})();
