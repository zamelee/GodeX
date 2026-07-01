import urllib.request, urllib.error
paths = [
    '/v1/files/upload', '/v1/upload', '/v1/files/vision',
    '/upload', '/api/upload', '/api/v1/files',
    '/v1/audio/transcriptions', '/v1/audio/translations', '/v1/audio/speech',
    '/v1/images/generations', '/v1/images/edits',
    '/api/chat', '/files/upload',
    '/v1/assistants/files', '/v1/batches',
]
import json, yaml
cfg = yaml.safe_load(open(r'D:\Documents\VibeCoding/GodeX/godex.yaml','rb'))
key = cfg['providers']['minnimax.chat']['credentials']['api_key']

for p in paths:
    url = f'https://minnimax.chat{p}'
    req = urllib.request.Request(url, method='GET',
        headers={'Authorization': f'Bearer {key}'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = r.read()
            kind = 'html' if data.lstrip().startswith(b'<!') else ('json' if data.lstrip().startswith(b'{') else 'binary')
            print(f'  GET {p:40}  {r.status}  {kind:5}  len={len(data)}')
    except urllib.error.HTTPError as e:
        print(f'  GET {p:40}  {e.code}  len={len(e.read())}')
    except Exception as e:
        print(f'  GET {p:40}  ERR {type(e).__name__}: {e}')
