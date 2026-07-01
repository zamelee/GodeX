import base64, json, urllib.request, urllib.error
KEY = open(r"D:\Documents\VibeCoding\GodeX\tools\.probe_key.txt").read().strip()
MP4 = base64.b64encode(open(r"D:\Documents\VibeCoding\GodeX\tools\probe\fixtures\video_test.mp4", "rb").read()).decode()
body = {
    "model": "MiniMax-M3",
    "messages": [{"role": "user", "content": [
        {"type": "video_url", "video_url": {"url": "data:video/mp4;base64," + MP4}},
        {"type": "text", "text": "Describe this video briefly."},
    ]}],
    "max_tokens": 256,
}
req = urllib.request.Request(
    "https://minnimax.chat/v1/chat/completions",
    data=json.dumps(body).encode(),
    headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        print("status:", r.status)
        print("body:", r.read().decode()[:2000])
except urllib.error.HTTPError as e:
    print("status:", e.code)
    print("body:", e.read().decode()[:2000])
