const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/sash_full_test.html');
  await page.waitForTimeout(800);

  const report = await page.evaluate(() => {
    const out = { sashCount: window._godexSashes ? window._godexSashes.length : "N/A" };
    // Try to access _godexSashes via Function constructor (since const)
    try {
      const sashes = (function() { return window._godexSashes; })();
      // Since it's const, it's not on window. Use Function() to access.
    } catch(e) {}
    // Direct: try via reading the script's closure
    const grid = [];
    const sashes = document.querySelectorAll('.sash');
    sashes.forEach(s => {
      grid.push({ id: s.id, has_sashEl: !!s._sashInstance });
    });
    return out;
  });
  console.log(JSON.stringify(report, null, 2));

  // Use Function() to access closure-scoped _godexSashes
  const sashesReport = await page.evaluate(() => {
    // The vars are in a closure. We can't access them directly.
    // But! document.mousemove handler iterates them and tries applyRatio.
    // Let me try a different angle: read the diag text.
    return document.getElementById('diag').textContent;
  });
  console.log('DIAG:', sashesReport);

  // Count actual DOM sashes
  const allSashInfo = await page.evaluate(() => {
    const out = {};
    ['sash-main-log', 'sash-forms', 'sash-cols', 'log-sash'].forEach(id => {
      const el = document.getElementById(id);
      out[id] = el ? {found: true, rect: el.getBoundingClientRect().toJSON()} : {found: false};
    });
    return out;
  });
  console.log('All sashes by ID:', JSON.stringify(allSashInfo, null, 2));

  await browser.close();
})();
