const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const events = [];
  page.on('pageerror', e => events.push({msg: e.message, stack: e.stack}));
  page.on('console', msg => events.push('CONSOLE.' + msg.type() + ': ' + msg.text()));

  // Hook before scripts run
  await page.addInitScript(() => {
    window.__sashDiag = [];
  });

  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/sash_full_test.html');
  await page.waitForTimeout(800);

  // Read each sash DOM and its computed style
  const measurements = await page.evaluate(() => {
    const out = {};
    ['sash-main-log', 'sash-forms', 'sash-cols'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      out[id] = {
        rect: el.getBoundingClientRect().toJSON(),
        computedStyle: getComputedStyle(el).cssText.slice(0,300),
        listening: 'mousedown' in el,
      };
    });
    // Check what element is at the sash-main-log position
    const sml = document.getElementById('sash-main-log');
    const r = sml.getBoundingClientRect();
    const elemAtPoint = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
    out['_elementAtSashMainLog'] = {
      tag: elemAtPoint ? elemAtPoint.tagName : null,
      id: elemAtPoint ? elemAtPoint.id : null,
      cls: elemAtPoint ? elemAtPoint.className : null,
      isSash: elemAtPoint === sml,
    };
    return out;
  });
  console.log('Measurements:', JSON.stringify(measurements, null, 2));

  // Check: drag with mousedown first
  const tgt = await page.evaluate(() => {
    const s = document.getElementById('sash-main-log');
    const r = s.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  console.log('Drag target:', tgt);

  // Single mousedown to see what happens
  await page.mouse.move(tgt.x, tgt.y);
  await page.mouse.down();
  await page.waitForTimeout(300);

  const afterDown = await page.evaluate(() => {
    const sm = document.getElementById('sash-main-log');
    return { classes: sm.className, cursor: document.body.style.cursor, mainFlex: document.querySelector('main').style.flex, logFlex: document.getElementById('log-region').style.flex };
  });
  console.log('After mousedown:', afterDown);

  await page.mouse.up();
  await page.waitForTimeout(200);

  console.log('All errors:', JSON.stringify(events, null, 2));
  await browser.close();
})();
