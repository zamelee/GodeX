// verify-probe-headless.mjs
// 用 chrome --dump-dom + virtual-time-budget 跑 JS，检查 probe modal 渲染
import { spawn } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';

const wrapperUrl = 'file:///D:/Documents/VibeCoding/GodeX/tools/_probe_test_wrapper.html';
const chrome = 'C:\\Users\\Bliss\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe';

// We'll write a probe-runner page that:
// 1. Loads the wrapper via iframe (no same-origin issues since both are file://)
// 2. After load, calls launchModelProbe() and reports back via title

const runnerSrc = `<!doctype html>
<html><head><meta charset="utf-8"><title>probe-result</title></head><body>
<iframe id="f" src="${wrapperUrl}" width="1200" height="800" style="border:0"></iframe>
<script>
window.addEventListener('load', () => {
  const f = document.getElementById('f');
  f.addEventListener('load', () => {
    setTimeout(() => {
      try {
        const win = f.contentWindow;
        win.launchModelProbe && win.launchModelProbe();
        setTimeout(() => {
          const sel = win.document.getElementById('probe-provider');
          const opts = Array.from(sel?.options || []).map(o => o.value);
          sel.value = 'minnimax.chat';
          sel.dispatchEvent(new Event('change'));
          setTimeout(() => {
            const list = win.document.getElementById('probe-models-list');
            const items = Array.from(list?.querySelectorAll('.probe-model-item:not(.add-pill)') || [])
              .map(el => el.querySelector('.model-name')?.textContent?.trim());
            const provs = (win.providers || []).map(p => p.name);
            document.title = 'PROBE:' + JSON.stringify({ provs, opts, items });
          }, 500);
        }, 500);
      } catch (e) { document.title = 'PROBE_ERR:' + e.message; }
    }, 1500);
  });
});
</script></body></html>`;
fs.writeFileSync('D:/Documents/VibeCoding/GodeX/tools/_probe_runner.html', runnerSrc);

const proc = spawn(chrome, [
  '--headless', '--disable-gpu', '--no-sandbox',
  '--virtual-time-budget=8000',
  '--dump-dom',
  'file:///D:/Documents/VibeCoding/GodeX/tools/_probe_runner.html'
], { stdio: ['ignore', 'pipe', 'pipe'] });

let out = '', err = '';
proc.stdout.on('data', d => out += d.toString());
proc.stderr.on('data', d => err += d.toString());

setTimeout(() => {
  try { proc.kill(); } catch {}
}, 30000);

proc.on('close', code => {
  // Find the title in dumped DOM
  const m = out.match(/<title>(.*?)<\/title>/);
  console.log('exit code:', code);
  console.log('title:', m ? m[1] : '(no title found)');
  // Also look for any console errors
  const errs = err.split('\n').filter(l => l.includes('error') || l.includes('Error') || l.includes('Uncaught'));
  console.log('chrome stderr errors:', errs.slice(0, 5));
});