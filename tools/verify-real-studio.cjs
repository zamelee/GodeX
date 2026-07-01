const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/index.html');
  // Wait long enough for bootStudio + initSashes
  await page.waitForTimeout(1500);

  // Initial state
  const before = await page.evaluate(() => {
    const m = document.querySelector('main');
    const l = document.getElementById('log-region');
    const sml = document.getElementById('sash-main-log');
    return {
      mainH: m.getBoundingClientRect().height,
      mainFlexStyle: m.style.flex,
      mainHasId: m.id,
      logH: l.getBoundingClientRect().height,
      logFlexStyle: l.style.flex,
      smlRect: sml ? sml.getBoundingClientRect().toJSON() : null,
    };
  });
  console.log('BEFORE:', JSON.stringify(before, null, 2));

  if (!before.smlRect) {
    console.log('FAIL: sash-main-log not found');
    await browser.close();
    process.exit(1);
  }

  // Drag sash-main-log UP by 200px
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
    return {
      mainH: m.getBoundingClientRect().height,
      mainFlexStyle: m.style.flex,
      logH: l.getBoundingClientRect().height,
      logFlexStyle: l.style.flex,
      stored: localStorage.getItem('godex-studio.mainLogRatio'),
    };
  });
  console.log('AFTER drag:', JSON.stringify(after, null, 2));

  // Verify state changed
  const success = after.mainFlexStyle !== before.mainFlexStyle && after.mainFlexStyle !== '';
  console.log('\n========================================');
  console.log('  mainH before/after:', before.mainH.toFixed(1), '->', after.mainH.toFixed(1));
  console.log('  mainFlex before:', JSON.stringify(before.mainFlexStyle));
  console.log('  mainFlex after :', JSON.stringify(after.mainFlexStyle));
  console.log('  Errors during drag:', errors.length, '(', errors.slice(0,3).join(' | '), ')');
  console.log('========================================');
  console.log(success ? '✅ sash-main-log DRAG WORKS!' : '❌ FAIL: drag did not change styles');
  await browser.close();
  process.exit(success ? 0 : 2);
})();
