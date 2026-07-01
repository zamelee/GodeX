#!/usr/bin/env python
"""Rerun focused caps probe: image / audio / video / function_call / reasoning_effort
   for the 3 enabled MiniMax models — all using inline base64 (no external URL
   dependency) and max_tokens=4096 so thinking has room to finish and we can see
   the actual content/tool_calls.
"""

import yaml, json, urllib.request, urllib.error, time, base64, zlib, struct, io, wave, math

# -------- helpers --------
def load_provider():
    cfg = yaml.safe_load(open(r'D:\Documents\VibeCoding\GodeX\godex.yaml','rb'))
    p = cfg['providers']['minnimax.chat']
    return p['endpoint']['base_url'].rstrip('/'), p['credentials']['api_key']

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
        raw = e.read()
        try:    return {'status': e.code, 'time': time.time()-t0, 'body': json.loads(raw)}
        except: return {'status': e.code, 'time': time.time()-t0, 'body': {'raw': raw.decode('utf-8','replace')[:300]}}
    except Exception as e:
        return {'status': 0, 'time': time.time()-t0, 'body': {'err': str(e)}}

def ok(r): return r['status'] in (200, 201) and not r['body'].get('error')

# -------- inline media factory (no external deps) --------

def make_png(w, h, rgb=(255, 0, 0)):
    sig = b'\x89PNG\r\n\x1a\n'
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    idat = zlib.compress(raw)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

def make_wav(seconds=1.0, rate=8000):
    """Synthesize a simple 440Hz sine WAV (in-memory)."""
    n = int(seconds * rate)
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        for i in range(n):
            sample = int(16384 * math.sin(2*math.pi*440*i/rate))
            w.writeframesraw(struct.pack('<h', sample))
    return buf.getvalue()

# Tiny valid MP4 — minimal 0-byte stub; minimax may reject anyway.
def make_minimal_mp4_bytes():
    # Box: ftyp (file type) only — minimal ISO BMFF
    ftyp = (b'\x00\x00\x00\x14ftypisom'                  # size 20, type ftyp, brand isom
            b'\x00\x00\x00\x00')                          # minor ver + compat
    return ftyp

def to_data_url(mime, data):
    return f'data:{mime};base64,{base64.b64encode(data).decode()}'

# -------- cap probes --------

def probe_text(model, base, key, mt=4096):
    body = {'model': model,
            'messages':[{'role':'user','content':'Reply with one short sentence about the weather.'}],
            'max_tokens': mt}
    return call_chat(body, base, key)

def probe_image_inline(model, base, key, data_url, mt=4096):
    body = {'model': model,
            'messages':[{'role':'user','content':[
                {'type':'text','text':'Describe this image briefly (1-2 sentences, mention dominant color).'},
                {'type':'image_url','image_url':{'url': data_url}},
            ]}],
            'max_tokens': mt}
    return call_chat(body, base, key)

def probe_audio_inline(model, base, key, data_url, mt=4096):
    body = {'model': model,
            'messages':[{'role':'user','content':[
                {'type':'text','text':'What does this audio sound like? Reply briefly.'},
                {'type':'audio_url','audio_url':{'url': data_url}},
            ]}],
            'max_tokens': mt}
    return call_chat(body, base, key)

def probe_video_inline(model, base, key, data_url, mt=4096):
    body = {'model': model,
            'messages':[{'role':'user','content':[
                {'type':'text','text':'Describe what happens in this video briefly.'},
                {'type':'video_url','video_url':{'url': data_url}},
            ]}],
            'max_tokens': mt}
    return call_chat(body, base, key)

def probe_function_call(model, base, key, tool_choice='required', mt=4096):
    body = {'model': model,
            'messages':[{'role':'user','content':(
                "What's the weather in Tokyo right now? Use the get_weather function."
            )}],
            'tools':[{
                'type':'function',
                'function':{
                    'name':'get_weather',
                    'description':'Get the current weather for a city',
                    'parameters':{
                        'type':'object',
                        'properties':{'city':{'type':'string'}},
                        'required':['city']
                    }
                }
            }],
            'tool_choice': tool_choice,
            'max_tokens': mt}
    return call_chat(body, base, key)

def probe_reasoning(model, base, key, effort, mt=4096):
    body = {'model': model,
            'reasoning_effort': effort,
            'messages':[{'role':'user','content':'What is 13 * 17? Think step-by-step, then state the answer clearly.'}],
            'max_tokens': mt}
    return call_chat(body, base, key)

# -------- display helpers --------

def extract_reply(r):
    msg = ((r['body'].get('choices') or [{}])[0].get('message')) or {}
    content = msg.get('content')
    if isinstance(content, str): return content
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, dict) and p.get('type') == 'text':
                parts.append(p.get('text',''))
        return ''.join(parts)
    return ''

def short_report(label, r):
    msg = ((r['body'].get('choices') or [{}])[0].get('message')) or {}
    u = (r['body'].get('usage') or {})
    ctd = (u.get('completion_tokens_details') or {})
    has_tc = bool(msg.get('tool_calls'))
    reply = extract_reply(r)
    ok_flag = ok(r)
    sym = 'OK' if ok_flag else 'FAIL'
    parts = [f'[{sym:>4}] status={r["status"]:>3}  pt={u.get("prompt_tokens","-"):>4}  ct={u.get("completion_tokens","-"):>4}  '
             f'reason={ctd.get("reasoning_tokens","-")}  finish={(r["body"].get("choices") or [{}])[0].get("finish_reason","-")}  '
             f'tc={"yes" if has_tc else " no"}  time={r["time"]:.1f}s']
    print(f'  {label:22}  ', ''.join(parts))
    if not ok_flag:
        print(f'      err: {str(r["body"])[:200]}')
    else:
        snippet = reply[:160].replace(chr(10),' / ')
        if has_tc:
            for tc in msg['tool_calls']:
                fn = tc.get('function') or {}
                print(f'      tool_call: name={fn.get("name")} args={fn.get("arguments")[:120]}')
        if snippet:
            print(f'      reply: {snippet!r}')
        if 'think' in reply.lower() or 'thinking' in reply.lower():
            # show whether  is present
            print(f'      has_think_block={"yes" if "think" in reply and ("<think" in reply or "thinking" in reply.lower()) else "no"}')

# -------- main --------

def main():
    base, key = load_provider()

    png_64 = make_png(64, 64, (255, 0, 0))
    wav_1s = make_wav(1.0, 8000)
    mp4_min = make_minimal_mp4_bytes()

    png_url    = to_data_url('image/png', png_64)
    wav_url    = to_data_url('audio/wav', wav_1s)
    video_url  = to_data_url('video/mp4', mp4_min)

    print(f'Base URL : {base}')
    print(f'PNG data URL  : {len(png_url)} chars ({len(png_64)} bytes)')
    print(f'WAV data URL  : {len(wav_url)} chars ({len(wav_1s)} bytes)')
    print(f'MP4 data URL  : {len(video_url)} chars ({len(mp4_min)} bytes)\n')

    models = ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M3']
    out = {}
    for m in models:
        print(f'\n{"="*72}\n  {m}\n{"="*72}')
        out[m] = {}

        print(f'\n  -- text --')
        r = probe_text(m, base, key, 4096);         short_report('text', r); out[m]['text'] = summary(r)

        print(f'\n  -- image (inline base64 PNG) --')
        r = probe_image_inline(m, base, key, png_url, 4096)
        short_report('image_inline', r);            out[m]['image_inline'] = summary(r)

        print(f'\n  -- audio (inline base64 WAV) --')
        r = probe_audio_inline(m, base, key, wav_url, 4096)
        short_report('audio_inline', r);            out[m]['audio_inline'] = summary(r)

        print(f'\n  -- video (inline base64 stub MP4) --')
        r = probe_video_inline(m, base, key, video_url, 4096)
        short_report('video_inline', r);            out[m]['video_inline'] = summary(r)

        print(f'\n  -- function_call (required) --')
        r = probe_function_call(m, base, key, 'required', 4096)
        short_report('function_call_req', r);       out[m]['function_call_required'] = summary(r)

        print(f'\n  -- function_call (auto) --')
        r = probe_function_call(m, base, key, 'auto', 4096)
        short_report('function_call_auto', r);      out[m]['function_call_auto'] = summary(r)

        print(f'\n  -- reasoning_effort=medium --')
        r = probe_reasoning(m, base, key, 'medium', 4096)
        short_report('reasoning_medium', r);        out[m]['reasoning_medium'] = summary(r)

        print(f'\n  -- reasoning_effort=none  (try to disable thinking) --')
        r = probe_reasoning(m, base, key, 'none', 4096)
        short_report('reasoning_none', r);          out[m]['reasoning_none'] = summary(r)

    # Final summary
    print(f'\n\n{"="*72}\n  CAPS RERUN SUMMARY\n{"="*72}')
    cap_keys = ['text', 'image_inline', 'audio_inline', 'video_inline',
                'function_call_required', 'function_call_auto',
                'reasoning_medium', 'reasoning_none']
    header = f'  {"cap":22} ' + ' '.join(f'{m.replace("MiniMax-","M"):>22}' for m in models)
    print(header)
    for ck in cap_keys:
        row = [f'  {ck:22}']
        for m in models:
            d = out[m].get(ck, {})
            sym = '✓' if d.get('ok') else '✗'
            extras = []
            if d.get('has_tool_calls'): extras.append('TC')
            if d.get('reasoning_tokens') and d['reasoning_tokens'] != 0: extras.append(f'rt={d["reasoning_tokens"]}')
            if d.get('has_think'): extras.append('think')
            row.append(f'{("OK" if d.get("ok") else "FAIL")+"("+sym+")":>22} {" ".join(extras)}')
        print(' '.join(row))

    OUT = r'D:\Documents\VibeCoding\GodeX\tools\probe-minnimax-caps.json'
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2, default=str)
    print(f'\nJSON: {OUT}')

def summary(r):
    msg = ((r['body'].get('choices') or [{}])[0].get('message')) or {}
    u = (r['body'].get('usage') or {})
    ctd = (u.get('completion_tokens_details') or {})
    reply = extract_reply(r)
    return {
        'ok': ok(r),
        'status': r['status'],
        'time': round(r['time'], 2),
        'usage': dict(u),
        'has_tool_calls': bool(msg.get('tool_calls')),
        'tool_calls': msg.get('tool_calls'),
        'reasoning_tokens': ctd.get('reasoning_tokens'),
        'finish_reason': (r['body'].get('choices') or [{}])[0].get('finish_reason'),
        'reply': reply,
        'has_think': ('think' in reply and '<' in reply and '>' in reply) or ('<think' in reply.lower()),
        'err': None if ok(r) else str(r['body'])[:300],
    }

if __name__ == '__main__':
    main()
