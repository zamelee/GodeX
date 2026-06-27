const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));

  // NO mock - just see if page loads
  const mpPath = 'file:///' + path.resolve('studio-tauri/model-probe/src/index.html').replace(/\\\\/g, '/');
  console.log('loading', mpPath);
  await page.goto(mpPath);
  await page.waitForTimeout(2000);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
