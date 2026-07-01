import sys
p = r"studio-tauri/src-tauri/src/commands.rs"
b = open(p, "rb").read()
old = b'    crate::diag(&format!("[cmd] enter list_providers"));\r\n    let path = state.paths.lock().godex_config.clone();\r\n    let res = config::read_providers(&path);\r\n    crate::diag(&format!("[cmd] list_providers path={} count={} names={:?}", path.display(), res.len(), res.iter().map(|p| &p.name).collect::<Vec<_>>()));\r\n    Ok(res)'
new = b'    crate::diag(&format!("[cmd] enter list_providers"));\r\n    let path = state.paths.lock().godex_config.clone();\r\n    Ok(config::read_providers(&path))'
print("found:", old in b)
if old in b:
    nb = b.replace(old, new)
    open(p, "wb").write(nb)
    print("reverted, size", len(nb))