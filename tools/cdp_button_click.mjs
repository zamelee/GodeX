import { WebSocket } from 'ws';
const ws = new WebSocket(process.argv[2]);
let id = 0; const pending = new Map();
function send(method, params) {
  return new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
}
function evalJs(expr) { return send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r.result); }
ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); } });
ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    // First close any open modal
    await evalJs('var m=document.getElementById("probe-modal"); if(m) m.style.display="none"; 1');
    // Find the button bounds
    const bounds = await evalJs(`(function(){
      const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim()==="模型探测");
      if (!btn) return JSON.stringify({found: false});
      const r = btn.getBoundingClientRect();
      return JSON.stringify({found: true, x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width/2, cy: r.y + r.height/2});
    })()`);
    console.log('button bounds:', bounds.value);
    const b = JSON.parse(bounds.value);
    if (!b.found) { ws.close(); process.exit(2); }
    // Click the button via CDP dispatchMouseEvent
    await send('Input.dispatchMouseEvent', { type: 'mousePressed',  x: b.cx, y: b.cy, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.cx, y: b.cy, button: 'left', clickCount: 1 });
    await new Promise(r => setTimeout(r, 400));
    // Check modal state
    const r2 = await evalJs(`(function(){
      const m = document.getElementById('probe-modal');
      const sel = document.getElementById('probe-provider');
      return JSON.stringify({
        modalDisplay: m?.style.display,
        providerOptions: Array.from(sel?.options || []).map(o => o.value),
      });
    })()`);
    console.log('after click:', r2.value);
    ws.close(); process.exit(0);
  } catch (e) { console.log('ERR:', e.message); process.exit(1); }
});
ws.on('error', e => { console.log('WS err:', e.message); process.exit(1); });