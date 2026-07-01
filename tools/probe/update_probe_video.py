import base64, re
# Update probe.rs VIDEO_B64 from b64_assets_single.rs
src_probe = r"D:\Documents\VibeCoding\GodeX\studio-tauri\src-tauri\src\probe.rs"
src_b64 = r"D:\Documents\VibeCoding\GodeX\tools\probe\b64_assets_single.rs"
probe = open(src_probe, "r", encoding="utf-8").read()
b64_src = open(src_b64, "r", encoding="utf-8").read()
m = re.search(r"pub const VIDEO_B64: &str = \"([^\"]+)\";", b64_src)
new_video = m.group(1)
# Replace VIDEO_B64 in probe.rs
probe = re.sub(
    r"pub const VIDEO_B64: &str = \"[^\"]+\";",
    "pub const VIDEO_B64: &str = \"" + new_video + "\";",
    probe
)
print("new VIDEO_B64 len in probe.rs:", len(new_video))
# Also update the video keyword check in probe_caps to include red
old_kw = "let hit = reply_contains_any(&txt, &[&[\"video\",\"\\u{89c6}\\u{9891}\",\"frame\",\"play\",\"image\",\"mp4\"]]);"
new_kw = "let hit = reply_contains_any(&txt, &[&[\"red\",\"\\u{7ea2}\\u{8272}\",\"saturated\",\"crimson\",\"scarlet\"], &[\"video\",\"\\u{89c6}\\u{9891}\",\"frame\",\"play\",\"image\",\"mp4\"]]);"
if old_kw in probe:
    probe = probe.replace(old_kw, new_kw, 1)
    print("Updated video keyword to require red OR video-related")
else:
    print("video kw NOT FOUND")
open(src_probe, "w", encoding="utf-8").write(probe)
print("Updated probe.rs")
print("file size:", len(probe))
