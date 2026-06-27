const fs = require('fs');
const f = 'studio-tauri/src/index.html';
let s = fs.readFileSync(f, 'utf-8');
// Replace the whole loadReplicaStatus body with a stub
const marker = "async function loadReplicaStatus() {\r\n  try {\r\n    const s = await invoke(\"get_replica_status\");\r\n    \$('set-replica-mode').checked = s.enabled;\r\n    if (s.replica_path) \$('set-replica-path').textContent = s.replica_path;";
const replacement = "async function loadReplicaStatus() {\r\n  // DEPRECATED: replica UI removed. Use GodeX panel header mode selector instead.\r\n  return; // no-op";
if (!s.includes(marker)) { console.log('marker not found'); process.exit(1); }
s = s.replace(marker, replacement);
fs.writeFileSync(f, s);
console.log('stubbed, len=' + s.length);
