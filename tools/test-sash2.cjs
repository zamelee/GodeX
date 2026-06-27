// Test with mocked __TAURI__ so init runs
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('console', m => console.log('[console]', m.type(), m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));

  const indexPath = 'file:///' + path.resolve('studio-tauri/src/index.html').replace(/\\\\/g, '/');

  // Inject mock __TAURI__ before navigation
  await page.addInitScript(() => {
    window.__TAURI__ = {
      core: {
        invoke: async (cmd, args) => {
          if (cmd === 'get_config_paths') return { godex_config: 'x', godex_binary: 'x', godex_port: 5678, external_mode: false, logging_file: null, session_db_path: 'x', trace_db_path: 'x', path_change_notice: null, path_provision_notice: null };
          if (cmd === 'get_replica_status') return { enabled: false, running: false, pid: null, replica_path: null };
          if (cmd === 'check_port') return null;
          if (cmd === 'list_providers') return [];
          if (cmd === 'list_presets') return {};
          if (cmd === 'godex_status') return { running: false, port: 5678 };
          if (cmd === 'godex_logs_tail') return [];
          if (cmd === 'set_external_mode') return null;
          console.log('[mock invoke]', cmd, args);
          return null;
        }
      },
      event: { listen: async () => () => {} }
    };
  });

  await page.goto(indexPath);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);

  const sash = await page.locator('#sash-main-log').first();
  const sashBox = await sash.boundingBox();
  console.log('sash-main-log box:', JSON.stringify(sashBox));

  const mainBox = await page.locator('main').boundingBox();
  const logBox = await page.locator('#log-region').boundingBox();
  console.log('main box BEFORE:', JSON.stringify(mainBox));
  console.log('log-region box BEFORE:', JSON.stringify(logBox));

  const startY = sashBox.y + sashBox.height / 2;
  const startX = sashBox.x + sashBox.width / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(50);
  for (let i = 0; i < 20; i++) {
    await page.mouse.move(startX, startY + 10 * (i + 1));
    await page.waitForTimeout(10);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);

  const mainBoxAfter = await page.locator('main').boundingBox();
  const logBoxAfter = await page.locator('#log-region').boundingBox();
  console.log('main box AFTER:', JSON.stringify(mainBoxAfter));
  console.log('log-region box AFTER:', JSON.stringify(logBoxAfter));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
