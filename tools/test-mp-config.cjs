const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('console', m => console.log('[console]', m.type(), m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));

  // Mock __TAURI__: get_initial_config_path returns our test path
  await page.addInitScript(() => {
    let cfgPath = 'D:/Documents/VibeCoding/GodeX/godex.yaml';
    window.__TAURI__ = {
      core: {
        invoke: async (cmd, args) => {
          if (cmd === 'get_initial_config_path') return cfgPath;
          if (cmd === 'set_config_path') return null;
          if (cmd === 'get_config') {
            // Pretend we loaded 2 models
            return [
              [{ provider: 'minimax', model: 'MiniMax-M3', context_window: 1000000, max_tokens: 196608, margin: null },
               { provider: 'minimax', model: 'MiniMax-M2.7', context_window: 204800, max_tokens: 196608, margin: null }],
              [{ name: 'minimax', base_url: 'https://api.minimax.chat/v1', api_key: 'sk-***' }]
            ];
          }
          if (cmd === 'get_godex_url') return 'http://localhost:5678';
          if (cmd === 'check_godex_running') return false;
          return null;
        }
      }
    };
  });

  const mpPath = 'file:///' + path.resolve('studio-tauri/model-probe/src/index.html').replace(/\\\\/g, '/');
  console.log('loading', mpPath);
  await page.goto(mpPath);
  await page.waitForTimeout(1500);

  // Check cfg-path input
  const cfgVal = await page.locator('#cfg-path').inputValue();
  console.log('cfg-path value:', JSON.stringify(cfgVal));
  const cfgStatus = await page.locator('#cfg-status').innerHTML();
  console.log('cfg-status:', cfgStatus);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
