// verify-fix-noafterjump.cjs
// Check after patch 5 (no-after-jump):
//   - mousedown ALONE: models.height UNCHANGED (no jump)
//   - first mousemove (+1px): provider.height increases by ~1px
//   - log region (1 1 0 in CSS) absorbs the change to keep totals consistent
//   - all auto section heights still initial-content-driven

const { chromium } = require('playwright');
(async () => {
  const URL = 'file:///D:/Documents/VibeCoding/GodeX/tools/sash-preview.html';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:1280,height:800} });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('header button')];
    const b = btns.find(b => b.textContent.includes('Probe 弹窗'));
    if (b) b.click();
  });
  await page.waitForTimeout(300);

  /* (A) initial 5 sections */
  const init = await page.evaluate(() => {
    const ids = ['probe-section-provider','probe-section-models','probe-section-caps','probe-section-results','probe-section-log'];
    const out = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      out[id] = { h: Math.round(r.height), flex: el.style.flex };
    }
    return out;
  });
  console.log('\n=== Initial state (auto) ===');
  for (const k of Object.keys(init)) console.log(`  ${k}: ${init[k].h}px flex="${init[k].flex}"`);

  /* (B) Mousedown ALONE on probe-sash-models -> models should NOT jump */
  console.log('\n=== Mousedown without moving: no jump on after ===');
  const sashInfo = await page.evaluate(() => {
    const sash = document.getElementById('probe-sash-models');
    const r = sash.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  await page.mouse.move(sashInfo.x, sashInfo.y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const afterDown = await page.evaluate(() => {
    const m = document.getElementById('probe-section-models').getBoundingClientRect();
    const p = document.getElementById('probe-section-provider').getBoundingClientRect();
    return {
      models: { h: Math.round(m.height), flex: document.getElementById('probe-section-models').style.flex },
      provider: { h: Math.round(p.height), flex: document.getElementById('probe-section-provider').style.flex },
    };
  });
  console.log(`  provider: ${init['probe-section-provider'].h} -> ${afterDown.provider.h}  flex: "${init['probe-section-provider'].flex}" -> "${afterDown.provider.flex}"`);
  console.log(`  models:   ${init['probe-section-models'].h} -> ${afterDown.models.h}  flex: "${init['probe-section-models'].flex}" -> "${afterDown.models.flex}"`);
  // Expect models height UNCHANGED, provider got explicit flex
  const modelsUnchanged = Math.abs(afterDown.models.h - init['probe-section-models'].h) <= 1;
  const providerPromoted = afterDown.provider.flex.startsWith('0 0 ');
  console.log(`  models unchanged: ${modelsUnchanged ? 'OK' : 'FAIL'}  (no-jump test)`);
  console.log(`  provider promoted to pct: ${providerPromoted ? 'OK' : 'FAIL'}`);

  /* (C) First mousemove (+1px): provider should change by ~+1px */
  console.log('\n=== First mousemove (+1px): provider follows by ~1px ===');
  await page.mouse.move(sashInfo.x, sashInfo.y + 1, { steps: 1 });
  await page.waitForTimeout(150);
  const afterMove = await page.evaluate(() => {
    const p = document.getElementById('probe-section-provider').getBoundingClientRect();
    const l = document.getElementById('probe-section-log').getBoundingClientRect();
    return {
      provider: { h: Math.round(p.height), flex: document.getElementById('probe-section-provider').style.flex },
      log: { h: Math.round(l.height) },
    };
  });
  console.log(`  provider: ${afterDown.provider.h} -> ${afterMove.provider.h}  (expect +1, flex: "${afterMove.provider.flex}")`);
  const provDelta = afterMove.provider.h - afterDown.provider.h;
  console.log(`  log:      ${init['probe-section-log'].h} -> ${afterMove.log.h}  (expect ~-1, log absorbs)`);
  const logDelta = afterMove.log.h - init['probe-section-log'].h;
  const okDrag = provDelta >= 0 && provDelta <= 2 && logDelta <= 0 && logDelta >= -3;
  console.log(`  drag test: prov_delta=${provDelta}, log_delta=${logDelta}  ${okDrag ? 'OK' : 'FAIL'}`);
  await page.mouse.up();

  /* (D) Reset, then drag a STUDIO sash — should also work without after-jump */
  console.log('\n=== Studio sash drag (sash-cols) ===');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);
  // Switch to studio
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('header button')];
    const b = btns.find(b => b.textContent.includes('Studio 主页'));
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  const studioInit = await page.evaluate(() => {
    const l = document.getElementById('studio-col-left').getBoundingClientRect();
    const r = document.getElementById('studio-col-right').getBoundingClientRect();
    return { left: Math.round(l.width), right: Math.round(r.width) };
  });
  console.log(`  initial: col-left=${studioInit.left}px  col-right=${studioInit.right}px`);
  const colSash = await page.evaluate(() => {
    const s = document.getElementById('sash-cols');
    const r = s.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  await page.mouse.move(colSash.x, colSash.y);
  await page.mouse.down();
  await page.waitForTimeout(100);
  // measure col-right (after) before any mouse move
  const studioAfterDown = await page.evaluate(() => {
    const r = document.getElementById('studio-col-right').getBoundingClientRect();
    return { w: Math.round(r.width) };
  });
  console.log(`  after mousedown (no move): col-right=${studioAfterDown.w}px`);
  await page.mouse.move(colSash.x + 50, colSash.y, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const studioAfter = await page.evaluate(() => {
    const l = document.getElementById('studio-col-left').getBoundingClientRect();
    const r = document.getElementById('studio-col-right').getBoundingClientRect();
    return { left: Math.round(l.width), right: Math.round(r.width) };
  });
  console.log(`  after drag +50px: col-left=${studioInit.left} -> ${studioAfter.left}  col-right=${studioInit.right} -> ${studioAfter.right}`);
  const studioOK = studioAfter.left > studioInit.left && Math.abs((studioAfter.left - studioInit.left) - 50) <= 2;
  console.log(`  studio drag: ${studioOK ? 'OK' : 'FAIL'}`);

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('header button')];
    const b = btns.find(b => b.textContent.includes('Probe 弹窗'));
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'D:/Documents/VibeCoding/GodeX/tools/_patches/after-5-nojump.png', fullPage: false });

  console.log('\n=== Summary ===');
  console.log(`  (B) mousedown no-jump models: ${modelsUnchanged ? 'OK' : 'FAIL'}`);
  console.log(`  (B) mousedown promote before: ${providerPromoted ? 'OK' : 'FAIL'}`);
  console.log(`  (C) first-move ~+1:           ${okDrag ? 'OK' : 'FAIL'}`);
  console.log(`  (D) studio sash drag:         ${studioOK ? 'OK' : 'FAIL'}`);
  console.log(`  page errors: ${errs.length === 0 ? 'none' : errs.join(' | ')}`);
  await browser.close();
  process.exit((modelsUnchanged && providerPromoted && okDrag && studioOK && errs.length === 0) ? 0 : 1);
})();
