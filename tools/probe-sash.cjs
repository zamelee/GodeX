const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file:///D:/Documents/VibeCoding/GodeX/studio-tauri/src/sash_full_test.html');
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const sash = document.getElementById('sash-main-log');
    const main = document.querySelector('main');
    const body = document.body;
    let parent = sash.parentElement;
    const chain = [];
    while (parent) { chain.push(parent.tagName + (parent.id ? '#' + parent.id : '')); parent = parent.parentElement; }
    return {
      sash_parentTag: sash.parentElement.tagName,
      sash_parentId: sash.parentElement.id,
      chain: chain,
      main_in_body: body.contains(main),
      sash_in_body: body.contains(sash),
      sash_in_main: main.contains(sash),
      sash_debug: window._godexSashes && window._godexSashes.map(function(s){return {sashId:s.sash.id,beforeTag:s.before?s.before.tagName:null,beforeId:s.before?s.before.id:null,afterTag:s.after?s.after.tagName:null,afterId:s.after?s.after.id:null,containerTag:s.container?s.container.tagName:null,containerId:s.container?s.container.id:null};})
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
