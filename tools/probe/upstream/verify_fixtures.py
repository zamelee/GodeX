#!/usr/bin/env python
"""B4: Verify fixtures work as ground-truth against the real minnimax.chat endpoint.
Sends each fixture inline and checks the reply contains expected keywords.
Reports pass/fail for each (model, capability) pair.

Usage:
  python tools/probe/upstream/verify_fixtures.py
"""
import json, urllib.request, urllib.error, time, base64, sys, os

# -------- config --------
KEY  = open(r'D:\Documents\VibeCoding\GodeX\tools\.probe_key.txt', 'r', encoding='utf-8').read().strip()
BASE = 'https://minnimax.chat/v1'
MODELS = ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M3']

# -------- fixtures --------
FIX_DIR = r'D:\Documents\VibeCoding\GodeX\tools\probe\fixtures'
PNG = base64.b64encode(open(os.path.join(FIX_DIR, 'image_test.png'),  'rb').read()).decode()
WAV = base64.b64encode(open(os.path.join(FIX_DIR, 'audio_test.wav'),  'rb').read()).decode()
MP4 = base64.b64encode(open(os.path.join(FIX_DIR, 'video_test.mp4'),  'rb').read()).decode()

# -------- keyword sets per capability --------
# Each cap lists keyword groups. Reply matches if ANY keyword in ANY group
# (case-insensitive substring) is found.
KW = {
    'text':     [['hi', 'hello', 'hey', 'greet', '你好', '嗨']],
    'image':    [['red', '红色', 'saturated', 'crimson', 'scarlet']],
    'audio':    [['audio', 'sound', '声音', 'beep', 'tone', 'sine', 'wave', '440']],
    'video':    [['video', '视频', 'frame', 'play', 'image', 'mp4']],
    'function': [['get_weather', 'weather', 'weather_']],
    'reasoning':[['<think>', 'reasoning', 'think', 'step']],
}

# Tool probes: just check we got 200 and no crash. No keyword assertion.
TOOLS = {
    'web_search':   [{'type': 'web_search'}],
    'file_search':  [{'type': 'file_search'}],
    'computer_use': [{'type': 'computer_use', 'provider': 'windows'}],
    'tool_search':  [{'type': 'tool_search'}],
    'mcp':          [{'type': 'mcp'}],
}

# -------- HTTP --------
def call(body, timeout=30):
    req = urllib.request.Request(
        f'{BASE}/chat/completions',
        data=json.dumps(body).encode('utf-8'),
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'},
        method='POST',
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            text = r.read()
            try:    return {'status': r.status, 'time': time.time()-t0, 'body': json.loads(text)}
            except: return {'status': r.status, 'time': time.time()-t0, 'body': {'_raw': text[:300].decode('utf-8','replace')}}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:    return {'status': e.code, 'time': time.time()-t0, 'body': json.loads(raw)}
        except: return {'status': e.code, 'time': time.time()-t0, 'body': {'_raw': raw[:300].decode('utf-8','replace')}}
    except Exception as e:
        return {'status': 0, 'time': time.time()-t0, 'body': {'_err': str(e)}}

def reply(r):
    msg = ((r['body'].get('choices') or [{}])[0].get('message')) or {}
    c = msg.get('content')
    if isinstance(c, str): return c
    if isinstance(c, list): return ' '.join(p.get('text','') for p in c if isinstance(p,dict))
    return ''

def usage(r):
    return (r['body'].get('usage') or {})

def has_kw(reply_text, kw_groups):
    low = reply_text.lower()
    for grp in kw_groups:
        for kw in grp:
            if kw.lower() in low:
                return True, kw
    return False, None

# -------- per-cap probes --------
def probe_text(model):
    r = call({'model': model, 'messages':[{'role':'user','content':'Say hi in 3 words or fewer.'}], 'max_tokens': 32})
    return r, has_kw(reply(r), KW['text'])

def probe_image(model):
    r = call({
        'model': model,
        'messages':[{'role':'user','content':[
            {'type':'text','text':'Describe this image in one short sentence. What color and any text you see?'},
            {'type':'image_url','image_url':{'url': f'data:image/png;base64,{PNG}'}},
        ]}],
        'max_tokens': 256,
    })
    return r, has_kw(reply(r), KW['image'])

def probe_audio(model):
    # Use GodeX-correct input_audio shape (NOT audio_url which we tested wrong before)
    r = call({
        'model': model,
        'messages':[{'role':'user','content':[
            {'type':'input_audio','input_audio':{'data': WAV, 'format':'wav'}},
            {'type':'text','text':'What does this audio sound like? Reply in one sentence.'},
        ]}],
        'max_tokens': 256,
    })
    return r, has_kw(reply(r), KW['audio'])

def probe_video(model):
    r = call({
        'model': model,
        'messages':[{'role':'user','content':[
            {'type':'video_url','video_url':{'url': f'data:video/mp4;base64,{MP4}'}},
            {'type':'text','text':'Describe this video briefly.'},
        ]}],
        'max_tokens': 256,
    })
    return r, has_kw(reply(r), KW['video'])

def probe_function(model):
    r = call({
        'model': model,
        'messages':[{'role':'user','content':"What's the weather in Tokyo? Use get_weather."}],
        'tools':[{'type':'function','function':{
            'name':'get_weather',
            'description':'Get current weather for a city',
            'parameters':{'type':'object','properties':{'city':{'type':'string'}}, 'required':['city']}
        }}],
        'tool_choice': 'required',
        'max_tokens': 256,
    })
    body = r['body']
    has_tc = bool(((body.get('choices') or [{}])[0].get('message') or {}).get('tool_calls'))
    return r, (has_tc, 'tool_calls' if has_tc else None)

def probe_reasoning(model):
    r = call({
        'model': model,
        'reasoning_effort': 'medium',
        'messages':[{'role':'user','content':'What is 13 * 17? Think step by step.'}],
        'max_tokens': 1024,
    })
    u = usage(r)
    rt = (u.get('completion_tokens_details') or {}).get('reasoning_tokens', 0) or 0
    return r, (rt > 0, f'reasoning_tokens={rt}')

def probe_tool_type(model, tool_type, tool_obj):
    r = call({
        'model': model,
        'messages':[{'role':'user','content':'hi'}],
        'tools':[tool_obj],
        'tool_choice': 'auto',
        'max_tokens': 64,
    })
    return r  # don't keyword-check; 200 = accept, 400 = reject

# -------- runner --------
PROBES = [
    ('text',       probe_text),
    ('image',      probe_image),
    ('audio',      probe_audio),
    ('video',      probe_video),
    ('function',   probe_function),
    ('reasoning',  probe_reasoning),
]

def run_for_model(model):
    print(f'\n=== {model} ===')
    results = {}
    for name, fn in PROBES:
        r, (ok, hit) = fn(model)
        sym = 'OK' if ok else 'FAIL'
        u = usage(r)
        rt = (u.get('completion_tokens_details') or {}).get('reasoning_tokens', '-')
        rep = reply(r)[:80].replace('\n', ' / ')
        print(f'  [{sym:>4}] {name:10}  status={r["status"]:>3}  time={r["time"]:>4.1f}s  reason_tokens={rt}  hit={hit}')
        if not ok and r['status'] == 200:
            print(f'         reply: {rep!r}')
        elif r['status'] != 200:
            err = r['body'].get('error') or r['body'].get('_raw') or r['body'].get('_err')
            if isinstance(err, dict): err = err.get('message', str(err))[:200]
            print(f'         err:   {str(err)[:200]}')
        results[name] = ok
    for name, tdef in TOOLS.items():
        r = probe_tool_type(model, name, tdef[0])
        ok = (r['status'] == 200)
        sym = 'OK' if ok else 'FAIL'
        print(f'  [{sym:>4}] {name:10}  status={r["status"]:>3}  (any 200 = accept)')
        results[name] = ok
    return results

def main():
    all_results = {}
    for m in MODELS:
        all_results[m] = run_for_model(m)
    print('\n=== summary ===')
    caps = [n for n,_ in PROBES] + list(TOOLS.keys())
    print('capabilities   ' + '  '.join(f'{c:>10}' for c in caps))
    for m in MODELS:
        r = all_results[m]
        print(f'{m:14} ' + '  '.join(f'{"YES" if r.get(c) else "no":>10}' for c in caps))
    return 0

if __name__ == '__main__':
    sys.exit(main())