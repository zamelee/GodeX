const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  await page.addInitScript(() => { localStorage.clear(); });
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/tools/sash-preview.html');
  await page.waitForTimeout(500);

  const results = [];
  async function testSash(id, dx, dy) {
    const t = await page.evaluate(sid => {
      const s = document.getElementById(sid);
      if (!s) return null;
      const r = s.getBoundingClientRect();
      return {x: r.x + r.width/2, y: r.y + r.height/2};
    }, id);
    if (!t || t.x === 0 && t.y === 0) {
      return {id, status: 'HIDDEN (skipped)'};
    }
    const beforeH = await page.evaluate(sid => {
      // find any related element height
      return 'flex=' + (document.getElementById(sid).parentElement?.style.flex || '-');
    }, id);
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + dx, t.y + dy, {steps: 10});
    await page.mouse.up();
    await page.waitForTimeout(200);
    const afterH = await page.evaluate(sid => {
      return 'flex=' + (document.getElementById(sid).parentElement?.style.flex || '-');
    }, id);
    return {id, before: beforeH, after: afterH, status: beforeH === afterH ? 'NO CHANGE ⚠️' : 'CHANGED ✅'};
  }

  console.log('=== Studio layout (3 sashes) ===');
  results.push(await testSash('sash-cols',     80,  0));
  results.push(await testSash('sash-forms',     0, -40));
  results.push(await testSash('sash-main-log',  0, -100));

  console.log('--- Switch to Probe ---');
  await page.evaluate(() => {
    const btns = document.querySelectorAll('header button');
    for (const b of btns) if (b.textContent.includes('Probe 弹窗')) { b.click(); break; }
  });
  await page.waitForTimeout(500);

  console.log('\n=== Probe layout (4 sashes) ===');
  results.push(await testSash('probe-sash-models',  0, +40));
  results.push(await testSash('probe-sash-caps',    0, +40));
  results.push(await testSash('probe-sash-results', 0, +50));
  results.push(await testSash('probe-sash-log',     0, +40));

  console.log('\n--- Final report ---');
  results.forEach(r => console.log(' ', JSON.stringify(r)));

  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\sash-preview-final.png', fullPage: false});
  await browser.close();
})();
