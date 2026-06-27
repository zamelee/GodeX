/* Fix root cause: .model-list { contain: strict } requires explicit size,
   otherwise the browser renders the element as 0 tall. This collapsed the
   fs-models panel which made bug #1 (no list), #3 (replica section not
   visible) and #4 (sash unadjustable) all look broken. */
const fs = require("fs");
const path = "studio-tauri/src/index.html";
let s = fs.readFileSync(path, "utf8");
const CRLF = "\r\n";
const old = ".model-list{padding:0;contain:strict}";
const repl = ".model-list{padding:0;contain:layout style;flex:1 1 0;min-height:0;overflow:auto}";
if (!s.includes(old)) { console.error("NOT FOUND"); process.exit(1); }
s = s.replace(old, repl);
fs.writeFileSync(path, s);
console.log("OK: fixed .model-list CSS");