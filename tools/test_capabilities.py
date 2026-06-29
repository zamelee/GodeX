import requests

API_KEY = "gw-ced053f1-2386-4eb4-b6f4-27f2207844b1"
BASE_URL = "https://minnimax.chat/v1"
models = ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M3"]

def test(model, name, payload):
    url = BASE_URL + "/chat/completions"
    headers = {"Authorization": "Bearer " + API_KEY, "Content-Type": "application/json"}
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=30)
        status = r.status_code
        print("  %s: %s" % (name, status))
        if status != 200:
            try:
                print("    %s" % r.json())
            except:
                print("    %s" % r.text[:150])
        return status == 200
    except Exception as e:
        print("  %s: ERROR %s" % (name, e))
        return False

print("=== Testing MiniMax Models ===")

for model in models:
    print("")
    print("--- %s ---" % model)
    test(model, "Text", {"model": model, "messages": [{"role": "user", "content": "Hi"}], "max_tokens": 10})
    
    tiny = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    test(model, "Image", {"model": model, "messages": [{"role": "user", "content": [{"type": "text", "text": "?"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64," + tiny}}]}], "max_tokens": 20})
    
    tools = [{"type": "function", "function": {"name": "get_weather", "description": "Get weather", "parameters": {"type": "object", "properties": {"loc": {"type": "string"}}}}]
    test(model, "Function", {"model": model, "messages": [{"role": "user", "content": "Beijing weather?"}], "tools": tools, "tool_choice": "auto"})
    
    test(model, "Reasoning", {"model": model, "messages": [{"role": "user", "content": "1+1=?"}], "max_tokens": 50, "reasoning_effort": "low"})
    
    for mt in [16384, 65536, 131072, 196608]:
        test(model, "MaxTokens %d" % mt, {"model": model, "messages": [{"role": "user", "content": "OK"}], "max_tokens": mt})
