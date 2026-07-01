import base64, re
content = open(r"D:\Documents\VibeCoding\GodeX\tools\probe\b64_assets_single.rs", "r", encoding="utf-8").read()
new_video = base64.b64encode(open(r"D:\Documents\VibeCoding\GodeX\tools\probe\fixtures\video_test.mp4", "rb").read()).decode("ascii")
print("new VIDEO_B64 len:", len(new_video))
content = re.sub(
    r"pub const VIDEO_B64: &str = \"[^\"]+\";",
    "pub const VIDEO_B64: &str = \"" + new_video + "\";",
    content
)
# Update the comment too
content = re.sub(r"// video_test\.mp4 b64 \(single-line\).*", "// video_test.mp4 b64 (real mp4: 1 frame 128x128 red, h264, ffprobe-valid, len=" + str(len(new_video)) + ")", content)
open(r"D:\Documents\VibeCoding\GodeX\tools\probe\b64_assets_single.rs", "w", encoding="utf-8").write(content)
print("Updated b64_assets_single.rs")
print("first 200 chars:", content[:200])
