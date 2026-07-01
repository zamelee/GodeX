const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1100, height: 1000}});
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/tools/probe-preview.html');
  await page.waitForTimeout(500);

  const scenarios = [
    {name: '01-empty',         btn: 'empty',   desc: '空状态(没选 Provider)'},
    {name: '02-loaded',        btn: 'loaded',  desc: '选了 Provider,5 个已启用'},
    {name: '03-empty2',        btn: 'empty2',  desc: 'Provider 无已启用模型'},
    {name: '04-custom',        btn: 'custom',  desc: '5 已启用 + 2 自定义'},
    {name: '05-probed',        btn: 'probed',  desc: '5 行结果已填充'},
  ];
  const buttons = ['empty', 'loaded', 'empty2', 'custom', 'probed'];

  for (const btn of buttons) {
    await page.evaluate(b => {
      const btns = document.querySelectorAll('.toolbar button');
      for (const x of btns) if (x.textContent.includes(b)) { x.click(); break; }
    }, btn);
    await page.waitForTimeout(400);
    const fp = `D:\\Documents\\VibeCoding\\GodeX\\tools\\probe-preview-${btn}.png`;
    await page.screenshot({path: fp, fullPage: false});
    console.log('  saved:', fp);
  }

  // Special: actually run probe with simulated delay
  console.log('\n--- run probe (animated) ---');
  await page.evaluate(() => {
    const btns = document.querySelectorAll('.toolbar button');
    for (const x of btns) if (x.textContent.includes('loaded')) { x.click(); break; }
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.getElementById('btn-probe-start').click();
  });
  // Wait for probe to complete (5 models * 300ms = 1.5s)
  await page.waitForTimeout(2200);
  await page.screenshot({path: 'D:\\Documents\\VibeCoding\\GodeX\\tools\\probe-preview-running-done.png', fullPage: false});
  console.log('  saved: probe-preview-running-done.png');

  await browser.close();
})();
