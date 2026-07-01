#!/usr/bin/env python
"""Probe non-function tool types: web_search / file_search / computer_use_preview / mcp.
   Also probe parallel_tool_calls + tool_choice=none (no tool).

   These are OpenAI Responses-API / 2024–2025 features. minnimax.chat is mostly
   chat-completions so most are expected to fail. But we test anyway so we can
   document which ones are usable for CodeX.
"""

import yaml, json, urllib.request, urllib.error, time

def load():
    cfg = yaml.safe_load(open(r'D:\Documents\VibeCoding\GodeX\godex.yaml','rb'))
    p = cfg['providers']['minnimax.chat']
    return p['endpoint']['base_url'].rstrip('/'), p['credentials']['api_key']

def call(body, base, key, timeout=60):
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

def show(label, r):
    msg = ((r['body'].get('choices') or [{}])[0].get('message')) or {}
    u = (r['body'].get('usage') or {})
    content = msg.get('content')
    text = content if isinstance(content, str) else str(content)[:200]
    sym = 'OK' if ok(r) else 'FAIL'
    print(f'  {label:30} [{sym:>4}] status={r["status"]:>3}  pt={u.get("prompt_tokens","-"):>4}  ct={u.get("completion_tokens","-"):>4}  time={r["time"]:.1f}s')
    if ok(r):
        snippet = text[:140].replace('\n', ' / ')
        if msg.get('tool_calls'):
            for tc in msg['tool_calls']:
                fn = tc.get('function') or {}
                print(f'      tool_call: {fn.get("name")} args={fn.get("arguments")[:80]}')
        if snippet:
            print(f'      reply: {snippet!r}')
    else:
        print(f'      err: {str(r["body"])[:200]}')

# Tool definitions to test
TOOLS = {
    'web_search': [{'type': 'web_search', 'search_context_size': 'low'}],
    'web_search_high': [{'type': 'web_search', 'search_context_size': 'high'}],
    'file_search_no_vs': [{'type': 'file_search'}],
    'file_search_vs': [{'type': 'file_search', 'vector_store_ids': ['vs_test_dummy']}],
    'computer_use_preview': [{
        'type': 'computer_use_preview',
        'display_width': 1024,
        'display_height': 768,
        'environment': 'browser',
    }],
    'mcp': [{
        'type': 'mcp',
        'server_label': 'demo',
        'server_url': 'https://example.com/mcp',
        'allowed_tools': ['ping'],
        'headers': {},
    }],
    'parallel_two_funcs': [
        {'type':'function','function':{
            'name':'get_weather','description':'Get weather','parameters':{'type':'object','properties':{'city':{'type':'string'}},'required':['city']}}},
        {'type':'function','function':{
            'name':'get_time','description':'Get current time','parameters':{'type':'object','properties':{'tz':{'type':'string'}}}},
        },
    ],
}

CONTENT = 'What is the weather in Tokyo? Or use any tool you have to answer.'

def build_body(model, tool_name, tool_choice=None):
    body = {
        'model': model,
        'messages':[{'role':'user','content': CONTENT}],
        'tools': TOOLS[tool_name],
        'max_tokens': 4096,
    }
    if tool_choice is not None:
        body['tool_choice'] = tool_choice
    return body

def main():
    base, key = load()
    models = ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M3']
    tool_order = ['web_search', 'web_search_high', 'file_search_no_vs', 'file_search_vs',
                  'computer_use_preview', 'mcp', 'parallel_two_funcs']

    results = {}
    for m in models:
        print(f'\n{"="*72}\n  {m}\n{"="*72}')
        results[m] = {}
        for tn in tool_order:
            print(f'\n  --- tool: {tn} ---')
            r = call(build_body(m, tn), base, key)
            show(tn, r)
            results[m][tn] = {
                'status': r['status'],
                'ok': ok(r),
                'usage': dict(r['body'].get('usage') or {}),
                'err': None if ok(r) else str(r['body'])[:300],
                'has_tool_calls': bool(((r['body'].get('choices') or [{}])[0].get('message') or {}).get('tool_calls')),
            }

    # Summary
    print(f'\n\n{"="*72}\n  TOOL-TYPE SUMMARY\n{"="*72}')
    print(f'  {"tool":28}  ' + '  '.join(f'{mo.replace("MiniMax-","M"):>14}' for mo in models))
    for tn in tool_order:
        row = [f'  {tn:28}']
        for m in models:
            d = results[m].get(tn, {})
            sym = '✓ OK' if d.get('ok') else '✗ FAIL'
            row.append(f'{sym:>14}')
        print('  '.join(row))

    # Write JSON
    OUT = r'D:\Documents\VibeCoding\GodeX\tools\probe-minnimax-tools.json'
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=str)
    print(f'\nJSON: {OUT}')

if __name__ == '__main__':
    main()
