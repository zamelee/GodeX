// verify-studio-quick.cjs - just see if page loads
const { chromium } = require('playwright');
(async () => {
  console.log('launching browser...');
  const browser = await chromium.launch();
  console.log('newpage...');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', m => console.log('  console:', m.type(), m.text().slice(0, 100)));
  page.on('pageerror', e => console.log('  pageerror:', e.message.slice(0, 200)));
  page.on('request', r => { if (!r.url().startsWith('file://')) console.log('  req:', r.url().slice(0, 80)); });
  await page.addInitScript(() => {
    window.__TAURI__ = {
      core: { invoke: () => Promise.resolve(null) },
      event: { listen: () => Promise.resolve(() => {}) },
    };
  });
  console.log('goto...');
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/index.html', { timeout: 15000 });
  console.log('loaded, waiting 2s...');
  await page.waitForTimeout(2000);
  const title = await page.title();
  console.log('title:', title);
  await browser.close();
  console.log('done');
})().catch(e => { console.log('CAUGHT:', e.message); process.exit(1); });