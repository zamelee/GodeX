const fs = require('fs');
const f = 'studio-tauri/src-tauri/src/commands.rs';
let s = fs.readFileSync(f, 'utf-8');
const old = "pub fn set_replica_mode(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {\r\n    crate::diag(&format!(\"[cmd] set_replica_mode {}\", enabled));\r\n    state.godex.set_replica_mode(enabled);\r\n    Ok(())\r\n}\r\n\r\n#[tauri::command(rename_all = \"camelCase\")]";
const newBlock = "pub fn set_replica_mode(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {\r\n    crate::diag(&format!(\"[cmd] set_replica_mode {}\", enabled));\r\n    state.godex.set_replica_mode(enabled);\r\n    Ok(())\r\n}\r\n\r\n/// Set GodeX run mode: \"builtin\" | \"replica\" | \"external\".\r\n/// Updates both external_mode and replica_mode flags atomically.\r\n#[tauri::command]\r\npub fn set_godex_mode(state: State<'_, AppState>, mode: String) {\r\n    crate::diag(&format!(\"[cmd] set_godex_mode={}\", mode));\r\n    state.godex.set_external_mode(mode == \"external\");\r\n    state.godex.set_replica_mode(mode == \"replica\");\r\n}\r\n\r\n#[tauri::command(rename_all = \"camelCase\")]";
if (!s.includes(old)) { console.log('OLD not found'); process.exit(1); }
if (s.includes('fn set_godex_mode')) { console.log('already has set_godex_mode'); process.exit(0); }
s = s.replace(old, newBlock);
fs.writeFileSync(f, s);
console.log('patched, new len=' + s.length);
