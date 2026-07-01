"""Test the REAL minimax API (api.minimaxi.com), not the proxy (minnimax.chat)."""
import yaml, json, urllib.request, urllib.error, time, base64, zlib, struct, io, wave, math
import tiktoken

ENC = tiktoken.get_encoding('cl100k_base')

cfg = yaml.safe_load(open(r'D:\Documents\VibeCoding\GodeX\godex.yaml','rb'))
prov = cfg['providers']['minimax']
base = prov['endpoint']['base_url'].rstrip('/')
key = prov['credentials']['api_key']
print(f'Real MiniMax API: {base}')
print(f'  key     : {key[:6]}...{key[-4:]}')
print(f'  spec    : {prov["spec"]}')
print(f'  timeout : {prov.get("timeout_ms", "default")} ms\n')

def make_png(w=64, h=64, rgb=(255,0,0)):
    sig = b'\x89PNG\r\n\x1a\n'
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    raw = b''.join(b'\x00' + bytes(rgb)*w for _ in range(h))
    idat = zlib.compress(raw)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

def make_wav(seconds=1.0, rate=8000):
    n = int(seconds*rate); buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        for i in range(n):
            s = int(16384*math.sin(2*math.pi*440*i/rate))
            w.writeframesraw(struct.pack('<h', s))
    return buf.getvalue()

def call(body, timeout=120):
    req = urllib.request.Request(f'{base}/chat/completions',
        data=json.dumps(body).encode('utf-8'),
        headers={'Authorization': f'Bearer {key}', 'Content-Type':'application/json'},
        method='POST')
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read())
            return {'status': r.status, 'time': time.time()-t0, 'body': data}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:    return {'status': e.code, 'time': time.time()-t0, 'body': json.loads(raw)}
        except: return {'status': e.code, 'time': time.time()-t0, 'body': {'raw': raw.decode('utf-8','replace')[:400]}}
    except Exception as e:
        return {'status': 0, 'time': time.time()-t0, 'body': {'err': str(e)}}

def ok(r): return r['status'] in (200, 201) and not r['body'].get('error')

def show(label, r, expected_keywords=()):
    sym = 'OK' if ok(r) else 'FAIL'
    msg = ((r['body'].get('choices') or [{}])[0].get('message')) or {}
    u = r['body'].get('usage') or {}
    text = (msg.get('content') or '')
    print(f'  [{sym}] {label:30} status={r["status"]:>3} pt={u.get("prompt_tokens","?"):>4} ct={u.get("completion_tokens","?"):>4} time={r["time"]:.1f}s')
    if ok(r):
        snippet = text[:180].replace(chr(10), ' / ')
        print(f'        reply: {snippet!r}')
        if expected_keywords:
            aware = any(k in text.lower() for k in [k.lower() for k in expected_keywords])
            print(f'        AWARE-of-input? {"YES" if aware else "NO (no expected keyword found)"}')
    else:
        print(f'        err: {str(r["body"])[:200]}')

# 1 smoke
print('=== 1) smoke: M3 text ===')
show('text', call({'model':'MiniMax-M3','messages':[{'role':'user','content':'reply hi in 3 words'}],'max_tokens':16}))

# 2 M3 image_inline
print('\n=== 2) M3 image inline base64 PNG (detail=high) ===')
png = make_png(64,64,(255,0,0))
url = f'data:image/png;base64,{base64.b64encode(png).decode()}'
body = {'model':'MiniMax-M3',
        'messages':[{'role':'user','content':[
            {'type':'text','text':'Describe this image briefly in one sentence; mention dominant color.'},
            {'type':'image_url','image_url':{'url': url, 'detail':'high'}}
        ]}],
        'max_tokens':4096}
show('image-M3', call(body), expected_keywords=('red','color','image','pixel','64','blocks','square','dominant'))

# 3 detail=low
print('\n=== 3) M3 image (detail=low) ===')
body['messages'][0]['content'][1]['image_url']['detail'] = 'low'
show('image-M3-low', call(body), expected_keywords=('red','color','image','pixel','64','blocks','square','dominant'))

# 4 M2.7 image_inline
print('\n=== 4) M2.7 image inline base64 PNG ===')
body['model'] = 'MiniMax-M2.7'
body['messages'][0]['content'][1]['image_url']['detail'] = 'high'
show('image-M2.7', call(body), expected_keywords=('red','color','image','pixel','64','blocks','square','dominant'))

# 5 M3 input_audio
print('\n=== 5) M3 input_audio base64 WAV ===')
wav = make_wav(1.0, 8000)
b64 = base64.b64encode(wav).decode()
body = {'model':'MiniMax-M3',
        'messages':[{'role':'user','content':[
            {'type':'text','text':'What does this audio sound like? Reply briefly.'},
            {'type':'input_audio','input_audio':{'data': b64, 'format':'wav'}}
        ]}],
        'max_tokens':4096}
show('audio-M3', call(body), expected_keywords=('sine','tone','440','beep','sound','wave','audio','hertz','hz','frequency'))

# 6 M2.7 input_audio
print('\n=== 6) M2.7 input_audio base64 WAV ===')
body['model'] = 'MiniMax-M2.7'
show('audio-M2.7', call(body), expected_keywords=('sine','tone','440','beep','sound','wave','audio','hertz','hz','frequency'))

# 7 file upload
print('\n=== 7) /v1/files upload on REAL minimax ===')
def upload(file_bytes, filename, mime, purpose='file'):
    boundary = '----X' + str(time.time_ns())
    body_b = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f'Content-Type: {mime}\r\n\r\n').encode() + file_bytes + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(f'{base}/v1/files',
        data=body_b,
        headers={'Authorization': f'Bearer {key}', 'Content-Type': f'multipart/form-data; boundary={boundary}'},
        method='POST')
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return {'status': r.status, 'time': time.time()-t0, 'body': json.loads(r.read())}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:    return {'status': e.code, 'time': time.time()-t0, 'body': json.loads(raw)}
        except: return {'status': e.code, 'time': time.time()-t0, 'body': {'raw': raw.decode('utf-8','replace')[:300]}}

r = upload(png, 'probe.png', 'image/png')
sym = 'OK' if r['status'] in (200,201) and not (isinstance(r['body'], dict) and r['body'].get('error')) else 'FAIL'
print(f'  POST /v1/files [{sym}] status={r["status"]} time={r["time"]:.2f}s')
bstr = str(r['body'])[:300]
print(f'      body[:300]: {bstr}')
if sym == 'OK' and isinstance(r['body'], dict):
    fid = r['body'].get('id') or (r['body'].get('data') or [{}])[0].get('id') if isinstance(r['body'].get('data'), list) else r['body'].get('id')
    if fid:
        print(f'      file_id: {fid}')
        body2 = {'model':'MiniMax-M3',
                 'messages':[{'role':'user','content':[
                     {'type':'text','text':'Describe briefly; mention dominant color.'},
                     {'type':'image_url','image_url':{'url': fid}}
                 ]}],
                 'max_tokens':4096}
        show('image file_id ref', call(body2), expected_keywords=('red','color','image','64','blocks','square'))
