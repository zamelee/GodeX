src = r"D:\Documents\VibeCoding\GodeX\studio-tauri\src-tauri\src\probe.rs"
c = open(src).read()
old = "fn reply_contains_any(text: &str, kw_groups: &[&[&str]]) -> Option<&str> {"
new = "fn reply_contains_any(text: &str, kw_groups: &[&[&str]]) -> Option<String> {"
body_old = "                return Some(kw);"
body_new = "                return Some(kw.to_string());"
if old in c:
    c = c.replace(old, new)
if body_old in c:
    c = c.replace(body_old, body_new)
# Also fix the call sites that use the returned Option<&str>
# Find all .emit calls with reply_contains_any and change to .as_deref()
c = c.replace(".emit(ProbeEvent::info(", ".emit(ProbeEvent::info(")
# This is too generic, just leave it - the call sites use the result in format!
# format! needs Display, so we need to convert Option<String> to Option<&str> or just use {hit:?}
# Actually the format! uses hit:? which works for Option<String> too
open(src, "w").write(c)
print("done")
