#!/usr/bin/env python
"""Test if minnimax.chat supports file upload for image/audio in chat completions.

Three probes:
  A) POST /v1/files  with a PNG, check if endpoint exists & returns file_id
  B) chat completions with file_id-style reference
  C) chat completions with image_url="file-xxx" URL reference
"""

import yaml, json, urllib.request, urllib.error, time, base64, zlib, struct, uuid

def load():
    cfg = yaml.safe_load(open(r'D:\Documents\VibeCoding\GodeX\godex.yaml','rb'))
    p = cfg['providers']['minnimax.chat']
    return p['endpoint']['base_url'].rstrip('/'), p['credentials']['api_key']

def make_png(w=64, h=64, rgb=(255, 0, 0)):
    sig = b'\x89PNG\r\n\x1a\n'
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    idat = zlib.compress(raw)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

def make_wav(seconds=1.0, rate=8000):
    import io, wave, math, struct as s
    n = int(seconds * rate)
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        for i in range(n):
            sample = int(16384 * math.sin(2*math.pi*440*i/rate))
            w.writeframesraw(s.pack('<h', sample))
    return buf.getvalue()

# Build a multipart/form-data body manually
def build_multipart(fields, files, boundary=None):
    """fields = [(name, value)], files = [(name, filename, content, content_type)]"""
    if not boundary:
        boundary = '----WebKitFormBoundary' + uuid.uuid4().hex
    lines = []
    for name, val in fields:
        lines.append(f'--{boundary}\r\n'.encode())
        lines.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        lines.append(val.encode() if isinstance(val, str) else val)
        lines.append(b'\r\n')
    for name, filename, content, ctype in files:
        lines.append(f'--{boundary}\r\n'.encode())
        lines.append(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode())
        lines.append(f'Content-Type: {ctype}\r\n\r\n'.encode())
        lines.append(content)
        lines.append(b'\r\n')
    lines.append(f'--{boundary}--\r\n'.encode())
    return b''.join(lines), boundary

def call_post(url, body, headers, timeout=60, raw=False):
    req = urllib.request.Request(url, data=body, headers=headers, method='POST')
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw_b = r.read()
            try:    return {'status': r.status, 'time': time.time()-t0, 'body': json.loads(raw_b)}
            except: return {'status': r.status, 'time': time.time()-t0, 'body': {'raw': raw_b.decode('utf-8','replace')[:500]}}
    except urllib.error.HTTPError as e:
        raw_b = e.read()
        try:    return {'status': e.code, 'time': time.time()-t0, 'body': json.loads(raw_b)}
        except: return {'status': e.code, 'time': time.time()-t0, 'body': {'raw': raw_b.decode('utf-8','replace')[:500]}}
    except Exception as e:
        return {'status': 0, 'time': time.time()-t0, 'body': {'err': str(e)}}

def call_chat(body, base, key, timeout=120):
    req = urllib.request.Request(f'{base}/chat/completions',
        data=json.dumps(body).encode('utf-8'),
        headers={'Authorization': f'Bearer {key}', 'Content-Type':'application/json'},
        method='POST')
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return {'status': r.status, 'time': time.time()-t0, 'body': json.loads(r.read())}
    except urllib.error.HTTPError as e:
        raw_b = e.read()
        try:    return {'status': e.code, 'time': time.time()-t0, 'body': json.loads(raw_b)}
        except: return {'status': e.code, 'time': time.time()-t0, 'body': {'raw': raw_b.decode('utf-8','replace')[:500]}}
    except Exception as e:
        return {'status': 0, 'time': time.time()-t0, 'body': {'err': str(e)}}

def ok(r): return r['status'] in (200, 201) and not r['body'].get('error')

def main():
    base, key = load()
    print(f'Base URL: {base}\n')

    png = make_png(64, 64, (255, 0, 0))
    wav = make_wav(1.0, 8000)

    # ---- A) discover /v1/files ----
    print('=== (A) Probe /v1/files endpoint ===')
    for purpose in ['vision', 'assistants', 'fine-tune', 'any']:
        body, boundary = build_multipart(
            fields=[('purpose', purpose)],
            files=[('file', f'probe_{purpose}.png', png, 'image/png')],
        )
        headers = {
            'Authorization': f'Bearer {key}',
            'Content-Type': f'multipart/form-data; boundary={boundary}',
        }
        r = call_post(f'{base}/v1/files', body, headers)
        sym = 'OK' if ok(r) else 'FAIL'
        print(f'  /v1/files purpose={purpose:12} [{sym}] status={r["status"]} time={r["time"]:.2f}s')
        if ok(r):
            print(f'      body: {json.dumps(r["body"], ensure_ascii=False)[:300]}')
        else:
            print(f'      err: {str(r["body"])[:160]}')
        if sym == 'OK':
            upload_ok = r
            upload_purpose = purpose
            break

    file_id = None
    if ok(r):
        file_id = r['body'].get('id') or r['body'].get('data', {}).get('id') if isinstance(r['body'].get('data'), dict) else r['body'].get('id')
        if not file_id and 'data' in r['body'] and isinstance(r['body'].get('data'), list):
            file_id = r['body']['data'][0].get('id')
        print(f'  → Got file_id: {file_id}')

    if not file_id:
        print('\n  /v1/files not available; trying /files (OpenAI legacy style)...')
        body, boundary = build_multipart(
            fields=[('purpose', 'vision')],
            files=[('file', 'probe.png', png, 'image/png')],
        )
        headers = {
            'Authorization': f'Bearer {key}',
            'Content-Type': f'multipart/form-data; boundary={boundary}',
        }
        r = call_post(f'{base}/files', body, headers)
        sym = 'OK' if ok(r) else 'FAIL'
        print(f'  /files [vision]  [{sym}] status={r["status"]} time={r["time"]:.2f}s')
        if ok(r):
            print(f'      body: {json.dumps(r["body"], ensure_ascii=False)[:400]}')
            file_id = r['body'].get('id') or (r['body'].get('data') or [{}])[0].get('id') if isinstance(r['body'].get('data'), list) else r['body'].get('id')
        else:
            print(f'      err: {str(r["body"])[:200]}')

    if not file_id:
        print('\n  → No file_id obtained; chat completions with file reference cannot be tested.')
        return

    print(f'\n  file_id for downstream tests: {file_id}')

    # ---- B) chat with file_id reference ----
    model = 'MiniMax-M3'  # we know M3 accepts inline image; pick the one most likely to work
    print(f'\n=== (B) chat with file_id reference, model={model} ===')
    for ref in [
        {'type':'image_url','image_url':{'file_id': file_id}},
        {'type':'image_url','image_url': {'url': f'file_id:{file_id}'}},
        {'type':'image_file','file_id': file_id},
        {'type':'image_url','image_url':{'url': file_id}},
    ]:
        body = {'model': model,
                'messages':[{'role':'user','content':[
                    {'type':'text','text':'Describe this image briefly (mention dominant color).'},
                    ref,
                ]}],
                'max_tokens': 4096}
        rr = call_chat(body, base, key)
        msg = ((rr['body'].get('choices') or [{}])[0].get('message')) or {}
        content = msg.get('content')
        text = content if isinstance(content, str) else str(content)[:200]
        sym = 'OK' if ok(rr) else 'FAIL'
        ref_kind = str(ref)[:80]
        print(f'  [{sym}] status={rr["status"]}  ref_kind={ref_kind!r}')
        if ok(rr):
            print(f'      reply: {text[:200]!r}')
        else:
            print(f'      err: {str(rr["body"])[:200]}')

    # ---- C) try non-M3 model with file_id reference too ----
    for model_alt in ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed']:
        print(f'\n=== (C) chat with file_id, model={model_alt} ===')
        body = {'model': model_alt,
                'messages':[{'role':'user','content':[
                    {'type':'text','text':'Describe this image briefly.'},
                    {'type':'image_url','image_url':{'file_id': file_id}},
                ]}],
                'max_tokens': 4096}
        rr = call_chat(body, base, key)
        msg = ((rr['body'].get('choices') or [{}])[0].get('message')) or {}
        content = msg.get('content')
        text = content if isinstance(content, str) else str(content)[:200]
        sym = 'OK' if ok(rr) else 'FAIL'
        print(f'  [{sym}] status={rr["status"]}')
        if ok(rr):
            print(f'      reply: {text[:200]!r}')
        else:
            print(f'      err: {str(rr["body"])[:200]}')

if __name__ == '__main__':
    main()
