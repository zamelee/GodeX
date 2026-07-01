const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const logs = [];
  page.on('pageerror', e => logs.push('ERR: ' + e.message));
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/tools/sash-preview.html');
  await page.waitForTimeout(800);

  console.log('=== STAGE 1: Initial (Studio layout) ===');
  const initStudio = await page.evaluate(() => {
    return {
      mainH: document.getElementById('studio-main').getBoundingClientRect().height,
      logRegionH: document.getElementById('studio-log-region').getBoundingClientRect().height,
      colLeftW: document.getElementById('studio-col-left').getBoundingClientRect().width,
      colRightW: document.getElementById('studio-col-right').getBoundingClientRect().width,
      fsProviderH: document.getElementById('studio-fs-provider').getBoundingClientRect().height,
      fsModelsH: document.getElementById('studio-fs-models').getBoundingClientRect().height,
    };
  });
  console.log(JSON.stringify(initStudio, null, 2));

  console.log('\n=== STAGE 2: Drag sash-main-log up 150px ===');
  let t = await page.evaluate(() => {
    const s = document.getElementById('sash-main-log');
    const r = s.getBoundingClientRect();
    return {x: r.x + r.width/2, y: r.y + r.height/2};
  });
  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await page.mouse.move(t.x, t.y - 150, {steps: 10});
  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterMainLog = await page.evaluate(() => ({
    mainH: document.getElementById('studio-main').getBoundingClientRect().height,
    logRegionH: document.getElementById('studio-log-region').getBoundingClientRect().height,
    mainFlex: document.getElementById('studio-main').style.flex,
    logFlex: document.getElementById('studio-log-region').style.flex,
  }));
  console.log(JSON.stringify(afterMainLog, null, 2));

  console.log('\n=== STAGE 3: Switch to Probe layout ===');
  await page.evaluate(() => {
    const btns = document.querySelectorAll('header button');
    for (const b of btns) if (b.textContent.includes('Probe 弹窗')) { b.click(); break; }
  });
  await page.waitForTimeout(500);

  console.log('--- Initial probe section heights ---');
  const initProbe = await page.evaluate(() => ({
    provider:  document.getElementById('probe-section-provider').getBoundingClientRect().height,
    models:    document.getElementById('probe-section-models').getBoundingClientRect().height,
    caps:      document.getElementById('probe-section-caps').getBoundingClientRect().height,
    results:   document.getElementById('probe-section-results').getBoundingClientRect().height,
    log:       document.getElementById('probe-section-log').getBoundingClientRect().height,
    providerFlex: document.getElementById('probe-section-provider').style.flex,
    modelsFlex:   document.getElementById('probe-section-models').style.flex,
    capsFlex:     document.getElementById('probe-section-caps').style.flex,
  }));
  console.log(JSON.stringify(initProbe, null, 2));

  console.log('\n=== STAGE 4: Drag probe-sash-models down 60px ===');
  t = await page.evaluate(() => {
    const s = document.getElementById('probe-sash-models');
    const r = s.getBoundingClientRect();
    return {x: r.x + r.width/2, y: r.y + r.height/2};
  });
  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await page.mouse.move(t.x, t.y + 60, {steps: 10});
  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterProbeModels = await page.evaluate(() => ({
    provider:  document.getElementById('probe-section-provider').getBoundingClientRect().height,
    models:    document.getElementById('probe-section-models').getBoundingClientRect().height,
    providerFlex: document.getElementById('probe-section-provider').style.flex,
    modelsFlex:   document.getElementById('probe-section-models').style.flex,
  }));
  console.log(JSON.stringify(afterProbeModels, null, 2));

  console.log('\nerrors:', logs);
  await browser.close();
})();
