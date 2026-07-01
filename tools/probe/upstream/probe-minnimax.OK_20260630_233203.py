#!/usr/bin/env python
"""Direct probe of minnimax.chat 3 enabled models — no GodeX in the loop.

Per-model:
  1. context_window  — exponential + bisect on input tokens
  2. max_tokens      — exponential on max_tokens request param
  3. text / image / audio / function_call / reasoning  — single-shot each

Outputs a final table + JSON dump next to this script.
Run:  python tools/probe-minnimax.py
"""

import json, os, sys, time, urllib.request, urllib.error

import yaml
import tiktoken

ROOT       = r'D:\Documents\VibeCoding\GodeX'
GODEX_YAML = os.path.join(ROOT, 'godex.yaml')
PROVIDER   = 'minnimax.chat'
ENC        = tiktoken.get_encoding('cl100k_base')

# ---------- helpers ----------

def load_provider():
    with open(GODEX_YAML, 'rb') as f:
        cfg = yaml.safe_load(f)
    p = cfg['providers'][PROVIDER]
    return {
        'base_url': p['endpoint']['base_url'].rstrip('/'),
        'api_key':  p['credentials']['api_key'],
        'models':   [m for m in cfg['models']['enabled'] if m['provider'] == PROVIDER],
    }

def call_chat(body, base_url, api_key, timeout=60):
    req = urllib.request.Request(
        f'{base_url}/chat/completions',
        data=json.dumps(body).encode('utf-8'),
        headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
        method='POST',
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return {'status': r.status, 'time': time.time()-t0,
                    'body': json.loads(r.read())}
    except urllib.error.HTTPError as e:
        try:    raw = json.loads(e.read())
        except Exception: raw = {'raw': '<unreadable>'}
        return {'status': e.code, 'time': time.time()-t0, 'body': raw}
    except Exception as e:
        return {'status': 0, 'time': time.time()-t0, 'body': {'err': str(e)}}

def make_text_tokens(target_tokens):
    """Build a text block whose cl100k_base token count is ~target_tokens."""
    chunk = "一二三四五六七八九十" * 100 + "。"     # 1010 chars, ~360 tokens
    tokens_per_chunk = len(ENC.encode(chunk))
    n = max(1, int(target_tokens / tokens_per_chunk))
    return chunk * n

def ok_status(r):
    return r['status'] in (200, 201) and not r['body'].get('error')

def get_usage(r):
    return (r['body'].get('usage') or {})

def short_err(r):
    b = r['body']
    e = b.get('error') if isinstance(b, dict) else None
    if e: msg = e.get('message') if isinstance(e, dict) else str(e)
    else: msg = str(b)[:200]
    return msg

# ---------- context window probe ----------

def probe_ctx(model, base_url, api_key, claim_ctx):
    print(f"\n== context_window for {model} (claim={claim_ctx:,}) ==")
    ok = None
    history = []
    # Phase 1: exponential search starting from claim
    for step in [claim_ctx, claim_ctx*2, claim_ctx*4, claim_ctx*8]:
        text = make_text_tokens(step)
        body = {'model': model, 'messages':[{'role':'user','content':text}], 'max_tokens': 4}
        r = call_chat(body, base_url, api_key, timeout=120)
        u = get_usage(r)
        ok_this = ok_status(r)
        history.append({'try': step, 'status': r['status'], 'time': round(r['time'],2),
                        'actual_tokens': u.get('prompt_tokens'),
                        'ok': ok_this, 'err': None if ok_this else short_err(r)})
        sym = '✓' if ok_this else '✗'
        print(f'  [{sym}] try={step:>12,}  status={r["status"]}  '
              f'prompt_tokens={u.get("prompt_tokens", "n/a"):>10}  '
              f'time={r["time"]:.1f}s')
        if not ok_this:
            low, high = step // 2, step
            break
        ok = step
    else:
        # All 4 sizes passed; upper bound unknown, return last ok
        print(f'  (all exponential OK through {claim_ctx*8:,})')
        return ok, history

    # Phase 2: bisect between low (last ok or step/2) and high (first fail)
    attempts = 0
    while high - low > max(2048, claim_ctx // 100):
        mid = (low + high) // 2
        text = make_text_tokens(mid)
        body = {'model': model, 'messages':[{'role':'user','content':text}], 'max_tokens': 4}
        r = call_chat(body, base_url, api_key, timeout=120)
        u = get_usage(r)
        ok_this = ok_status(r)
        history.append({'try': mid, 'status': r['status'], 'time': round(r['time'],2),
                        'actual_tokens': u.get('prompt_tokens'),
                        'ok': ok_this, 'err': None if ok_this else short_err(r)})
        sym = '✓' if ok_this else '✗'
        print(f'  [{sym}] bisect try={mid:>12,}  status={r["status"]}  '
              f'prompt_tokens={u.get("prompt_tokens", "n/a"):>10}  '
              f'time={r["time"]:.1f}s')
        if ok_this: low = mid
        else:       high = mid
        attempts += 1
        if attempts > 12: break  # safety
    print(f'  => MAX context_window ~ {low:,}')
    return low, history

# ---------- max_tokens probe ----------

def probe_max_tokens(model, base_url, api_key, claim_mt):
    print(f"\n== max_tokens for {model} (claim={claim_mt:,}) ==")
    candidates = [4096, 8192, 16384, 32768, 65536, 131072, 196608, 262144, 393216, 524288]
    max_ok = None
    history = []
    for v in candidates:
        if v < claim_mt // 4: continue   # skip values already below claim
        body = {'model': model,
                'messages':[{'role':'user','content':'Reply with one short sentence.'}],
                'max_tokens': v}
        r = call_chat(body, base_url, api_key, timeout=60)
        u = get_usage(r)
        c = (r['body'].get('choices') or [{}])[0]
        ok_this = ok_status(r) and u.get('completion_tokens', 0) > 0
        history.append({'try': v, 'status': r['status'], 'time': round(r['time'],2),
                        'completion_tokens': u.get('completion_tokens'),
                        'finish_reason': c.get('finish_reason'),
                        'ok': ok_this, 'err': None if ok_this else short_err(r)})
        sym = '✓' if ok_this else '✗'
        print(f'  [{sym}] max_tokens={v:>7,}  status={r["status"]}  '
              f'completion={u.get("completion_tokens", "n/a"):>5}  '
              f'reason={c.get("finish_reason","-"):>10}  time={r["time"]:.1f}s')
        if ok_this: max_ok = v
        else: break
    print(f'  => MAX max_tokens ~ {max_ok:,}')
    return max_ok, history

# ---------- capability single-shot probes ----------

def probe_capability(model, base_url, api_key, cap_name, extra_body):
    body = {'model': model,
            'messages':[{'role':'user','content':'Reply with one short sentence.'}],
            'max_tokens': 64}
    body.update(extra_body)
    r = call_chat(body, base_url, api_key, timeout=60)
    u = get_usage(r)
    msg = ((r['body'].get('choices') or [{}])[0].get('message') or {})
    ok = ok_status(r)
    out = {'cap': cap_name, 'status': r['status'], 'ok': ok,
           'usage': dict(u),
           'has_tool_calls': bool(msg.get('tool_calls')),
           'reasoning_tokens': u.get('reasoning_tokens'),
           'finish_reason': ((r['body'].get('choices') or [{}])[0].get('finish_reason')),
           'snippet': (msg.get('content') or '')[:120] if isinstance(msg.get('content'), str) else None}
    if not ok: out['err'] = short_err(r)
    sym = '✓' if ok else '✗'
    extras = []
    if out['has_tool_calls']: extras.append('tool_calls=yes')
    if out['reasoning_tokens']: extras.append(f'reasoning_tokens={out["reasoning_tokens"]}')
    if out['snippet']: extras.append(f'reply="{out["snippet"][:60]}..."')
    print(f'  [{sym}] {cap_name:14}  status={r["status"]:>3}  '
          + '   '.join(extras) + (f'   err={out.get("err","")[:80]}' if not ok else ''))
    return out

# ---------- main ----------

def main():
    cfg = load_provider()
    print(f'Base URL: {cfg["base_url"]}')
    print(f'API key : {cfg["api_key"][:6]}...{cfg["api_key"][-4:]}')
    print(f'Models  : {[m["model"] for m in cfg["models"]]}\n')

    results = {}
    for m in cfg['models']:
        model = m['model']
        print(f'\n{"="*66}\n  {model}\n{"="*66}')
        res = {'claim': {'context_window': m.get('context_window'),
                         'max_tokens': m.get('max_tokens')}}
        try:
            ctx, hist = probe_ctx(model, cfg['base_url'], cfg['api_key'], m.get('context_window', 204800))
            res['context_window'] = ctx
            res['ctx_history'] = hist
        except Exception as e:
            res['context_window'] = f'ERR: {e}'
            res['ctx_history'] = []
        try:
            mt, hist = probe_max_tokens(model, cfg['base_url'], cfg['api_key'], m.get('max_tokens', 8192))
            res['max_tokens'] = mt
            res['mt_history'] = hist
        except Exception as e:
            res['max_tokens'] = f'ERR: {e}'
            res['mt_history'] = []
        print(f'\n  -- capability single-shot --')
        caps = {}
        caps['text'] = probe_capability(model, cfg['base_url'], cfg['api_key'], 'text', {})
        caps['image'] = probe_capability(model, cfg['base_url'], cfg['api_key'], 'image', {
            'messages':[{'role':'user','content':[
                {'type':'text','text':'What letter is in this 64x64 placeholder? Reply with just that letter.'},
                {'type':'image_url','image_url':{'url':'https://placehold.co/64x64.png/000000/FFFFFF/png?text=B'}},
            ]}],
        })
        caps['audio'] = probe_capability(model, cfg['base_url'], cfg['api_key'], 'audio', {
            'messages':[{'role':'user','content':[
                {'type':'text','text':'What does this audio say? Reply briefly or say "not supported".'},
                {'type':'audio_url','audio_url':{'url':'https://example.com/sample.mp3'}},
            ]}],
        })
        caps['function_call'] = probe_capability(model, cfg['base_url'], cfg['api_key'], 'function_call', {
            'tools':[{
                'type':'function',
                'function':{
                    'name':'get_weather',
                    'description':'Get the current weather for a city',
                    'parameters':{'type':'object',
                                  'properties':{'city':{'type':'string'}},
                                  'required':['city']}
                }
            }],
            'tool_choice':'required',
        })
        caps['reasoning'] = probe_capability(model, cfg['base_url'], cfg['api_key'], 'reasoning', {
            'reasoning_effort':'medium',
            'messages':[{'role':'user','content':'What is 13 * 17? Think step by step, then answer.'}],
        })
        res['caps'] = caps
        results[model] = res

    # Summary
    print(f'\n\n{"="*66}\n  SUMMARY\n{"="*66}')
    for model, r in results.items():
        print(f'\n  {model}')
        cw = r.get('context_window')
        mt = r.get('max_tokens')
        print(f'    context_window: {cw if isinstance(cw,str) else f"{cw:,}"}'
              f'   (claim {r["claim"]["context_window"]:,})')
        print(f'    max_tokens:     {mt if isinstance(mt,str) else f"{mt:,}"}'
              f'   (claim {r["claim"]["max_tokens"]:,})')
        for cap, v in r.get('caps', {}).items():
            mark = '✓' if v.get('ok') else '✗'
            extra = []
            if v.get('has_tool_calls'): extra.append('tool_calls=YES')
            if v.get('reasoning_tokens'): extra.append(f'reasoning_tokens={v["reasoning_tokens"]}')
            if v.get('snippet'): extra.append(f'reply={v["snippet"][:50]}')
            err = f'  err={v.get("err","")[:80]}' if not v.get('ok') else ''
            print(f'    [{mark}] {cap:14}  {v["status"]:>3}{"  " + " ".join(extra) if extra else ""}{err}')

    OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'probe-minnimax-result.json')
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=str)
    print(f'\nJSON: {OUT}')

if __name__ == '__main__':
    main()
