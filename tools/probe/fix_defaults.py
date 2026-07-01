src = r"D:\Documents\VibeCoding\GodeX\studio-tauri\src-tauri/examples/test_probe.rs"
content = open(src, "r", encoding="utf-8").read()
old1 = "    let base_url = args.get(1).cloned().unwrap_or_else(|| \"https://minnimax.chat/v1\".to_string());"
new1 = "    let base_url = args.get(1).cloned().filter(|s| !s.is_empty()).unwrap_or_else(|| \"https://minnimax.chat/v1\".to_string());"
old2 = "    let api_key = args.get(2).cloned().unwrap_or_else(read_key);"
new2 = "    let api_key = args.get(2).cloned().filter(|s| !s.is_empty()).unwrap_or_else(read_key);"
if old1 in content:
    content = content.replace(old1, new1)
if old2 in content:
    content = content.replace(old2, new2)
open(src, "w", encoding="utf-8").write(content)
print("done")
