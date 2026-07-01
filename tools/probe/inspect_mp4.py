import base64, re, subprocess
content = open(r"D:\Documents\VibeCoding\GodeX\tools\probe\b64_assets_single.rs", "r", encoding="utf-8").read()
m = re.search(r"pub const VIDEO_B64: &str = \"([^\"]+)\"", content)
data = base64.b64decode(m.group(1))
print("mp4 size:", len(data), "bytes")
print("BOX structure (ISO BMFF):")
i = 0
while i + 8 <= len(data):
    size = int.from_bytes(data[i:i+4], "big")
    box_type = data[i+4:i+8].decode("ascii", errors="replace")
    print("  offset", hex(i), "size", size, "type", repr(box_type))
    if size < 8: break
    i += size
print()
mp4_path = r"D:\Documents\VibeCoding\GodeX\tools\probe\fixtures\video_test.mp4"
real_data = open(mp4_path, "rb").read()
print("real fixture mp4 size:", len(real_data), "bytes")
print("ffprobe:")
r = subprocess.run(["ffprobe", "-v", "error", mp4_path], capture_output=True, text=True)
print("  stdout:", r.stdout[:300])
print("  stderr:", r.stderr[:300])
print("  returncode:", r.returncode)
