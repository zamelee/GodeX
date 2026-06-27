/* Fix 4 latent bugs in src/index.html (3 actual, 1 verified non-bug)
 * 1. renderModels line 1034: rows.filter -> allRows.filter
 * 2. (no fix needed) launchModelProbe Rust side already passes --config
 * 3. replica section: remove display:none chicken-and-egg
 * 4. (no fix needed) sash CSS already fixed in current source
 */
const fs = require("fs");
const path = "studio-tauri/src/index.html";
let s = fs.readFileSync(path, "utf8");
const CRLF = "\r\n";
const findReplace = (find, repl) => {
  if (!s.includes(find)) { console.error("NOT FOUND:\n" + find.slice(0, 200)); process.exit(1); }
  s = s.replace(find, repl);
};

/* === Fix 1: renderModels rows.filter -> allRows.filter === */
findReplace(
  "  const filtered = filter ? rows.filter((r) => r.m.model.toLowerCase().includes(filter)) : allRows;",
  "  const filtered = filter ? allRows.filter((r) => r.m.model.toLowerCase().includes(filter)) : allRows;"
);
console.log("Fix 1 done (renderModels rows -> allRows)");

/* === Fix 3: replica section always visible, checkbox is the toggle === */
// Remove the initial display:none so the section is visible from the start.
findReplace(
  "    <div class=\"row\" id=\"replica-section\" style=\"display:none\">",
  "    <div class=\"row\" id=\"replica-section\">"
);
console.log("Fix 3a done (replica section always visible)");

// Also remove the section.style.display manipulation in loadReplicaStatus so
// the section stays visible. The checkbox still controls the mode, but the
// section UI (path / start / kill buttons) is always reachable.
findReplace(
  "    const s = await invoke(\"get_replica_status\");" + CRLF +
  "    $(\"set-replica-mode\").checked = s.enabled;" + CRLF +
  "    const section = $(\"replica-section\");" + CRLF +
  "    section.style.display = s.enabled ? \"block\" : \"none\";" + CRLF +
  "    if (s.replica_path) $(\"set-replica-path\").textContent = s.replica_path;",
  "    const s = await invoke(\"get_replica_status\");" + CRLF +
  "    $('set-replica-mode').checked = s.enabled;" + CRLF +
  "    if (s.replica_path) $('set-replica-path').textContent = s.replica_path;"
);
console.log("Fix 3b done (loadReplicaStatus no longer hides section)");

fs.writeFileSync(path, s);
console.log("OK: wrote", path);