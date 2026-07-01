import yaml, json, urllib.request, urllib.error
cfg = yaml.safe_load(open(r'D:\Documents\VibeCoding\GodeX\godex.yaml','rb'))
p = cfg['providers']['minnimax.chat']
base = p['endpoint']['base_url'].rstrip('/')
key = p['credentials']['api_key']
print(f'base={base}  key={key[:8]}...{key[-4:]}')

body = {'model':'MiniMax-M2.7',
        'messages':[{'role':'user','content':'reply hi in 3 words'}],
        'max_tokens':16}
req = urllib.request.Request(f'{base}/chat/completions',
    data=json.dumps(body).encode('utf-8'),
    headers={'Authorization': f'Bearer {key}', 'Content-Type':'application/json'},
    method='POST')

try:
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
        msg = (data.get('choices') or [{}])[0].get('message') or {}
        print(f'status={r.status} usage={data.get("usage")} reply={msg.get("content")}')
        print(f'  has tool_calls: {bool(msg.get("tool_calls"))}')
except urllib.error.HTTPError as e:
    err_body = e.read().decode('utf-8', errors='replace')[:400]
    print(f'HTTP {e.code}: {err_body}')
except Exception as e:
    print('ERR', repr(e))
