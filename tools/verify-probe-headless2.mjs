// verify-probe-headless2.mjs
// chrome --dump-dom with --virtual-time-budget to run our __RUN__
// output: dump DOM, then we parse the title for JSON
import { spawn } from 'child_process';
import fs from 'fs';

const chrome = 'C:\\Users\\Bliss\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe';

// Inject title-poking script that runs __RUN__ and writes result into <title>
const runnerHtml = `<!doctype html><html><head><meta charset="utf-8"><title>loading</title></head><body><script>
  const f = document.createElement('iframe');
  f.src = 'file:///D:/Documents/VibeCoding/GodeX/tools/_index_with_stub.html';
  f.style.cssText = 'width:1px;height:1px;border:0;position:absolute;left:-9999px';
  f.onload = () => {
    const w = f.contentWindow;
    setTimeout(() => {
      w.__RUN__().then(r => { document.title = 'RESULT:' + r; });
    }, 500);
  };
  document.body.appendChild(f);
</script></body></html>`;
fs.writeFileSync('D:/Documents/VibeCoding/GodeX/tools/_probe_runner.html', runnerHtml);

const proc = spawn(chrome, [
  '--headless', '--disable-gpu', '--no-sandbox',
  '--virtual-time-budget=10000',
  '--allow-file-access-from-files',
  '--disable-web-security',
  '--dump-dom',
  'file:///D:/Documents/VibeCoding/GodeX/tools/_probe_runner.html'
], { stdio: ['ignore', 'pipe', 'pipe'] });

let out = '', err = '';
proc.stdout.on('data', d => out += d.toString());
proc.stderr.on('data', d => err += d.toString());

setTimeout(() => { try { proc.kill(); } catch {} }, 30000);
proc.on('close', code => {
  const m = out.match(/<title>([^<]*)<\/title>/);
  console.log('exit:', code, ' title:', m ? m[1] : '(none)');
  const errs = err.split('\n').filter(l => /error|Uncaught|Refused/i.test(l));
  console.log('err lines:', errs.slice(0, 5));
});