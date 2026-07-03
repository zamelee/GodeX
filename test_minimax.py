@' import sys
import urllib.request
import json

body = {
    'model': 'MiniMax-M2.7',
    'messages': [{'role': 'user', 'content': 'Use the add tool with a=3, b=5.'}],
    'tools': [{'type': 'function', 'name': 'mcp__some_server__add', 'description': 'Add two numbers', 'parameters': {'type': 'object', 'properties': {'a': {'type': 'number'}, 'b': {'type': 'number'}}, 'required': ['a', 'b']}}],
    'tool_choice': 'auto',
    'max_tokens': 500
}

print('=== Request ===')
print(json.dumps(body, indent=2, ensure_ascii=False))

req = urllib.request.Request(
    'https://minnimax.chat/v1/chat/completions',
    data=json.dumps(body).encode('utf-8'),
    headers={'Content-Type': 'application/json', 'Authorization': 'Bearer gw-ced053f1-2386-4eb4-b6f4-27f2207844b1'}
)

try:
    with urllib.request.urlopen(req, timeout=30) as response:
        result = json.loads(response.read().decode('utf-8'))
        print('=== Response ===')
        print(json.dumps(result, indent=2, ensure_ascii=False)[:3000])
except Exception as e:
    print(f'Error: {e}')
'@
