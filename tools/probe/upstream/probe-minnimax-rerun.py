#!/usr/bin/env python
"""Rerun deeper:
   2) image + function_call with bigger max_tokens (so thinking can finish)
      + use INLINE base64 PNG (always reachable, no external URL dependency).
   3) Tight bisect for context_window: start from a known-OK baseline,
      double up until FAIL, then bisect until step <= 5000 tokens.
"""

import yaml, json, urllib.request, urllib.error, time, base64, zlib, struct

# --------- tools ---------

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

# Generate a 64x64 solid-red PNG as bytes (no external dependency)
def make_png(w, h, rgb=(255, 0, 0)):
    sig = b'\x89PNG\r\n\x1a\n'
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    idat = zlib.compress(raw)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

# Generate a text block with EXACTLY target_tokens under cl100k_base
import tiktoken
ENC = tiktoken.get_encoding('cl100k_base')
def make_text_tokens(target_tokens):
    chunk = '一二三四五六七八九十' * 100 + '。'    # ~360 tokens
    chunk_tok = len(ENC.encode(chunk))
    n = max(1, int(round(target_tokens / chunk_tok)))
    return chunk * n

# --------- probe: tight bisect context_window ---------

def probe_ctx_tight(model, base, key, hint_low=None, hint_high=None):
    """Return approx max accepted context_window tokens.

    Strategy:
      - Start probe at hint_low (must be known-OK).
      - Double up until FAIL.
      - Then bisect between last_ok and first_fail, with step < 5000 tokens.
    """
    history = []

    def test(n):
        body = {'model': model,
                'messages':[{'role':'user','content': make_text_tokens(n)}],
                'max_tokens': 4}
        r = call_chat(body, base, key, timeout=120)
        ok = r['status'] in (200, 201) and not r['body'].get('error')
        actual = (r['body'].get('usage') or {}).get('prompt_tokens')
        history.append({'try': n, 'status': r['status'], 'time': round(r['time'],2),
                        'actual_tokens': actual, 'ok': ok,
                        'err': None if ok else str(r['body'])[:150]})
        return ok, r

    # 1) Decide start point
    starts = []
    if hint_low is not None: starts.append(hint_low)
    starts.extend([65536, 131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608])
    starts = sorted(set(starts))

    last_ok_val = 0
    first_fail_val = None

    for s in starts:
        ok, r = test(s)
        sym = '✓' if ok else '✗'
        actual = (r['body'].get('usage') or {}).get('prompt_tokens')
        print(f'  [{sym}] try={s:>12,}  status={r["status"]}  '
              f'prompt_tokens={actual!s:>10}  time={r["time"]:.1f}s')
        if ok:
            last_ok_val = s
        else:
            first_fail_val = s
            break

    if first_fail_val is None:
        # All probes passed, return last_ok
        print(f'  (all probed passed, low-high upper bound unknown)')
        return last_ok_val, history

    # 2) Bisect between last_ok_val and first_fail_val
    attempts = 0
    while first_fail_val - last_ok_val > 5000 and attempts < 18:
        mid = (last_ok_val + first_fail_val) // 2
        ok, r = test(mid)
        sym = '✓' if ok else '✗'
        actual = (r['body'].get('usage') or {}).get('prompt_tokens')
        print(f'  [{sym}] bisect try={mid:>12,}  status={r["status"]}  '
              f'prompt_tokens={actual!s:>10}  time={r["time"]:.1f}s')
        if ok: last_ok_val = mid
        else:  first_fail_val = mid
        attempts += 1

    return last_ok_val, history

# --------- probe: image with inline base64 + longer max_tokens ---------

def probe_image_inline(model, base, key, data_url, max_tokens):
    body = {'model': model,
            'messages':[{'role':'user','content':[
                {'type':'text','text':'Briefly describe this image in one sentence (mention dominant color).'},
                {'type':'image_url','image_url':{'url': data_url}}
            ]}],
            'max_tokens': max_tokens}
    r = call_chat(body, base, key, timeout=120)
    msg = ((r['body'].get('choices') or [{}])[0].get('message')) or {}
    u = (r['body'].get('usage') or {})
    content = msg.get('content')
    text = content if isinstance(content, str) else str(content)[:200]
    return {
        'model': model, 'kind': 'image_inline',
        'image_max_tokens': max_tokens,
        'status': r['status'], 'time': round(r['time'],2),
        'usage': dict(u), 'reply_text': text,
        'err': None if r['status'] in (200,201) and not r['body'].get('error') else str(r['body'])[:300],
    }

# --------- probe: function_call with longer max_tokens ---------

def probe_function_call(model, base, key, max_tokens, tool_choice='required'):
    body = {'model': model,
            'messages':[{'role':'user','content':'What is the weather in Tokyo? Use the get_weather function.'}],
            'tools':[{
                'type':'function',
                'function':{
                    'name':'get_weather',
                    'description':'Get the current weather for a city',
                    'parameters':{'type':'object','properties':{'city':{'type':'string'}}, 'required':['city']}
                }
            }],
            'tool_choice': tool_choice,
            'max_tokens': max_tokens}
    r = call_chat(body, base, key, timeout=120)
    msg = ((r['body'].get('choices') or [{}])[0].get('message')) or {}
    u = (r['body'].get('usage') or {})
    has_tc = bool(msg.get('tool_calls'))
    tc_args = ''
    if has_tc:
        for tc in msg['tool_calls']:
            tc_args += str((tc.get('function') or {}).get('arguments')) + ' '
    content = msg.get('content')
    text = content if isinstance(content, str) else str(content)[:200]
    return {
        'model': model, 'kind': f'function_call_{tool_choice}',
        'max_tokens': max_tokens,
        'status': r['status'], 'time': round(r['time'],2),
        'usage': dict(u),
        'has_tool_calls': has_tc,
        'tool_args': tc_args[:200],
        'reply_text': text,
        'err': None if r['status'] in (200,201) and not r['body'].get('error') else str(r['body'])[:300],
    }

# --------- main ---------

def main():
    base, key = load_provider()
    png_bytes = make_png(64, 64, (255, 0, 0))   # 64x64 red
    data_url = f'data:image/png;base64,{base64.b64encode(png_bytes).decode()}'
    print(f'Inline data URL: {len(data_url)} chars  ({len(png_bytes)} PNG bytes)')
    print(f'Base URL: {base}\n')

    models = ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M3']

    # Pre-known OK-baselines (from prior probe): M2.7 last failed at 715K,
    # but we haven't confirmed anything under it; redo with safe baseline.
    hints = {
        'MiniMax-M2.7':           {'hint_low': 524288,  'hint_high': 1572864},
        'MiniMax-M2.7-highspeed': {'hint_low': 524288,  'hint_high': 1572864},
        'MiniMax-M3':             {'hint_low': 1572864, 'hint_high': 4194304},
    }
    # For baselines, we still need a known-OK starting point.
    # We'll verify hint_low by testing 65536 (always safe) first.

    all_results = {}
    for m in models:
        print(f'\n{"="*72}\n  {m}\n{"="*72}')
        out = {'model': m}

        # -- (3) tight context_window bisect --
        print(f'\n--- (3) Tight context_window probe ---')
        low, high = hints[m]['hint_low'], hints[m]['hint_high']
        # First, ensure baseline low is actually OK by probing.
        body = {'model': m,
                'messages':[{'role':'user','content':make_text_tokens(low)}],
                'max_tokens': 4}
        r0 = call_chat(body, base, key, timeout=120)
        ok_low = r0['status'] in (200,201) and not r0['body'].get('error')
        print(f'  baseline {low:,} = {"OK" if ok_low else "FAIL"}  status={r0["status"]}')
        if not ok_low:
            # fall back, try 65536
            low = 65536
            body['messages'][0]['content'] = make_text_tokens(low)
            r0 = call_chat(body, base, key, timeout=120)
            ok_low = r0['status'] in (200,201) and not r0['body'].get('error')
            print(f'  retried baseline {low:,} = {"OK" if ok_low else "FAIL"}')

        max_ok, hist = probe_ctx_tight(m, base, key, hint_low=low, hint_high=high)
        out['context_window_max'] = max_ok
        out['ctx_probe_history'] = hist
        print(f'  => MAX context_window ≈ {max_ok:,} tokens')

        # -- (2a) image with inline base64, 4096 max_tokens --
        print(f'\n--- (2a) Image inline base64 PNG, max_tokens=4096 ---')
        r = probe_image_inline(m, base, key, data_url, 4096)
        sym = '✓' if not r['err'] else '✗'
        print(f'  [{sym}] status={r["status"]} time={r["time"]:.2f}s  '
              f'pt={r["usage"].get("prompt_tokens","?")}  '
              f'ct={r["usage"].get("completion_tokens","?")}')
        if not r['err']:
            print(f'      reply: {r["reply_text"][:200]!r}')
        else:
            print(f'      err: {r["err"][:200]}')

        # -- (2b) image with 8192 max_tokens (give thinking room) --
        if r['err']:
            print(f'\n--- (2b) Image inline base64, max_tokens=8192 (more thinking room) ---')
            r2 = probe_image_inline(m, base, key, data_url, 8192)
            sym = '✓' if not r2['err'] else '✗'
            print(f'  [{sym}] status={r2["status"]} time={r2["time"]:.2f}s  '
                  f'pt={r2["usage"].get("prompt_tokens","?")}  '
                  f'ct={r2["usage"].get("completion_tokens","?")}')
            if not r2['err']:
                print(f'      reply: {r2["reply_text"][:200]!r}')
            else:
                print(f'      err: {r2["err"][:200]}')
            out['image_rerun'] = r2
        out['image'] = r

        # -- (2c) function_call, max_tokens=8192 with tool_choice=required --
        print(f'\n--- (2c) function_call (tool_choice=required) max_tokens=8192 ---')
        r = probe_function_call(m, base, key, 8192, 'required')
        sym = '✓' if not r['err'] else '✗'
        print(f'  [{sym}] status={r["status"]} time={r["time"]:.2f}s  '
              f'pt={r["usage"].get("prompt_tokens","?")}  '
              f'ct={r["usage"].get("completion_tokens","?")}  '
              f'tool_calls={r["has_tool_calls"]}')
        if r['has_tool_calls']:
            print(f'      tool_args: {r["tool_args"][:160]!r}')
        if r['reply_text']:
            print(f'      reply: {r["reply_text"][:160]!r}')
        if r['err']:
            print(f'      err: {r["err"][:160]}')
        out['function_call_required'] = r

        # -- (2d) function_call, tool_choice=auto, max_tokens=4096 --
        print(f'\n--- (2d) function_call (tool_choice=auto) max_tokens=4096 ---')
        r2 = probe_function_call(m, base, key, 4096, 'auto')
        sym = '✓' if not r2['err'] else '✗'
        print(f'  [{sym}] status={r2["status"]} time={r2["time"]:.2f}s  '
              f'pt={r2["usage"].get("prompt_tokens","?")}  '
              f'ct={r2["usage"].get("completion_tokens","?")}  '
              f'tool_calls={r2["has_tool_calls"]}')
        if r2['has_tool_calls']:
            print(f'      tool_args: {r2["tool_args"][:160]!r}')
        if r2['reply_text']:
            print(f'      reply: {r2["reply_text"][:160]!r}')
        out['function_call_auto'] = r2

        all_results[m] = out

    # Final summary
    print(f'\n\n{"="*72}\n  RERUN SUMMARY\n{"="*72}')
    for m, r in all_results.items():
        print(f'\n  {m}')
        print(f'    context_window (tight)  ≈ {r["context_window_max"]:,} tokens')
        img = r.get('image', {})
        verdict = '✓ accepted' if not img.get('err') else f'✗ err={img.get("err","")[:80]}'
        print(f'    image (inline base64)   {verdict}')
        fc_req = r.get('function_call_required', {})
        fc_auto = r.get('function_call_auto', {})
        print(f'    function (required)     tool_calls={fc_req.get("has_tool_calls")}  '
              f'status={fc_req.get("status")}')
        print(f'    function (auto)         tool_calls={fc_auto.get("has_tool_calls")}  '
              f'status={fc_auto.get("status")}')

    OUT = r'D:\Documents\VibeCoding\GodeX\tools\probe-minnimax-rerun.json'
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2, default=str)
    print(f'\nJSON: {OUT}')

if __name__ == '__main__':
    main()
