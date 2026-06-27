const fs = require('fs');
const f = 'studio-tauri/model-probe/src-tauri/src/lib.rs';
let s = fs.readFileSync(f, 'utf-8');
const old = "fn get_initial_config_path(state: State<'_', AppState>) -> Option<String> {";
const fix = "fn get_initial_config_path(state: State<'_, AppState>) -> Option<String> {";
if (!s.includes(old)) { console.log('OLD not found'); process.exit(1); }
if (!s.includes(fix)) {
    s = s.replace(old, fix);
    fs.writeFileSync(f, s);
    console.log('fixed');
} else {
    console.log('already correct');
}
