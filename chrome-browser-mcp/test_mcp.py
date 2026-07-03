import urllib.request, urllib.error, json
h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
session_id = None
def do_post(method, params, rid=1):
    req_body = {"jsonrpc":"2.0","method":method,"params":params}
    if not method.startswith("notifications/"): req_body["id"] = rid
    data = json.dumps(req_body).encode()
    headers = dict(h)
    if session_id: headers["Mcp-Session-Id"] = session_id
    req = urllib.request.Request("http://localhost:9224/mcp", data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            rh = dict(r.headers)
            for k in rh:
                print("HDR:", k, rh[k][:40])
                if "session" in k.lower(): globals()["session_id"] = rh[k]
            body = r.read().decode()
            for line in body.split("\n"):
                if line.startswith("data: "):
                    d = json.loads(line[6:])
                    if "result" in d: return d["result"]
                    if "error" in d: return {"error": d["error"]}
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        print("HTTP Error", e.code, ":", body[:300])
    return None
r = do_post("initialize", {"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}})
print("Init:", (json.dumps(r)[:200] if r else "None"))
print("Session:", session_id)
do_post("notifications/initialized", {})
r = do_post("tools/list", {})
if r and "error" in r: print("Error:", r["error"])
else:
    tools = (r or {}).get("tools", [])
    print("Tools:", len(tools))
    for t in tools: print(" -", t["name"])
