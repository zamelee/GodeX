import json, os, sys, urllib.request, urllib.error, base64
API_KEY = os.environ.get("MINIMAX_API_KEY")
b64 = open("probes/test-b64.txt", encoding="utf-8").read().strip()

# Verify the PNG is valid
try:
    raw = base64.b64decode(b64)
    print(f"PNG bytes decoded: {len(raw)}, header: {raw[:8]!r}")
except Exception as e:
    print(f"B64 decode failed: {e}"); sys.exit(1)

BASE = "https://minnimax.chat/v1/messages"
MODELS = ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"]

def call(model, content):
    body = {"model": model, "max_tokens": 200, "messages": [{"role": "user", "content": content}]}
    headers = {"x-api-key": API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json"}
    req = urllib.request.Request(BASE, data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")

print()
results = []
for model in MODELS:
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
        {"type": "text", "text": "这张图里写了什么文字?背景是什么颜色?"}
    ]
    status, body = call(model, content)
    obj = json.loads(body)
    print(f"=== {model} ===")
    print(f"  status: {status}")
    print(f"  content types: {[c.get('type') for c in obj.get('content', [])]}")
    text_blocks = [c for c in obj.get('content', []) if c.get('type') == 'text']
    thinking_blocks = [c for c in obj.get('content', []) if c.get('type') == 'thinking']
    for t in text_blocks:
        print(f"  TEXT: {t.get('text','')}")
    for t in thinking_blocks:
        print(f"  THINKING: {t.get('thinking','')[:200]}")
    if obj.get("error"):
        print(f"  ERROR: {obj['error']}")
    results.append({"model": model, "status": status, "text": " ".join(c.get("text","") for c in text_blocks), "raw": obj})

Path = "probes"
import json as J
J.dump(results, open("probes/image-recheck.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
