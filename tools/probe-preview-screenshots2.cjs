const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1100, height: 1000}});
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/tools/probe-preview.html');
  await page.waitForTimeout(500);

  const scenarios = [
    {name: 'empty',   zh: '空状态', desc: '没选 Provider,只有 + 手动添加'},
    {name: 'loaded',  zh: '已加载', desc: '选了 Provider,5 个 enabled 模型 + 1 add'},
    {name: 'empty2',  zh: '空 Provider', desc: '选了 Provider 但无已启用模型'},
    {name: 'custom',  zh: '5 + 2 自定义', desc: '5 enabled + 2 手动添加(蓝色) + 1 add'},
    {name: 'probed',  zh: '探测完成', desc: '结果表预填 5 行'},
  ];

  for (const s of scenarios) {
    await page.evaluate(zh => {
      const btns = document.querySelectorAll('.toolbar button');
      for (const x of btns) if (x.textContent.includes(zh)) { x.click(); break; }
    }, s.zh);
    await page.waitForTimeout(400);
    const fp = `D:\\Documents\\VibeCoding\\GodeX\\tools\\probe-preview-${s.name}.png`;
    await page.screenshot({path: fp, fullPage: false});
    console.log('  saved:', fp, '(' + s.desc + ')');
  }

  // Special: animated run
  console.log('\n--- animated probe run ---');
  await page.evaluate(() => {
    const btns = document.querySelectorAll('.toolbar button');
    for (const x of btns) if (x.textContent.includes('已加载')) { x.click(); break; }
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('btn-probe-start').click());
  // Capture mid-probe and done
  await page.waitForTimeout(900);
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\probe-preview-running-mid.png', fullPage: false});
  console.log('  saved: probe-preview-running-mid.png (mid-probe)');
  await page.waitForTimeout(1500);
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\probe-preview-running-done.png', fullPage: false});
  console.log('  saved: probe-preview-running-done.png (done)');

  await browser.close();
})();
