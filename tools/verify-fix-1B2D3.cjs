// verify-fix-1B2D3.cjs
// 3 checks:
//   (1B) layout B initial ratio: provider <= 80px, models ~22%, caps ~18%, results ~30%, log ~20%
//   (2D) sash 拖动增量跟踪: mousedown 同位 + 1px move 后, before/after size 差异应 == 1px (而非"跳到鼠标绝对位置")
//        旧实现下, 把 sash 中线(50%) 误按在 hit-area 上沿(8/14 = 57% 偏移), 一次 1px move 就能跳 50+px
//   (3)  cap-row: 13 个 .cap-item, 每个都有非空的 .cap-zh

const { chromium } = require('playwright');
(async () => {
  const URL = 'file:///D:/Documents/VibeCoding/GodeX/tools/sash-preview.html';
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));

  await page.goto(URL);
  await page.waitForTimeout(200);

  // Reset everything
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);

  // Switch to probe layout
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('header button')];
    const b = btns.find(b => b.textContent.includes('Probe 弹窗'));
    if (b) b.click();
  });
  await page.waitForTimeout(300);

  /* ===== (1B) ratios ===== */
  const sizes = await page.evaluate(() => {
    const ids = ['probe-section-provider','probe-section-models','probe-section-caps','probe-section-results','probe-section-log'];
    const result = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) { result[id] = null; continue; }
      const r = el.getBoundingClientRect();
      result[id] = { h: Math.round(r.height), y: Math.round(r.y) };
    }
    const lp = document.getElementById('layout-probe').getBoundingClientRect();
    result.__layoutH = Math.round(lp.height);
    return result;
  });
  const total = sizes.__layoutH;
  const pct = id => Math.round(sizes[id].h / total * 100);
  console.log(`\n=== (1B) Layout B initial ratios (layout height=${total}px) ===`);
  console.log(`  provider: ${sizes['probe-section-provider'].h}px  (${pct('probe-section-provider')}%)  expect <=80px`);
  console.log(`  models:   ${sizes['probe-section-models'].h}px  (${pct('probe-section-models')}%)  expect ~22%`);
  console.log(`  caps:     ${sizes['probe-section-caps'].h}px  (${pct('probe-section-caps')}%)  expect ~18%`);
  console.log(`  results:  ${sizes['probe-section-results'].h}px  (${pct('probe-section-results')}%)  expect ~30%`);
  console.log(`  log:      ${sizes['probe-section-log'].h}px  (${pct('probe-section-log')}%)  expect ~20%`);

  // OK if within ±5% of target
  const ok1B =
    sizes['probe-section-provider'].h <= 90 &&
    Math.abs(pct('probe-section-models')  - 22) <= 5 &&
    Math.abs(pct('probe-section-caps')    - 18) <= 5 &&
    Math.abs(pct('probe-section-results') - 30) <= 5 &&
    Math.abs(pct('probe-section-log')     - 20) <= 5;
  console.log(`  (1B) result: ${ok1B ? 'OK' : 'FAIL'}`);

  /* ===== (2D) relative tracking ===== */
  console.log('\n=== (2D) Relative tracking: mousedown + 1px move should NOT jump ===');
  // Pick probe-sash-caps (between models & caps), start from default ratio
  const sashResult = await page.evaluate(async () => {
    const sash = document.getElementById('probe-sash-caps');
    const before = document.getElementById('probe-section-models');
    const r = sash.getBoundingClientRect();
    // Hit exactly at sash center line (4px visual middle of 14px hit area)
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const before_h = before.getBoundingClientRect().height;
    return { sashX: cx, sashY: cy, beforeStart: Math.round(before_h) };
  });
  // Click exactly in the center, then drag +1px
  await page.mouse.move(sashResult.sashX, sashResult.sashY);
  await page.mouse.down();
  await page.mouse.move(sashResult.sashX, sashResult.sashY + 1, { steps: 1 });
  await page.waitForTimeout(150);
  const afterMove1 = await page.evaluate(() => {
    const before = document.getElementById('probe-section-models');
    return Math.round(before.getBoundingClientRect().height);
  });
  // With relative tracking and center click, 1px move -> before height grows ~1px
  // With ABSOLUTE tracking, the first move would jump to "ratio = (mouseY - container.top)/container.height"
  //   which at center click is ~ (current_pos / container_height) ~ 0.7 of container -> ≈ 525px on 750px container
  //   vs current 0.18 * 750 = 135px -> jump ~390px!
  console.log(`  before models.height at click: ${sashResult.beforeStart}px`);
  console.log(`  after  models.height +1px:    ${afterMove1}px`);
  const jump = afterMove1 - sashResult.beforeStart;
  console.log(`  delta: ${jump > 0 ? '+' : ''}${jump}px  (expect ~+1px; >30 means absolute-tracking reverted)`);
  const ok2D = Math.abs(jump - 1) <= 5;
  console.log(`  (2D) result: ${ok2D ? 'OK' : 'FAIL'}`);
  await page.mouse.up();

  /* ===== (3) cap-row with Chinese ===== */
  console.log('\n=== (3) cap checkboxes with Chinese annotations ===');
  const capInfo = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.cap-item')];
    return {
      count: items.length,
      withZh: items.filter(it => it.querySelector('.cap-zh')?.textContent.trim().length > 0).length,
      samples: items.slice(0, 3).map(it => ({
        en: it.querySelector('.cap-top')?.textContent.trim(),
        zh: it.querySelector('.cap-zh')?.textContent.trim(),
      })),
      capRowVisible: !!document.querySelector('.cap-row'),
    };
  });
  console.log(`  .cap-item count: ${capInfo.count}  (expect 13)`);
  console.log(`  .cap-zh filled:  ${capInfo.withZh}    (expect 13)`);
  console.log(`  .cap-row visible: ${capInfo.capRowVisible}`);
  console.log(`  sample: ${JSON.stringify(capInfo.samples)}`);
  const ok3 = capInfo.count === 13 && capInfo.withZh === 13 && capInfo.capRowVisible;
  console.log(`  (3) result: ${ok3 ? 'OK' : 'FAIL'}`);

  /* Final screenshot of probe layout */
  await page.screenshot({ path: 'D:/Documents/VibeCoding/GodeX/tools/_patches/after-1B2D3.png', fullPage: false });
  console.log('\nscreenshot saved: D:/Documents/VibeCoding/GodeX/tools/_patches/after-1B2D3.png');

  console.log('\n=== Summary ===');
  console.log(`  (1B) ratio: ${ok1B ? 'OK' : 'FAIL'}`);
  console.log(`  (2D) tracking: ${ok2D ? 'OK' : 'FAIL'}`);
  console.log(`  (3) cap-zh: ${ok3 ? 'OK' : 'FAIL'}`);
  console.log(`  page errors: ${errs.length === 0 ? 'none' : errs.join(' | ')}`);
  await browser.close();
  process.exit((ok1B && ok2D && ok3 && errs.length === 0) ? 0 : 1);
})();
