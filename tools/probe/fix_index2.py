src = r"D:\Documents\VibeCoding\GodeX\studio-tauri\src/index.html"
c = open(src, "r", encoding="utf-8").read()
old = """  function log(msg) {
    const ts = new Date().toLocaleTimeString();
    logEl.innerHTML += "[" + ts + "] " + msg + "\\n";
    logEl.scrollTop = logEl.scrollHeight;
  }"""
new = """  function log(msg) {
    const ts = new Date().toLocaleTimeString();
    logEl.innerHTML += "[" + ts + "] " + msg + "\\n";
    logEl.scrollTop = logEl.scrollHeight;
  }

  // Listen for live probe-progress events from the 3 probe commands
  let _unlistenProbe = null;
  try {
    if (window.__TAURI__ && window.__TAURI__.event) {
      const tauri = window.__TAURI__;
      _unlistenProbe = await tauri.event.listen("probe-progress", (ev) => {
        const p = ev.payload || {};
        const stage = p.stage || "?";
        const status = p.status || "?";
        const detail = p.detail || "";
        log("    " + stage + ":" + status + (detail ? " " + detail : ""));
      });
    }
  } catch (e) { /* no tauri yet, ignore */ }"""
if old in c:
    c = c.replace(old, new, 1)
    open(src, "w", encoding="utf-8").write(c)
    print("Added probe-progress listener")
else:
    print("OLD NOT FOUND")
