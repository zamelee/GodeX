const { chromium } = require('playwright');
const path = require('path');

async function dragSash(page, sashId, dx, dy) {
  const s = await page.locator('#' + sashId).first();
  const b = await s.boundingBox();
  if (!b) throw new Error('no box for ' + sashId);
  await page.mouse.move(b.x + b.width/2, b.y + b.height/2);
  await page.mouse.down();
  await page.waitForTimeout(50);
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(b.x + b.width/2 + dx * i/10, b.y + b.height/2 + dy * i/10);
    await page.waitForTimeout(10);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  let pageErrors = [];
  page.on('pageerror', e => { console.log('[pageerror]', e.message); pageErrors.push(e.message); });

  await page.addInitScript(() => {
    window.__TAURI__ = {
      core: { invoke: async (cmd) => {
        if (cmd === 'get_config_paths') return { godex_config:'x',godex_binary:'x',godex_port:5678,external_mode:false,logging_file:null,session_db_path:'x',trace_db_path:'x',path_change_notice:null,path_provision_notice:null };
        if (cmd === 'get_replica_status') return { enabled:false, running:false, pid:null, replica_path:null };
        if (cmd === 'list_providers') return [];
        if (cmd === 'list_presets') return {};
        if (cmd === 'godex_status') return { running:false, port:5678 };
        if (cmd === 'godex_logs_tail') return [];
        if (cmd === 'set_external_mode') return null;
        return null;
      }},
      event: { listen: async () => () => {} }
    };
  });

  const indexPath = 'file:///' + path.resolve('studio-tauri/src/index.html').replace(/\\\\/g, '/');
  await page.goto(indexPath);
  await page.waitForTimeout(2500);

  let m = await page.locator('main').boundingBox();
  let l = await page.locator('#log-region').boundingBox();
  console.log('sash-main-log BEFORE: main=' + m.height + ' log=' + l.height);
  await dragSash(page, 'sash-main-log', 0, 200);
  m = await page.locator('main').boundingBox();
  l = await page.locator('#log-region').boundingBox();
  console.log('sash-main-log AFTER : main=' + m.height + ' log=' + l.height);

  let cl = await page.locator('#col-left').boundingBox();
  let cr = await page.locator('#col-right').boundingBox();
  console.log('sash-cols BEFORE: col-left=' + cl.width + ' col-right=' + cr.width);
  await dragSash(page, 'sash-cols', 100, 0);
  cl = await page.locator('#col-left').boundingBox();
  cr = await page.locator('#col-right').boundingBox();
  console.log('sash-cols AFTER : col-left=' + cl.width + ' col-right=' + cr.width);

  let ls = await page.locator('#lp-studio').boundingBox();
  let lg = await page.locator('#lp-godex').boundingBox();
  console.log('log-sash BEFORE: lp-studio=' + ls.height + ' lp-godex=' + lg.height);
  await dragSash(page, 'log-sash', 0, 60);
  ls = await page.locator('#lp-studio').boundingBox();
  lg = await page.locator('#lp-godex').boundingBox();
  console.log('log-sash AFTER : lp-studio=' + ls.height + ' lp-godex=' + lg.height);

  console.log('total pageerrors:', pageErrors.length);
  if (pageErrors.length) console.log('errors:', pageErrors);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
