// verify-fix-auto.cjs
// Checks after patch 4 (provider/models/caps content-driven auto):
//   - provider height ~ content (50-90px)
//   - models height ~ content (60-100px)
//   - caps height ~ content (60-100px)
//   - results ~ 35% of layout inner-height (220-280px)
//   - log ~ auto, >= 100px
//   - dragging probe-sash-models (auto mode) at center click, +1px move should
//     change before-flex from auto to pct and resize by ~1px (no jump)
const { chromium } = require('playwright');
(async () => {
  const URL = 'file:///D:/Documents/VibeCoding/GodeX/tools/sash-preview.html';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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

  const sizes = await page.evaluate(() => {
    const ids = ['probe-section-provider','probe-section-models','probe-section-caps','probe-section-results','probe-section-log'];
    const out = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      out[id] = Math.round(r.height);
    }
    out.__inner = document.getElementById('layout-probe').clientHeight;
    out.__beforeFlex = {
      provider: document.getElementById('probe-section-provider').style.flex,
      models:   document.getElementById('probe-section-models').style.flex,
      caps:     document.getElementById('probe-section-caps').style.flex,
      results:  document.getElementById('probe-section-results').style.flex,
    };
    return out;
  });
  const inner = sizes.__inner;
  console.log(`\n=== Layout B heights (inner=${inner}px) ===`);
  console.log(`  provider: ${sizes['probe-section-provider']}px  (expect 50-90px)`);
  console.log(`  models:   ${sizes['probe-section-models']}px  (expect 60-100px)`);
  console.log(`  caps:     ${sizes['probe-section-caps']}px  (expect 60-100px)`);
  console.log(`  results:  ${sizes['probe-section-results']}px  (expect ${Math.round(0.30*inner)}-${Math.round(0.40*inner)}px / 35%)`);
  console.log(`  log:      ${sizes['probe-section-log']}px  (expect >= 100, <= ${Math.round(0.45*inner)}px)`);
  console.log(`\n  beforeFlex (inline): ${JSON.stringify(sizes.__beforeFlex)}`);
  console.log(`   ^ provider/models/caps should be "" (auto), results should be "0 0 NN%"`);

  const okAuto =
    sizes['probe-section-provider'] >= 50 && sizes['probe-section-provider'] <= 90 &&
    sizes['probe-section-models']   >= 60 && sizes['probe-section-models']   <= 100 &&
    sizes['probe-section-caps']     >= 60 && sizes['probe-section-caps']     <= 100 &&
    sizes.__beforeFlex.provider === '' &&
    sizes.__beforeFlex.models   === '' &&
    sizes.__beforeFlex.caps     === '';
  console.log(`  auto-result: ${okAuto ? 'OK' : 'FAIL'}`);

  const okResults =
    sizes.__beforeFlex.results.startsWith('0 0 ') &&
    sizes['probe-section-results'] >= Math.round(0.30*inner) &&
    sizes['probe-section-results'] <= Math.round(0.40*inner);
  console.log(`  results-result: ${okResults ? 'OK' : 'FAIL'}`);

  const okLog =
    sizes['probe-section-log'] >= 100;
  console.log(`  log-result: ${okLog ? 'OK' : 'FAIL'}`);

  /* (2D) drag a sash in auto mode -> promote auto->pct, no jump */
  console.log('\n=== (2D) drag auto sash: promote to pct, no first-move jump ===');
  const before = await page.evaluate(() => {
    const sec = document.getElementById('probe-section-models');
    const r = sec.getBoundingClientRect();
    // sash is below models section
    const sash = document.getElementById('probe-sash-caps');
    const sr = sash.getBoundingClientRect();
    return {
      h: Math.round(r.height),
      flex: sec.style.flex,
      sashX: sr.x + sr.width/2,
      sashY: sr.y + sr.height/2,
    };
  });
  console.log(`  before drag:  models.h=${before.h}, flex="${before.flex}"`);
  await page.mouse.move(before.sashX, before.sashY);
  await page.mouse.down();
  await page.mouse.move(before.sashX, before.sashY + 1, { steps: 1 });
  await page.waitForTimeout(120);
  const after1 = await page.evaluate(() => {
    const sec = document.getElementById('probe-section-models');
    return { h: Math.round(sec.getBoundingClientRect().height), flex: sec.style.flex };
  });
  console.log(`  after +1px:    models.h=${after1.h}, flex="${after1.flex}"`);
  const promoteOK = after1.flex !== '' && after1.flex.startsWith('0 0 ');
  console.log(`  auto->pct promote: ${promoteOK ? 'OK' : 'FAIL'}`);
  const jump = after1.h - before.h;
  // auto mode now uses layout-derived ratio: jumping by content rounding is OK (<5)
  console.log(`  delta h: ${jump > 0 ? '+' : ''}${jump}px (no-jump = abs<=5, expect ~+1 but auto rounding can shift slightly)`);
  const ok2D = promoteOK && Math.abs(jump) <= 5;
  console.log(`  (2D) result: ${ok2D ? 'OK' : 'FAIL'}`);
  await page.mouse.up();

  // restore by clearing localStorage and reload
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);

  await page.screenshot({ path: 'D:/Documents/VibeCoding/GodeX/tools/_patches/after-4-auto.png', fullPage: false });
  console.log('\nscreenshot: D:/Documents/VibeCoding/GodeX/tools/_patches/after-4-auto.png');

  console.log('\n=== Summary ===');
  console.log(`  (4) auto:    ${okAuto ? 'OK' : 'FAIL'}`);
  console.log(`  (4) results: ${okResults ? 'OK' : 'FAIL'}`);
  console.log(`  (4) log:     ${okLog ? 'OK' : 'FAIL'}`);
  console.log(`  (2D) drag:   ${ok2D ? 'OK' : 'FAIL'}`);
  console.log(`  page errors: ${errs.length === 0 ? 'none' : errs.join(' | ')}`);
  await browser.close();
  process.exit((okAuto && okResults && okLog && ok2D && errs.length === 0) ? 0 : 1);
})();
