const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const logs = [];
  page.on('pageerror', e => logs.push('PAGEERR: ' + e.message));
  page.on('console', m => { if(['error','warning'].includes(m.type())) logs.push('['+m.type()+'] ' + m.text()); });

  // Stub Tauri APIs before page scripts
  await page.addInitScript(() => {
    window.__TAURI__ = {
      core: { invoke: function(){ return Promise.reject(new Error('stubbed')); } },
      event: { listen: function(){ return Promise.resolve(function(){}); } },
    };
  });

  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/index.html');
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => {
    const sml = document.getElementById('sash-main-log');
    const m = document.querySelector('main');
    const l = document.getElementById('log-region');
    return {
      smlExists: !!sml,
      mainExists: !!m,
      mainHasId: m ? m.id : null,
      logExists: !!l,
      // count actual sash elements with class=sash
      sassElementsCount: document.querySelectorAll('.sash').length,
      // check if mousedown listener is on sash-main-log (testable by firing mousedown)
    };
  });
  console.log('State:', JSON.stringify(state, null, 2));

  // Try to drag and see if _onMove attached
  const tgt = await page.evaluate(() => {
    const sml = document.getElementById('sash-main-log');
    const r = sml.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2, rect: r.toJSON() };
  });
  console.log('Drag from:', tgt);

  const beforeH = await page.evaluate(() => ({
    mainH: document.querySelector('main').getBoundingClientRect().height,
    logH:  document.getElementById('log-region').getBoundingClientRect().height,
  }));

  await page.mouse.move(tgt.x, tgt.y);
  await page.mouse.down();
  await page.waitForTimeout(50);
  const afterDown = await page.evaluate(() => ({
    classes: document.getElementById('sash-main-log').className,
    mainFlex: document.querySelector('main').style.flex,
    cursor: document.body.style.cursor,
  }));
  console.log('After mousedown:', afterDown);

  await page.mouse.move(tgt.x, tgt.y - 200, {steps: 10});
  await page.waitForTimeout(100);

  const afterMove = await page.evaluate(() => ({
    classes: document.getElementById('sash-main-log').className,
    mainFlex: document.querySelector('main').style.flex,
    mainH: document.querySelector('main').getBoundingClientRect().height,
    logH: document.getElementById('log-region').getBoundingClientRect().height,
  }));
  console.log('After mousemove:', afterMove);

  await page.mouse.up();
  await page.waitForTimeout(200);

  const afterUp = await page.evaluate(() => ({
    classes: document.getElementById('sash-main-log').className,
    mainFlex: document.querySelector('main').style.flex,
    mainH: document.querySelector('main').getBoundingClientRect().height,
    logH: document.getElementById('log-region').getBoundingClientRect().height,
    stored: localStorage.getItem('godex-studio.mainLogRatio'),
  }));
  console.log('After mouseup:', afterUp);

  console.log('\n========================================');
  console.log('  mainH :', beforeH.mainH.toFixed(1), '->', afterUp.mainH.toFixed(1));
  console.log('  logH  :', beforeH.logH.toFixed(1), '->', afterUp.logH.toFixed(1));
  console.log('  Classes after mousedown:', afterDown.classes);
  console.log('  mainFlex on up :', JSON.stringify(afterUp.mainFlex));
  console.log('  Errors:', logs.length);
  logs.slice(0,5).forEach(l => console.log('   -', l));
  console.log('========================================');
  const success = afterDown.classes.indexOf('dragging') >= 0 && afterUp.mainFlex.indexOf('0 0') === 0;
  console.log(success ? '\n✅ DRAG WORKS on real index.html' : '\n❌ FAIL: drag still broken');
  await browser.close();
  process.exit(success ? 0 : 1);
})();
