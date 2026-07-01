import json
d = json.load(open(r'D:\Documents\VibeCoding\GodeX\tools\probe-minnimax-result.json', encoding='utf-8'))
for m, r in d.items():
    print(f'\n--- {m} ---')
    print(f'  context_window  final: {r.get("context_window")}')
    print(f'  max_tokens      final: {r.get("max_tokens")}')
    print()
    print('  ctx_history (each probe):')
    for h in r.get('ctx_history', []):
        sym = '✓' if h.get('ok') else '✗'
        print(f'    [{sym}] try={h["try"]:>12,}  status={h["status"]}  '
              f'actual_prompt_tokens={h.get("actual_tokens")}  time={h.get("time")}s')
    print('\n  mt_history:')
    for h in r.get('mt_history', []):
        sym = '✓' if h.get('ok') else '✗'
        print(f'    [{sym}] max_tokens={h["try"]:>7,}  status={h["status"]}  '
              f'completion_tokens={h.get("completion_tokens")}  '
              f'finish_reason={h.get("finish_reason")}  time={h.get("time")}s')
    print('\n  caps:')
    for cap, v in r.get('caps', {}).items():
        mark = '✓' if v.get('ok') else '✗'
        u = v.get('usage') or {}
        ctd = u.get('completion_tokens_details') or {}
        print(f'    {mark} {cap:14}  status={v["status"]}  '
              f'pt={u.get("prompt_tokens")}  ct={u.get("completion_tokens")}  '
              f'completion_reason_tokens={ctd.get("reasoning_tokens")}  '
              f'tc={"yes" if v.get("has_tool_calls") else "no"}  '
              f'has_think={"yes" if v.get("snippet") and "think" in v["snippet"] else "n/a"}')
        if v.get('err'):
            print(f'        err: {v["err"][:160]}')
