// Test sash-main-log dragging in studio
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  // Capture console logs
  page.on('console', m => console.log('[console]', m.type(), m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));

  // Navigate to local index.html via file://
  const indexPath = 'file:///' + path.resolve('studio-tauri/src/index.html').replace(/\\\\/g, '/');
  console.log('loading', indexPath);
  await page.goto(indexPath);

  // Wait for DOM ready
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);  // give initSashes time to run

  // Check sash-main-log exists
  const sash = await page.locator('#sash-main-log').first();
  const sashBox = await sash.boundingBox();
  console.log('sash-main-log box:', JSON.stringify(sashBox));

  const mainBox = await page.locator('main').boundingBox();
  const logBox = await page.locator('#log-region').boundingBox();
  console.log('main box BEFORE:', JSON.stringify(mainBox));
  console.log('log-region box BEFORE:', JSON.stringify(logBox));

  // Try to drag sash
  const startY = sashBox.y + sashBox.height / 2;
  const startX = sashBox.x + sashBox.width / 2;
  console.log('mouse down at', startX, startY);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(50);

  // Move down 200px
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

  console.log('main height change:', mainBox.height, '->', mainBoxAfter.height);
  console.log('log-region height change:', logBox.height, '->', logBoxAfter.height);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
