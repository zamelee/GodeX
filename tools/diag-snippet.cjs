const fs = require('fs');
const f = 'studio-tauri/model-probe/src-tauri/src/lib.rs';
let s = fs.readFileSync(f, 'utf-8');
const oldGetInit = "fn get_initial_config_path(state: State<'_, AppState>) -> Option<String> {\n    state.config_path.lock().unwrap().clone().map(|p| p.display().to_string())\n}";
if (!s.includes(oldGetInit)) { console.log('OLD not found'); process.exit(1); }
if (s.includes('fn write_diag')) { console.log('already patched'); process.exit(0); }
const helperSnippet = "\n\n/// Diagnostic: dump resolved config path to ~/.godex/model-probe-diag.txt\n/// so we can verify CLI --config=... pass-through end-to-end.\nfn write_diag(state_config: &Option<PathBuf>) {\n    let home = std::env::var(\"USERPROFILE\").unwrap_or_else(|_| \".\".into());\n    let diag = std::path::PathBuf::from(home).join(\".godex\").join(\"model-probe-diag.txt\");\n    let _ = std::fs::create_dir_all(diag.parent().unwrap());\n    let cli = CLI_CONFIG_PATH.get().cloned().unwrap_or(None);\n    let body = format!(\"cli_arg: {:?}\\nresolved: {:?}\\n\",\n        cli.as_ref().map(|p| p.display().to_string()),\n        state_config.as_ref().map(|p| p.display().to_string()));\n    let _ = std::fs::write(&diag, body);\n}";
const newGetInit = oldGetInit + helperSnippet;
s = s.replace(oldGetInit, newGetInit);
const oldSetupStart = ".setup(|app| {\n            // 1)";
if (!s.includes(oldSetupStart)) { console.log('setup start not found'); process.exit(1); }
const newSetupStart = ".setup(|app| {\n            // diag\n            if let Some(s0) = app.try_state::<AppState>() {\n                write_diag(&s0.config_path.lock().unwrap().clone());\n            }\n            // 1)";
s = s.replace(oldSetupStart, newSetupStart);
fs.writeFileSync(f, s);
console.log('patched');
