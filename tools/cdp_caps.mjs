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
    const r = await evalJs(`(function(){
      const inputs = Array.from(document.querySelectorAll('input[type=checkbox]'));
      const probeModal = document.getElementById('probe-modal');
      const probeSection = probeModal ? probeModal.querySelector('.probe-section') : null;
      const all = probeSection ? Array.from(probeSection.querySelectorAll('*')).filter(e => e.tagName==='INPUT' || e.tagName==='LABEL') : [];
      return JSON.stringify({
        checkboxCount: inputs.length,
        probeSectionInputs: all.filter(e=>e.tagName==='INPUT').length,
        probeSectionChecked: all.filter(e=>e.tagName==='INPUT' && e.checked).length,
        probeSectionLabels: all.filter(e=>e.tagName==='LABEL').slice(0,20).map(l => l.textContent.trim()),
      });
    })()`);
    console.log('caps:', r.value);
    ws.close(); process.exit(0);
  } catch (e) { console.log('ERR:', e.message); process.exit(1); }
});
ws.on('error', e => { console.log('WS err:', e.message); process.exit(1); });