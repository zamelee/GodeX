const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const logs = [];
  page.on('pageerror', e => logs.push({msg: e.message, stack: (e.stack||'').split('\n').slice(0,3).join('\n')}));
  page.on('console', m => { logs.push('['+m.type()+'] '+m.text()); });

  // Stub out Tauri APIs BEFORE the page scripts run, so init() doesnt throw on invoke()
  await page.addInitScript(() => {
    // Make `invoke` and `listen` no-ops
    window.invoke = function() { return Promise.reject(new Error('stubbed')); };
    window.listen = function() { return Promise.resolve(function(){}); };
  });

  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/index.html');
  await page.waitForTimeout(1500);

  // Did initSashes run?
  const hasSashes = await page.evaluate(() => {
    // _godexSashes is module-scoped (const at script top level), try to dig it out
    // Use Function constructor to access closure scope:
    let count = null;
    try {
      // Trick: stash the count on a div from inside the IIFE that ran init()
      // Instead, count .sash elements with .sash-main-log
      const allSashes = document.querySelectorAll('.sash');
      return { sashCount_dom: allSashes.length, has_main_with_id: document.querySelector('main').id === 'main' };
    } catch(e) { return { err: e.message }; }
  });
  console.log('DOM state:', JSON.stringify(hasSashes, null, 2));

  const before = await page.evaluate(() => {
    const m = document.querySelector('main');
    const l = document.getElementById('log-region');
    const sml = document.getElementById('sash-main-log');
    return {
      mainH: m.getBoundingClientRect().height,
      logH: l.getBoundingClientRect().height,
      smlRect: sml ? sml.getBoundingClientRect().toJSON() : null,
    };
  });
  console.log('BEFORE drag:', JSON.stringify(before, null, 2));

  const tgt = { x: before.smlRect.x + before.smlRect.width/2, y: before.smlRect.y + before.smlRect.height/2 };
  await page.mouse.move(tgt.x, tgt.y);
  await page.mouse.down();
  await page.mouse.move(tgt.x, tgt.y - 200, {steps: 10});
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const m = document.querySelector('main');
    const l = document.getElementById('log-region');
    const sml = document.getElementById('sash-main-log');
    return {
      mainH: m.getBoundingClientRect().height,
      mainFlexStyle: m.style.flex,
      logH: l.getBoundingClientRect().height,
      logFlexStyle: l.style.flex,
      smlClasses: sml.className,
      stored: localStorage.getItem('godex-studio.mainLogRatio'),
    };
  });
  console.log('AFTER drag:', JSON.stringify(after, null, 2));

  console.log('\n========================================');
  console.log('  mainH :', before.mainH.toFixed(1), '->', after.mainH.toFixed(1));
  console.log('  logH  :', before.logH.toFixed(1), '->', after.logH.toFixed(1));
  console.log('  mainFlexStyle:', JSON.stringify(after.mainFlexStyle));
  console.log('  logFlexStyle :', JSON.stringify(after.logFlexStyle));
  const keyErrors = logs.filter(l => l.msg && (l.msg.includes('Cannot read prop') || l.msg.includes('undefined') || l.msg.includes('null')));
  console.log('  Key errors (', keyErrors.length, '):');
  keyErrors.slice(0,5).forEach(e => console.log('   -', e.msg));
  console.log('========================================');
  const success = !!after.mainFlexStyle && after.mainFlexStyle.indexOf('0 0') === 0;
  console.log(success ? '\n✅ DRAG WORKS on real index.html' : '\n❌ FAIL: flex style not applied');
  await browser.close();
  process.exit(success ? 0 : 1);
})();
