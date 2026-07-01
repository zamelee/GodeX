import { WebSocket } from 'ws';
const ws = new WebSocket(process.argv[2]);
let id = 0; const pending = new Map();
function send(method, params) {
  return new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
}
function evalJs(expr) {
  return send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r.result);
}
ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); } });
ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    // Open modal first (it might already be open from previous test)
    await evalJs('launchModelProbe(); 1');
    await new Promise(r => setTimeout(r, 300));
    const r = await evalJs(`(function(){
      const grid = document.querySelector('.probe-caps-grid');
      const labels = grid ? Array.from(grid.querySelectorAll('label')) : [];
      const caps = labels.map(l => {
        const input = l.querySelector('input[type=checkbox]');
        const capTop = l.querySelector('.cap-top');
        const capZh  = l.querySelector('.cap-zh');
        return {
          id: input ? input.id : null,
          checked: input ? input.checked : null,
          en: capTop ? capTop.textContent.trim() : null,
          zh: capZh ? capZh.textContent.trim() : null,
        };
      });
      return JSON.stringify({ gridExists: !!grid, count: labels.length, caps: caps });
    })()`);
    console.log('caps:', r.value);
    ws.close(); process.exit(0);
  } catch (e) { console.log('ERR:', e.message); process.exit(1); }
});
ws.on('error', e => { console.log('WS err:', e.message); process.exit(1); });