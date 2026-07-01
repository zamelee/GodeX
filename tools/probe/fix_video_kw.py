import re
src = r"D:\Documents\VibeCoding\GodeX\studio-tauri\src-tauri\src\probe.rs"
content = open(src, "r", encoding="utf-8").read()
old = """            Ok(r) if r.status().is_success() => {
                let j: serde_json::Value = r.json().unwrap_or(serde_json::Value::Null);
                let txt = reply_text(&j);
                let hit = reply_contains_any(&txt, &[&["red","\\u{7ea2}\\u{8272}","saturated","crimson","scarlet"], &["video","\\u{89c6}\\u{9891}","frame","play","image","mp4"]]);
                let v = hit.is_some();
                caps.video = Some(v);
                self.emit(ProbeEvent::info("video", if v {"ok"} else {"fail"}, &format!("hit={:?}", hit)));
            }"""
new = """            Ok(r) if r.status().is_success() => {
                let j: serde_json::Value = r.json().unwrap_or(serde_json::Value::Null);
                let txt = reply_text(&j);
                // Real video support = reply mentions the actual content (red frame).
                // Just "video" alone = fake-positive (model echoes the prompt).
                let red_hit = reply_contains_any(&txt, &[&["red","\\u{7ea2}\\u{8272}","saturated","crimson","scarlet"]]);
                let echo_hit = reply_contains_any(&txt, &[&["video","\\u{89c6}\\u{9891}","frame","play","image","mp4"]]);
                let v = red_hit.is_some();
                caps.video = Some(v);
                self.emit(ProbeEvent::info("video", if v {"ok"} else {"fail"}, &format!("red={:?} echo={:?}", red_hit, echo_hit)));
            }"""
if old in content:
    content = content.replace(old, new, 1)
    open(src, "w", encoding="utf-8").write(content)
    print("Fixed video keyword check (red = real, echo = fake)")
else:
    print("NOT FOUND")
