import yaml, json, urllib.request, urllib.error, time

cfg = yaml.safe_load(open(r'D:\Documents\VibeCoding\GodeX\godex.yaml','rb'))
p = cfg['providers']['minnimax.chat']
base = p['endpoint']['base_url'].rstrip('/')
key  = p['credentials']['api_key']

models = ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M3']
body_tmpl = lambda: {'messages':[{'role':'user','content':'Reply with one word: hi'}], 'max_tokens':16}

for m in models:
    body = dict(body_tmpl())
    body['model'] = m
    t0 = time.time()
    req = urllib.request.Request(f'{base}/chat/completions',
        data=json.dumps(body).encode('utf-8'),
        headers={'Authorization': f'Bearer {key}', 'Content-Type':'application/json'},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
            u = data.get('usage') or {}
            ct = u.get('completion_tokens_details') or {}
            msg = ((data.get('choices') or [{}])[0].get('message')) or {}
            print(f'{m:30} status={r.status} time={time.time()-t0:.2f}s  '
                  f'pt={u.get("prompt_tokens",0):>4}  ct={u.get("completion_tokens",0):>3}  '
                  f'reason={ct.get("reasoning_tokens","-")}  '
                  f'reply={repr(msg.get("content"))[:60]}')
    except urllib.error.HTTPError as e:
        print(f'{m:30} HTTP {e.code}: {e.read().decode("utf-8",errors="replace")[:200]}')
    except Exception as e:
        print(f'{m:30} ERR {repr(e)}')
