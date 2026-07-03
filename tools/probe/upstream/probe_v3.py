#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""probe_v3.py - LLM-as-judge model capability probe (Phase 18 v3 draft)"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

import yaml

ROOT       = r'D:\\Documents\\VibeCoding\\GodeX'
GODEX_YAML = os.path.join(ROOT, 'godex.yaml')
PROVIDER   = 'minnimax.chat'

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, '_IMAGE_B64.b64'), 'r') as f:
    RED_PNG_B64 = f.read().strip()
with open(os.path.join(HERE, '_AUDIO_B64.b64'), 'r') as f:
    AUDIO_WAV_B64 = f.read().strip()
with open(os.path.join(HERE, '_VIDEO_B64.b64'), 'r') as f:
    VIDEO_MP4_B64 = f.read().strip()


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
            return {'status': r.status, 'time': time.time()-t0, 'body': json.loads(r.read())}
    except urllib.error.HTTPError as e:
        try:
            raw = json.loads(e.read())
        except Exception:
            raw = {'raw': '<unreadable>'}
        return {'status': e.code, 'time': time.time()-t0, 'body': raw}
    except Exception as e:
        return {'status': 0, 'time': time.time()-t0, 'body': {'err': str(e)}}


def extract_text(r):
    msg = ((r.get('body', {}).get('choices') or [{}])[0].get('message') or {})
    content = msg.get('content') or ''
    if isinstance(content, list):
        return ' '.join(p.get('text', '') for p in content if isinstance(p, dict))
    return content if isinstance(content, str) else ''


def extract_tool_calls(r):
    msg = ((r.get('body', {}).get('choices') or [{}])[0].get('message') or {})
    return msg.get('tool_calls') or []


def extract_usage(r):
    return r.get('body', {}).get('usage') or {}


def trim(s, n=600):
    if not isinstance(s, str):
        s = str(s)
    return s if len(s) <= n else s[:n] + '...[truncated]'


def probe_text_raw(model, base_url, api_key):
    body = {
        'model': model,
        'messages': [{'role':'user','content':'Say hi in 3 words.'}],
        'max_tokens': 32,
    }
    r = call_chat(body, base_url, api_key)
    return {
        'cap': 'text',
        'request': {'model': model, 'messages': body['messages'], 'max_tokens': 32},
        'status': r['status'],
        'response_text': trim(extract_text(r)),
        'tool_calls': extract_tool_calls(r),
        'usage': extract_usage(r),
    }


def probe_image_raw(model, base_url, api_key):
    out = {'cap': 'image_input', 'fixtures': []}
    for name, prompt, url in [
        ('RED_PNG', 'Describe this image. What color and any text?',
         'data:image/png;base64,' + RED_PNG_B64),
        ('B_LETTER', 'What single letter is shown in this image? Reply with just that letter.',
         'https://placehold.co/64x64.png/000000/FFFFFF/png?text=B'),
    ]:
        body = {
            'model': model,
            'messages': [{'role':'user','content':[
                {'type':'text','text':prompt},
                {'type':'image_url','image_url':{'url':url}},
            ]}],
            'max_tokens': 256,
        }
        r = call_chat(body, base_url, api_key)
        out['fixtures'].append({
            'name': name,
            'status': r['status'],
            'response_text': trim(extract_text(r)),
            'request_had_image': True,
        })
    return out


def probe_audio_raw(model, base_url, api_key):
    body = {
        'model': model,
        'messages': [{'role':'user','content':[
            {'type':'input_audio','input_audio':{'data':AUDIO_WAV_B64,'format':'wav'}},
            {'type':'text','text':'What does this audio sound like?'},
        ]}],
        'max_tokens': 256,
    }
    r = call_chat(body, base_url, api_key)
    return {
        'cap': 'audio_input',
        'request': {'content': 'input_audio (16KB WAV) + text prompt'},
        'status': r['status'],
        'response_text': trim(extract_text(r)),
    }


def probe_video_raw(model, base_url, api_key):
    body = {
        'model': model,
        'messages': [{'role':'user','content':[
            {'type':'video_url','video_url':{'url':'data:video/mp4;base64,' + VIDEO_MP4_B64}},
            {'type':'text','text':'Describe this video briefly.'},
        ]}],
        'max_tokens': 256,
    }
    r = call_chat(body, base_url, api_key)
    return {
        'cap': 'video_input',
        'request': {'content': 'video_url (3KB MP4) + text prompt'},
        'status': r['status'],
        'response_text': trim(extract_text(r)),
    }


def probe_function_raw(model, base_url, api_key):
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
    return {
        'cap': 'function_call',
        'request': {'tools': body['tools'], 'tool_choice': 'required'},
        'status': r['status'],
        'response_text': trim(extract_text(r)),
        'tool_calls': extract_tool_calls(r),
    }


def probe_reasoning_raw(model, base_url, api_key):
    body = {
        'model': model,
        'reasoning_effort': 'medium',
        'messages': [{'role':'user','content':'What is 13 * 17? Think step by step.'}],
        'max_tokens': 1024,
    }
    r = call_chat(body, base_url, api_key)
    return {
        'cap': 'reasoning',
        'request': {'reasoning_effort': 'medium'},
        'status': r['status'],
        'response_text': trim(extract_text(r)),
        'usage': extract_usage(r),
    }


def probe_tool_raw(model, base_url, api_key, tool_type, tool_def, prompt):
    body = {
        'model': model,
        'messages': [{'role':'user','content':prompt}],
        'tools': [tool_def],
        'tool_choice': 'auto',
        'max_tokens': 256,
    }
    r = call_chat(body, base_url, api_key)
    return {
        'cap': tool_type,
        'request': {'tools': [tool_def], 'prompt': prompt},
        'status': r['status'],
        'response_text': trim(extract_text(r)),
        'tool_calls': extract_tool_calls(r),
    }


TOOL_PROBES = [
    ('web_search',   {'type':'web_search'},                            'Search the web for the latest news today and tell me one headline.'),
    ('file_search',  {'type':'file_search'},                           'Search my local files for budget and list matching filenames.'),
    ('computer_use', {'type':'computer_use','provider':'windows'},     'Take a screenshot of my desktop and describe what windows are open.'),
    ('tool_search',  {'type':'tool_search'},                           'Find a tool that can convert PDF to plain text.'),
    ('mcp',          {'type':'mcp'},                                   'Use any MCP server tool you have access to.'),
]


def build_judge_prompt(target_model, raw_data):
    parts = []
    parts.append('You are a STRICT capability judge for an LLM model. Below are 11 raw probe results from a single model called "' + target_model + '". Your job is to classify each capability as true / false / null.')
    parts.append('')
    parts.append('DEFINITIONS')
    parts.append('- text: true if the response is a substantive non-refusal text reply. Empty or refusal-only = false.')
    parts.append('- image_input: true ONLY if the model clearly processed the image and gave a description of visual content (color, shape, text, object, layout). A refusal like "I do not see an image attached" is false. A confident generic reply like "the image is beautiful" with no specific detail = null (inconclusive).')
    parts.append('- audio_input: same rule as image_input but for audio.')
    parts.append('- video_input: same rule as image_input but for video.')
    parts.append('- function_call: true if response.tool_calls is non-empty AND contains a function call.')
    parts.append('- reasoning: true if usage.reasoning_tokens > 0. (We trust the usage data; do not judge from chain-of-thought text in the response body.)')
    parts.append('- web_search / file_search / computer_use / tool_search / mcp: true if response.tool_calls contains a call with that tool type. A response that TALKS ABOUT searching without actually invoking the tool is false.')
    parts.append('')
    parts.append('POSITIVE EXAMPLES (genuine support)')
    parts.append('- image_input true: status=200, response says "the image shows a red square with the word RED in white text in the center" -- clearly visual.')
    parts.append('- function_call true: response.tool_calls = [{"type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\"Tokyo\\"}"}}].')
    parts.append('- web_search true: response.tool_calls = [{"type":"web_search","web_search":{"query":"latest news"}}].')
    parts.append('- reasoning true: usage.reasoning_tokens = 1234.')
    parts.append('')
    parts.append('NEGATIVE EXAMPLES (false support -- be especially careful)')
    parts.append('- image_input false: response says "I am sorry, but I do not see an image attached to your message. Could you please upload or provide a link to the image?" -- this is a REFUSAL, not actual image processing.')
    parts.append('- image_input false: response says "there is no image provided" or "no image is attached" or "I cannot view the image" -- all refusals.')
    parts.append('- function_call false: response.tool_calls is empty or null even though the user asked for a tool.')
    parts.append('- web_search false: response is text like "I should search the web for the latest news..." or "let me do a web search" but tool_calls is empty/null -- the model THOUGHT about searching but did not actually call the tool. This is a critical false positive.')
    parts.append('- reasoning false: usage.reasoning_tokens is 0, null, or missing, even if the response shows a thinking block. Internal thinking != billable reasoning tokens.')
    parts.append('')
    parts.append('EDGE CASES -- mark as null when inconclusive')
    parts.append('- image_input null: response is a confident but generic statement ("the image looks great") with no specific visual content.')
    parts.append('- function_call null: tool_choice=required was set but model returned an error response.')
    parts.append('- web_search null: tool_calls has a call but the type is not web_search (might be a function instead).')
    parts.append('')
    parts.append('ANTI-BIAS INSTRUCTIONS')
    parts.append('- You are judging this model. Be brutally honest. Do NOT give credit for a capability the model did not demonstrate.')
    parts.append('- The probe data below shows what the model DID, not what it CLAIMS to do. Judge only the data.')
    parts.append('- If the model said "I cannot" / "I do not see" / "no image attached" / "as an AI" / "not supported" -- that is a clear false.')
    parts.append('- If the model is just emitting a thinking block with no actual answer -- false.')
    parts.append('- If you cannot determine truth from the data, set null and explain why.')
    parts.append('')
    parts.append('PROBE DATA (JSON)')
    parts.append(json.dumps(raw_data, ensure_ascii=False, indent=2))
    parts.append('')
    parts.append('OUTPUT FORMAT')
    parts.append('Return JSON only, no commentary, no markdown fences. Use this exact structure:')
    parts.append('{')
    parts.append('  "text": true|false|null,')
    parts.append('  "image_input": true|false|null,')
    parts.append('  "audio_input": true|false|null,')
    parts.append('  "video_input": true|false|null,')
    parts.append('  "function_call": true|false|null,')
    parts.append('  "reasoning": true|false|null,')
    parts.append('  "web_search": true|false|null,')
    parts.append('  "file_search": true|false|null,')
    parts.append('  "computer_use": true|false|null,')
    parts.append('  "tool_search": true|false|null,')
    parts.append('  "mcp": true|false|null,')
    parts.append('  "reasoning_per_capability": {')
    parts.append('    "text": "...",')
    parts.append('    "image_input": "...",')
    parts.append('    "audio_input": "...",')
    parts.append('    "video_input": "...",')
    parts.append('    "function_call": "...",')
    parts.append('    "reasoning": "...",')
    parts.append('    "web_search": "...",')
    parts.append('    "file_search": "...",')
    parts.append('    "computer_use": "...",')
    parts.append('    "tool_search": "...",')
    parts.append('    "mcp": "..."')
    parts.append('  }')
    parts.append('}')
    parts.append('')
    parts.append('The reasoning_per_capability fields must each be 1-3 sentences explaining the decision. They are used for audit and to detect judge errors.')
    return chr(10).join(parts)


def call_judge(judge_model, base_url, api_key, target_model, raw_data):
    prompt = build_judge_prompt(target_model, raw_data)
    body = {
        'model': judge_model,
        'messages': [{'role':'user','content':prompt}],
        'max_tokens': 4096,
        'temperature': 0.0,
    }
    t0 = time.time()
    try:
        with urllib.request.urlopen(
            urllib.request.Request(
                f'{base_url}/chat/completions',
                data=json.dumps(body).encode('utf-8'),
                headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
                method='POST',
            ),
            timeout=180,
        ) as r:
            data = json.loads(r.read())
            elapsed = time.time() - t0
            content = ((data.get('choices') or [{}])[0].get('message') or {}).get('content') or ''
            try:
                return {'ok': True, 'elapsed': elapsed, 'judgment': json.loads(content), 'raw': content}
            except Exception:
                pass
            m = re.search(r'\{[\s\S]*\}', content)
            if m:
                try:
                    return {'ok': True, 'elapsed': elapsed, 'judgment': json.loads(m.group(0)), 'raw': content}
                except Exception:
                    pass
            return {'ok': False, 'elapsed': elapsed, 'err': 'JSON parse failed', 'raw': content}
    except Exception as e:
        return {'ok': False, 'elapsed': 0, 'err': str(e)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--judge-model', default=None, help='Override judge model. Default: self-eval.')
    ap.add_argument('--target', action='append', default=[], help='Target model name. Repeatable. Default: all enabled.')
    args = ap.parse_args()

    cfg = load_provider()
    print('Base URL:', cfg['base_url'])
    targets = args.target if args.target else [m['model'] for m in cfg['models']]
    print('Targets :', targets)
    print('Judge   :', '(self-eval)' if not args.judge_model else args.judge_model)
    print()

    caps_order = ['text', 'image_input', 'audio_input', 'video_input',
                  'function_call', 'reasoning',
                  'web_search', 'file_search', 'computer_use', 'tool_search', 'mcp']

    all_results = {}
    for target in targets:
        judge_model = args.judge_model or target
        print('=' * 70)
        print('  TARGET = ' + target + '  |  JUDGE = ' + judge_model)
        print('=' * 70)

        raw = {}
        t0 = time.time()
        raw['text']          = probe_text_raw(target, cfg['base_url'], cfg['api_key'])
        raw['image_input']   = probe_image_raw(target, cfg['base_url'], cfg['api_key'])
        raw['audio_input']   = probe_audio_raw(target, cfg['base_url'], cfg['api_key'])
        raw['video_input']   = probe_video_raw(target, cfg['base_url'], cfg['api_key'])
        raw['function_call'] = probe_function_raw(target, cfg['base_url'], cfg['api_key'])
        raw['reasoning']     = probe_reasoning_raw(target, cfg['base_url'], cfg['api_key'])
        for tt, td, tp in TOOL_PROBES:
            raw[tt] = probe_tool_raw(target, cfg['base_url'], cfg['api_key'], tt, td, tp)
        probe_elapsed = time.time() - t0
        print('  probe phase: ' + str(round(probe_elapsed, 1)) + 's, 11 caps done')

        t0 = time.time()
        result = call_judge(judge_model, cfg['base_url'], cfg['api_key'], target, raw)
        judge_elapsed = time.time() - t0
        print('  judge phase: ' + str(round(judge_elapsed, 1)) + 's')

        if not result['ok']:
            print('  JUDGE FAILED: ' + str(result.get('err', '?')))
            all_results[target] = {'raw': raw, 'judgment': None, 'judge_err': result.get('err'), 'judge_model': judge_model}
            print()
            continue

        j = result['judgment']
        for c in caps_order:
            v = j.get(c)
            mark = {True: '+', False: '-', None: '?'}.get(v, '?')
            st = raw[c].get('status', '?') if isinstance(raw.get(c), dict) else '?'
            print('  [' + mark + '] ' + c.ljust(15) + ' status=' + str(st))
        r = j.get('reasoning_per_capability', {})
        for c in caps_order:
            if c in r:
                txt = r[c]
                if len(txt) > 120: txt = txt[:120] + '...'
                print('       why: ' + txt)

        all_results[target] = {
            'judge_model': judge_model,
            'probe_elapsed': probe_elapsed,
            'judge_elapsed': judge_elapsed,
            'judgment': j,
            'raw': raw,
        }
        print()

    print('=' * 70)
    print('  SUMMARY (LLM-as-judge)')
    print('=' * 70)
    header = 'cap'.ljust(15) + ' | ' + ' | '.join(t[:24].ljust(24) for t in targets)
    print(header)
    print('-' * len(header))
    for c in caps_order:
        row = c.ljust(15) + ' | '
        for t in targets:
            j = all_results.get(t, {}).get('judgment') or {}
            v = j.get(c)
            mark = {True: '+', False: '-', None: '?'}.get(v, '?')
            row += mark.ljust(24) + ' | '
        print(row)

    out = os.path.join(HERE, 'probe_v3_result.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2, default=str)
    print(chr(10) + 'JSON: ' + out)


if __name__ == '__main__':
    main()
