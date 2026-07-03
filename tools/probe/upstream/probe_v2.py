#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
probe_v2.py - 改进版模型能力探测 (Phase 18 草稿)

改进点:
1. image: 双 fixture (RED PNG + 64x64 B letter) + 长度+拒绝词检查 (而非单一触发词)
2. audio/video: 长度+拒绝词 (不做关键词匹配, 避免模型用 'audio'/'video' 字面词糊弄)
3. tool types (web_search etc.): required-prompt + 检查 tool_calls 是否包含目标工具类型
   - 不再只看 status=200 (模型可能静默忽略工具)
4. 每次探测同时记录 [旧逻辑判定] 和 [新逻辑判定], 便于直接对比

按次计费: 每模型 ~10 次调用. 3 个模型 = ~30 次.

Run: python tools/probe/upstream/probe_v2.py
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

import yaml

ROOT       = r'D:\\Documents\\VibeCoding\\GodeX'
GODEX_YAML = os.path.join(ROOT, 'godex.yaml')
PROVIDER   = 'minnimax.chat'

# ---------- 触发词 / 拒绝词词表 ----------

REFUSAL_WORDS = [
    # 通用拒绝
    'unable to', 'as an ai', 'cannot process', 'not supported', 'do not support',
    'cannot see', 'unable to see', 'unable to view', 'unable to process',
    # 输入未收到 - image
    'no image attached', 'no image provided', 'no image in', 'no image visible',
    'no image sent', 'image is missing', 'image not attached', 'image not provided',
    'no image was', 'without an image', 'no picture attached', 'no picture provided',
    # 输入未收到 - video
    'no video attached', 'no video provided', 'no video link', 'no video visible',
    'no video was', 'video is missing', 'video not attached', 'no video file',
    # 输入未收到 - audio
    'no audio attached', 'no audio provided', 'no audio file', 'no audio in',
    'no audio was', 'audio is missing', 'audio not attached',
    # 通用 'don''t see' / 'haven''t been provided'
    'don''t see any', 'don''t see the', 'haven''t been provided',
    'has not been provided', 'have not been provided', 'hasn''t been provided',
    # 自己的拒绝 - 排除掉, 不应该出现
    'cannot respond', 'can''t respond',
    # 中文
    chr(34) + chr(27809) + chr(34) + chr(27809), chr(34) + chr(27809) + chr(34) + chr(28304), chr(34) + chr(30475) + chr(34) + chr(21040),
    chr(34) + chr(27809) + chr(34) + chr(35270), chr(34) + chr(27809) + chr(34) + chr(38899), chr(34) + chr(26080) + chr(34) + chr(27465),
    chr(34) + chr(19981) + chr(34) + chr(33021),
]

# 颜色/视觉描述的宽触发词
COLOR_WORDS = [
    # 具体颜色 (red 红色 这个是关键 - 模型真看到了会说的)
    'red', 'blue', 'green', 'yellow', 'white', 'black', 'purple', 'pink', 'orange', 'brown',
    'gray', 'grey', 'cyan', 'magenta',
    'rgb', 'rgba', 'hex', '#ff',
    # 派生颜色词
    'crimson', 'scarlet', 'vermilion', 'maroon', 'burgundy',
    'navy', 'azure', 'cobalt', 'teal', 'lime', 'olive',
    'gold', 'golden', 'silver',
    'brick', 'cherry', 'ruby',
    # 形状/几何
    'square', 'rectangle', 'circle', 'triangle', 'polygon', 'diamond', 'cross', 'star',
    'horizontal', 'vertical', 'diagonal',
    'pixel', 'pixels',
    # 文字内容 (模型说 'reads' / 'says' 才算真正看到了文字)
    'reads', 'says', 'written', 'spell', 'spells', 'letter', 'letters', 'word', 'words',
    'font', 'bold', 'italic', 'uppercase', 'lowercase',
    'red background', 'red text', 'white text', 'black text',
    # 视觉描述
    'saturated', 'bright', 'vivid', 'vibrant', 'hue', 'shade', 'tint',
    'background', 'foreground', 'gradient', 'solid', 'uniform', 'transparent',
    # 中文
    chr(34) + chr(32418) + chr(34) + chr(33394),  # 红色
    chr(34) + chr(34031) + chr(34) + chr(33394),  # 黄色
    chr(34) + chr(34013) + chr(34) + chr(33394),  # 蓝色
    chr(34) + chr(32511) + chr(34) + chr(33394),  # 绿色
    chr(34) + chr(30333) + chr(34) + chr(32418),  # 深红
    chr(34) + chr(28165) + chr(34) + chr(33394),  # 浅红
    chr(34) + chr(26041) + chr(34) + chr(24418),  # 方形
    chr(34) + chr(22278) + chr(34) + chr(23383),  # 圆圈
    chr(34) + chr(23383) + chr(34) + chr(20307),  # 字体
    chr(34) + chr(39030) + chr(34) + chr(26412),  # 背景
]


# image fixture: RED PNG + 64x64 black with 'B'
HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, '_IMAGE_B64.b64'), 'r') as f:
    RED_PNG_B64 = f.read().strip()

with open(os.path.join(HERE, '_AUDIO_B64.b64'), 'r') as f:
    AUDIO_WAV_B64 = f.read().strip()

with open(os.path.join(HERE, '_VIDEO_B64.b64'), 'r') as f:
    VIDEO_MP4_B64 = f.read().strip()

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
        try:
            raw = json.loads(e.read())
        except Exception:
            raw = {'raw': '<unreadable>'}
        return {'status': e.code, 'time': time.time()-t0, 'body': raw}
    except Exception as e:
        return {'status': 0, 'time': time.time()-t0, 'body': {'err': str(e)}}

def extract_reply(r):
    msg = ((r['body'].get('choices') or [{}])[0].get('message') or {})
    content = msg.get('content') or ''
    if isinstance(content, list):
        return ' '.join(p.get('text', '') for p in content if isinstance(p, dict))
    return content if isinstance(content, str) else ''

def contains_any(text, words):
    low = text.lower()
    return any(w.lower() in low for w in words)

# ---------- 探测函数 ----------

def probe_text(model, base_url, api_key):
    body = {
        'model': model,
        'messages': [{'role':'user','content':'Say hi in 3 words.'}],
        'max_tokens': 32,
    }
    r = call_chat(body, base_url, api_key)
    txt = extract_reply(r).lower()
    ok = r['status'] == 200 and not r['body'].get('error')
    hit = contains_any(txt, ['hi', 'hello', 'hey', 'greet', chr(34) + chr(20320) + chr(34) + chr(22909), chr(34) + chr(21796) + chr(34)])
    return {
        'cap': 'text',
        'status': r['status'],
        'old_pass': ok and bool(hit),
        'new_pass': ok and bool(hit),
        'reply': txt[:120],
    }

def probe_image(model, base_url, api_key):
    fixtures = [
        {
            'name': 'RED_PNG',
            'prompt': 'Describe this image. What color and any text?',
            'image_url': 'data:image/png;base64,' + RED_PNG_B64,
            'trigger_words': COLOR_WORDS,
        },
        {
            'name': 'B_LETTER',
            'prompt': 'What single letter is shown in this image? Reply with just that letter.',
            'image_url': 'https://placehold.co/64x64.png/000000/FFFFFF/png?text=B',
            'trigger_words': COLOR_WORDS + [' b ', ' b.', ' b,', 'letter b', 'is b', '"b"'],
        },
    ]
    out = []
    for fx in fixtures:
        body = {
            'model': model,
            'messages': [{'role':'user','content':[
                {'type':'text','text':fx['prompt']},
                {'type':'image_url','image_url':{'url':fx['image_url']}},
            ]}],
            'max_tokens': 256,
        }
        r = call_chat(body, base_url, api_key)
        txt = extract_reply(r)
        low = txt.lower()
        ok = r['status'] == 200 and not r['body'].get('error')
        trigger_hit = contains_any(low, fx['trigger_words'])
        no_refusal = not contains_any(low, REFUSAL_WORDS)
        substantive = len(low.strip()) >= 30 and no_refusal
        # OLD: 只看 'red'/'红色'/saturated/crimson/scarlet 这 5 个词
        old_hit = contains_any(low, ['red', chr(34) + chr(32418) + chr(34) + chr(33394), 'saturated', 'crimson', 'scarlet'])
        out.append({
            'fixture': fx['name'],
            'status': r['status'],
            'reply': low[:2000],
            'old_pass': ok and old_hit,
            'new_pass': ok and no_refusal and (trigger_hit or substantive),
            'trigger_hit': trigger_hit,
            'substantive': substantive,
        })
    # 综合: 任一 fixture 通过即 true
    old_pass = any(f['old_pass'] for f in out)
    new_pass = any(f['new_pass'] for f in out)
    return {
        'cap': 'image',
        'status': max(f['status'] for f in out),
        'old_pass': old_pass,
        'new_pass': new_pass,
        'fixtures': out,
    }

def probe_audio(model, base_url, api_key):
    body = {
        'model': model,
        'messages': [{'role':'user','content':[
            {'type':'input_audio','input_audio':{'data':AUDIO_WAV_B64,'format':'wav'}},
            {'type':'text','text':'What does this audio sound like?'},
        ]}],
        'max_tokens': 256,
    }
    r = call_chat(body, base_url, api_key)
    txt = extract_reply(r)
    low = txt.lower()
    ok = r['status'] == 200 and not r['body'].get('error')
    no_refusal = not contains_any(low, REFUSAL_WORDS)
    substantive = len(low.strip()) >= 20 and no_refusal
    return {
        'cap': 'audio',
        'status': r['status'],
        'old_pass': ok and substantive,
        'new_pass': ok and substantive,
        'reply': low[:2000],
        'substantive': substantive,
    }

def probe_video(model, base_url, api_key):
    body = {
        'model': model,
        'messages': [{'role':'user','content':[
            {'type':'video_url','video_url':{'url':'data:video/mp4;base64,' + VIDEO_MP4_B64}},
            {'type':'text','text':'Describe this video briefly.'},
        ]}],
        'max_tokens': 256,
    }
    r = call_chat(body, base_url, api_key)
    txt = extract_reply(r)
    low = txt.lower()
    ok = r['status'] == 200 and not r['body'].get('error')
    no_refusal = not contains_any(low, REFUSAL_WORDS)
    substantive = len(low.strip()) >= 20 and no_refusal
    return {
        'cap': 'video',
        'status': r['status'],
        'old_pass': ok and substantive,
        'new_pass': ok and substantive,
        'reply': low[:2000],
        'substantive': substantive,
    }

def probe_function(model, base_url, api_key):
    body = {
        'model': model,
        'messages': [{'role':'user','content':'What is the weather in Tokyo? Use get_weather.'}],
        'tools':[{'type':'function','function':{
            'name':'get_weather',
            'description':'Get current weather for a city',
            'parameters':{'type':'object','properties':{'city':{'type':'string'}},'required':['city']},
        }}],
        'tool_choice':'required',
        'max_tokens': 256,
    }
    r = call_chat(body, base_url, api_key)
    msg = ((r['body'].get('choices') or [{}])[0].get('message') or {})
    tool_calls = msg.get('tool_calls') or []
    has_call = len(tool_calls) > 0
    ok = r['status'] == 200 and not r['body'].get('error')
    return {
        'cap': 'function',
        'status': r['status'],
        'old_pass': ok and has_call,
        'new_pass': ok and has_call,
        'tool_calls': len(tool_calls),
        'reply': (msg.get('content') or '')[:120],
    }

def probe_reasoning(model, base_url, api_key):
    body = {
        'model': model,
        'reasoning_effort': 'medium',
        'messages': [{'role':'user','content':'What is 13 * 17? Think step by step.'}],
        'max_tokens': 1024,
    }
    r = call_chat(body, base_url, api_key)
    usage = (r['body'].get('usage') or {})
    rt = usage.get('reasoning_tokens') or 0
    ok = r['status'] == 200 and not r['body'].get('error')
    return {
        'cap': 'reasoning',
        'status': r['status'],
        'old_pass': ok and rt > 0,
        'new_pass': ok and rt > 0,
        'reasoning_tokens': rt,
    }

def probe_tool_type(model, base_url, api_key, tool_type, tool_def, required_prompt):
    body = {
        'model': model,
        'messages': [{'role':'user','content':required_prompt}],
        'tools': [tool_def],
        'tool_choice': 'auto',
        'max_tokens': 256,
    }
    r = call_chat(body, base_url, api_key)
    msg = ((r['body'].get('choices') or [{}])[0].get('message') or {})
    tool_calls = msg.get('tool_calls') or []
    content = msg.get('content') or ''
    if isinstance(content, list):
        content = ' '.join(p.get('text','') for p in content if isinstance(p, dict))
    low = (content or '').lower()
    no_refusal = not contains_any(low, REFUSAL_WORDS)
    ok = r['status'] == 200 and not r['body'].get('error')
    has_target = any(
        (tc.get('type') == tool_type) or
        (isinstance(tc.get('function'), dict) and tc['function'].get('name','').lower() == tool_type)
        for tc in tool_calls
    )
    return {
        'cap': tool_type,
        'status': r['status'],
        'old_pass': ok,
        'new_pass': ok and has_target and no_refusal,
        'tool_calls': len(tool_calls),
        'has_target': has_target,
        'reply': low[:2000],
    }

# ---------- main ----------

def main():
    cfg = load_provider()
    print(f'Base URL: {cfg["base_url"]}')
    print(f'Models  : {[m["model"] for m in cfg["models"]]}')
    print()

    TOOL_PROBES = [
        ('web_search',   {'type':'web_search'},                            'Search the web for the latest news today and tell me one headline.'),
        ('file_search',  {'type':'file_search'},                           'Search my local files for budget and list matching filenames.'),
        ('computer_use', {'type':'computer_use','provider':'windows'},     'Take a screenshot of my desktop and describe what windows are open.'),
        ('tool_search',  {'type':'tool_search'},                           'Find a tool that can convert PDF to plain text.'),
        ('mcp',          {'type':'mcp'},                                   'Use any MCP server tool you have access to.'),
    ]

    results = {}
    for m in cfg['models']:
        model = m['model']
        print('=' * 70)
        print('  ' + model)
        print('=' * 70)
        cap_results = {}
        for name, fn in [
            ('text',       lambda: probe_text(model, cfg['base_url'], cfg['api_key'])),
            ('image',      lambda: probe_image(model, cfg['base_url'], cfg['api_key'])),
            ('audio',      lambda: probe_audio(model, cfg['base_url'], cfg['api_key'])),
            ('video',      lambda: probe_video(model, cfg['base_url'], cfg['api_key'])),
            ('function',   lambda: probe_function(model, cfg['base_url'], cfg['api_key'])),
            ('reasoning',  lambda: probe_reasoning(model, cfg['base_url'], cfg['api_key'])),
        ]:
            try:
                cap_results[name] = fn()
                r = cap_results[name]
                old = chr(43) if r['old_pass'] else chr(45)
                new = chr(43) if r['new_pass'] else chr(45)
                diff = ' (CHANGED)' if r['old_pass'] != r['new_pass'] else ''
                print(f'  [{old}->{new}] {name:14s}  status={r["status"]:<4}{diff}')
                if 'reply' in r and len(r['reply']) > 0:
                    print(f'         reply: {r["reply"][:100]}')
            except Exception as e:
                cap_results[name] = {'cap': name, 'status': 0, 'old_pass': False, 'new_pass': False, 'err': str(e)}
                print(f'  [ERR] {name}: {e}')

        for tool_type, tool_def, prompt in TOOL_PROBES:
            try:
                cap_results[tool_type] = probe_tool_type(model, cfg['base_url'], cfg['api_key'], tool_type, tool_def, prompt)
                r = cap_results[tool_type]
                old = chr(43) if r['old_pass'] else chr(45)
                new = chr(43) if r['new_pass'] else chr(45)
                diff = ' (CHANGED)' if r['old_pass'] != r['new_pass'] else ''
                print(f'  [{old}->{new}] {tool_type:14s}  status={r["status"]:<4} tool_calls={r.get("tool_calls",0)} has_target={r.get("has_target",False)}{diff}')
                if 'reply' in r and len(r['reply']) > 0:
                    print(f'         reply: {r["reply"][:100]}')
            except Exception as e:
                cap_results[tool_type] = {'cap': tool_type, 'status': 0, 'old_pass': False, 'new_pass': False, 'err': str(e)}
                print(f'  [ERR] {tool_type}: {e}')

        results[model] = cap_results
        print()

    # Summary
    print('=' * 70)
    print('  SUMMARY (旧 vs 新)')
    print('=' * 70)
    cap_order = ['text', 'image', 'audio', 'video', 'function', 'reasoning',
                 'web_search', 'file_search', 'computer_use', 'tool_search', 'mcp']
    header = f'{"cap":<14s} | ' + ' | '.join(f'{m["model"][:20]:<20s}' for m in cfg['models'])
    print(header)
    print('-' * len(header))
    for cap in cap_order:
        row = f'{cap:<14s} | '
        for m in cfg['models']:
            r = results.get(m['model'], {}).get(cap, {})
            old = chr(43) if r.get('old_pass') else chr(45)
            new = chr(43) if r.get('new_pass') else chr(45)
            cell = old + '/' + new
            row += f'{cell:<20s} | '
        print(row)

    print()
    print('legend: ' + chr(43) + ' = pass, ' + chr(45) + ' = fail')
    print('      each cell shows old/new pass')

    # Save JSON
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'probe_v2_result.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=str)
    print(f'\nJSON: {out}')

if __name__ == '__main__':
    main()
