// cdp_probe.mjs - Connect to Tauri WebView2 via CDP and test model probe flow
import { WebSocket } from 'ws';

const wsUrl = process.argv[2];
const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();

function send(method, params) {
  return new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
}

function evalJs(expr) {
  return send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    .then(r => r.result);
}

ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message));
    else p.resolve(m.result);
  }
});

ws.on('open', async () => {
  try {
    await send('Runtime.enable');

    // 1) Check global providers
    let r = await evalJs('JSON.stringify({ providers: typeof providers !== "undefined" ? providers.map(p=>p.name) : "undef", len: typeof providers !== "undefined" ? providers.length : -1 })');
    console.log('1. global providers:', r.value);

    // 2) Open modal
    r = await evalJs('launchModelProbe(); "opened"');
    console.log('2. launchModelProbe:', r.value);
    await new Promise(r => setTimeout(r, 300));

    // 3) Check provider dropdown options
    r = await evalJs('JSON.stringify(Array.from(document.getElementById("probe-provider")?.options || []).map(o => o.value))');
    console.log('3. probe-provider options:', r.value);

    // 4) Select minnimax.chat
    r = await evalJs('var s=document.getElementById("probe-provider"); s.value="minnimax.chat"; s.dispatchEvent(new Event("change")); "set"');
    console.log('4. set value:', r.value);
    await new Promise(r => setTimeout(r, 400));

    // 5) Check models list
    r = await evalJs('JSON.stringify(Array.from(document.getElementById("probe-models-list")?.querySelectorAll(".probe-model-item:not(.add-pill)") || []).map(el => el.querySelector(".model-name")?.textContent?.trim()).filter(Boolean))');
    console.log('5. models in list:', r.value);

    // 6) Check capability checkboxes
    r = await evalJs('JSON.stringify(Array.from(document.querySelectorAll(".probe-cap-item input[type=checkbox]")).map(c => ({ id: c.id, checked: c.checked, label: c.parentElement?.textContent?.trim() })))');
    console.log('6. capability checkboxes:', r.value?.slice(0, 600));

    ws.close();
    process.exit(0);
  } catch (e) {
    console.log('ERR:', e.message);
    process.exit(1);
  }
});
ws.on('error', e => { console.log('WS err:', e.message); process.exit(1); });