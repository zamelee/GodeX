import json, os, sys, urllib.request, urllib.error, time

API_KEY = os.environ.get("MINIMAX_API_KEY")
BASE = "https://minnimax.chat/v1/messages"
MODEL = "MiniMax-M3"

def call(messages, tools, max_tokens=2048):
    body = {"model": MODEL, "max_tokens": max_tokens, "messages": messages, "tools": tools}
    headers = {"x-api-key": API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json"}
    req = urllib.request.Request(BASE, data=json.dumps(body).encode(), headers=headers, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, resp.read().decode("utf-8"), int((time.time()-t0)*1000), None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8"), int((time.time()-t0)*1000), str(e)

def make_tool(name, desc):
    return {"name": name, "description": desc, "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}

CITIES = ["北京", "上海", "深圳", "广州", "杭州", "成都", "南京", "武汉", "西安", "重庆"]
out = []
for n in (6, 8, 10):
    tools = [make_tool(f"get_weather_{i+1}", f"Get weather for a city. Each tool handles one specific city.") for i in range(n)]
    cities_subset = CITIES[:n]
    user_msg = "请同时查询以下" + str(n) + "个城市的天气: " + ", ".join(cities_subset) + "。一次性调用所有" + str(n) + "个工具,每个工具负责一个城市。"
    status, body, ms, err = call([{"role": "user", "content": user_msg}], tools)
    obj = json.loads(body) if not err else {"error": err}
    tool_uses = [c for c in obj.get("content", []) if c.get("type") == "tool_use"]
    names = [c.get("name") for c in tool_uses]
    unique = len(set(names))
    stop_reason = obj.get("stop_reason")
    usage = obj.get("usage", {})
    line = f"n={n} status={status} stop={stop_reason} tool_uses={len(tool_uses)} unique={unique} tps_in={usage.get('input_tokens')} tps_out={usage.get('output_tokens')} elapsed={ms}ms"
    print(line)
    if err: print(f"  err: {err}")
    out.append({"n": n, "status": status, "stop_reason": stop_reason, "tool_uses": len(tool_uses), "unique_names": unique, "names": names, "elapsed_ms": ms, "usage": usage, "raw_error": obj.get("error")})
    import json as J
    J.dump(out, open("probes/parallel-result.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
