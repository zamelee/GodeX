#!/usr/bin/env python
# -*- coding: utf-8 -*-
"probe_v4.py - Hybrid (code + LLM judge) model capability probe"

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
with open(os.path.join(HERE, '_GREEN_B64.b64'), 'r') as f:
    GREEN_CIRCLE_B64 = f.read().strip()
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

def extract_error_code(r):
    if r['status'] < 400:
        return None
    body = r.get('body') or {}
    err = body.get('error') if isinstance(body, dict) else None
    if isinstance(err, dict):
        return err.get('code') or err.get('type') or err.get('message', '')[:80]
    return None

def trim(s, n=600):
    if not isinstance(s, str):
        s = str(s)
    return s if len(s) <= n else s[:n] + '...[truncated]'

def probe_text_raw(model, base_url, api_key):
    body = {'model': model, 'messages': [{'role':'user','content':'Say hi in 3 words.'}], 'max_tokens': 32}
    r = call_chat(body, base_url, api_key)
    return {'cap': 'text', 'status': r['status'], 'response_text': trim(extract_text(r)), 'error_code': extract_error_code(r)}

def probe_image_raw(model, base_url, api_key):
    out = {'cap': 'image_input', 'fixtures': []}
    for name, prompt, url in [
        ('RED_PNG', 'Describe this image. What color and any text?', 'data:image/png;base64,' + RED_PNG_B64),
        ('GREEN_CIRCLE', 'Describe this image briefly. What shape and color?', 'data:image/png;base64,' + GREEN_CIRCLE_B64),
    ]:
        body = {'model': model, 'messages': [{'role':'user','content':[{'type':'text','text':prompt},{'type':'image_url','image_url':{'url':url}}]}], 'max_tokens': 256}
        r = call_chat(body, base_url, api_key)
        out['fixtures'].append({'name': name, 'status': r['status'], 'response_text': trim(extract_text(r)), 'error_code': extract_error_code(r)})
    return out

def probe_audio_raw(model, base_url, api_key):
    body = {'model': model, 'messages': [{'role':'user','content':[{'type':'input_audio','input_audio':{'data':AUDIO_WAV_B64,'format':'wav'}},{'type':'text','text':'What does this audio sound like?'}]}], 'max_tokens': 256}
    r = call_chat(body, base_url, api_key)
    return {'cap': 'audio_input', 'status': r['status'], 'response_text': trim(extract_text(r)), 'error_code': extract_error_code(r)}

def probe_video_raw(model, base_url, api_key):
    body = {'model': model, 'messages': [{'role':'user','content':[{'type':'video_url','video_url':{'url':'data:video/mp4;base64,' + VIDEO_MP4_B64}},{'type':'text','text':'Describe this video briefly.'}]}], 'max_tokens': 256}
    r = call_chat(body, base_url, api_key)
    return {'cap': 'video_input', 'status': r['status'], 'response_text': trim(extract_text(r)), 'error_code': extract_error_code(r)}

def probe_function_raw(model, base_url, api_key):
    body = {'model': model, 'messages': [{'role':'user','content':'What is the weather in Tokyo? Use get_weather.'}], 'tools':[{'type':'function','function':{'name':'get_weather','description':'Get current weather for a city','parameters':{'type':'object','properties':{'city':{'type':'string'}},'required':['city']}}}], 'tool_choice':'required', 'max_tokens': 256}
    r = call_chat(body, base_url, api_key)
    return {'cap': 'function_call', 'status': r['status'], 'tool_calls': extract_tool_calls(r), 'response_text': trim(extract_text(r))}

def probe_reasoning_raw(model, base_url, api_key, n_shots=3):
    """Send the same reasoning prompt n_shots times; record per-shot reasoning_tokens."""
    prompt = 'What is 13 * 17? Think step by step.'
    shots = []
    for i in range(n_shots):
        body = {'model': model, 'reasoning_effort': 'medium', 'messages': [{'role':'user','content':prompt}], 'max_tokens': 1024}
        r = call_chat(body, base_url, api_key)
        shots.append({'shot': i + 1, 'status': r['status'], 'response_text': trim(extract_text(r)), 'usage': extract_usage(r)})
    return {'cap': 'reasoning', 'shots': shots, 'n_shots': n_shots}

def probe_tool_raw(model, base_url, api_key, tool_type, tool_def, prompt):
    body = {'model': model, 'messages': [{'role':'user','content':prompt}], 'tools': [tool_def], 'tool_choice': 'auto', 'max_tokens': 256}
    r = call_chat(body, base_url, api_key)
    return {'cap': tool_type, 'status': r['status'], 'tool_calls': extract_tool_calls(r), 'response_text': trim(extract_text(r))}

TOOL_PROBES = [
    ('web_search',   {'type':'web_search'},                            'Search the web for the latest news today and tell me one headline.'),
    ('file_search',  {'type':'file_search'},                           'Search my local files for budget and list matching filenames.'),
    ('computer_use', {'type':'computer_use','provider':'windows'},     'Take a screenshot of my desktop and describe what windows are open.'),
    ('tool_search',  {'type':'tool_search'},                           'Find a tool that can convert PDF to plain text.'),
    ('mcp',          {'type':'mcp'},                                   'Use any MCP server tool you have access to.'),
]

TOOL_NAME_PATTERNS = {
    'web_search':   ['web_search', 'websearch', 'web-search', 'search_web', 'plugin_web_search'],
    'file_search':  ['file_search', 'filesearch', 'file-search', 'search_file', 'plugin_file_search'],
    'computer_use': ['computer_use', 'computeruse', 'computer-use', 'use_computer', 'computer'],
    'tool_search':  ['tool_search', 'toolsearch', 'tool-search', 'search_tool'],
    'mcp':          ['mcp', 'mcp_tool', 'mcp_server'],
}

def judge_text(raw):
    if raw['status'] != 200:
        return ('false_other', 'status ' + str(raw['status']))
    txt = raw['response_text'].strip()
    if not txt:
        return ('false_other', 'empty response')
    return ('true', 'status 200, response ' + str(len(txt)) + ' chars')

def judge_function_call(raw):
    if raw['status'] != 200:
        return ('false_other', 'status ' + str(raw['status']))
    tcs = raw.get('tool_calls') or []
    if not tcs:
        return ('false_model', 'status 200 but no tool_calls')
    fn_names = [tc.get('function', {}).get('name', '') for tc in tcs if isinstance(tc, dict)]
    return ('true', 'tool_calls = ' + json.dumps(fn_names, ensure_ascii=False))

def judge_reasoning(raw):
    """3-shot majority on reasoning_tokens > 0. >=2/3 -> true; else false_model."""
    shots = raw.get('shots') or []
    if not shots:
        # legacy single-shot fallback
        if raw.get('status') != 200:
            return ('false_other', 'status ' + str(raw.get('status')))
        usage = raw.get('usage') or {}
        ctd = usage.get('completion_tokens_details') or {}
        rt = ctd.get('reasoning_tokens') or 0
        if rt > 0:
            return ('true', 'single-shot reasoning_tokens = ' + str(rt))
        return ('false_model', 'single-shot reasoning_tokens = 0')
    pos = 0; tot = 0; breakdown = []
    for s in shots:
        st = s.get('status')
        usage = s.get('usage') or {}
        ctd = usage.get('completion_tokens_details') or {}
        rt = ctd.get('reasoning_tokens') or 0
        breakdown.append('shot' + str(s.get('shot')) + ':st=' + str(st) + ',rt=' + str(rt))
        if st != 200:
            continue
        tot += 1
        if rt and rt > 0:
            pos += 1
    if tot == 0:
        return ('false_other', '0 shots with status=200 in ' + str(len(shots)) + ': [' + ', '.join(breakdown) + ']')
    if pos >= 2:
        return ('true', str(pos) + '/' + str(tot) + ' shots had reasoning_tokens > 0: [' + ', '.join(breakdown) + ']')
    return ('false_model', str(pos) + '/' + str(tot) + ' shots had reasoning_tokens > 0: [' + ', '.join(breakdown) + ']')

# Code-level multimodal refusal-phrase detection for fallback when LLM judge is inconclusive
MM_REFUSAL_PHRASES = {
    'image_input': [
        # direct refusals
        'no image attached', 'no image is attached', 'no image provided', 'no image has been provided',
        'no image visible', "i do not see", "i don't see", "i cannot see", "i can't see",
        'cannot view the image', 'cannot process the image', 'cannot describe the image',
        'please upload', 'please attach', 'please provide', "i'm unable to see", 'unable to view', 'unable to see',
        'no picture', 'image is not available', 'image has not been provided',
        # softer variants (paraphrase): we have not been given / haven't seen
        'we have not been provided', 'has not been provided', 'have not been given',
        "haven't seen any image", "haven't been provided",
        "no image is provided", "no image in the conversation", "no image has been attached",
        "there's no attached image", "no attached image", "no image attached to",
        "we cannot view the image", "we cannot see the image", "we cannot describe",
        "as we can't see", "as we cannot see", "i'm not able to see",
        # contraction forms (M2.7/M2.7hs use 'haven't / hasn't / wasn't')
        "haven't provided", "haven't been provided", "hasn't been provided",
        "haven't seen any", "we haven't seen", "i haven't been",
        "haven't received", "haven't been given",

    ],
    'audio_input': [
        'no audio attached', 'no audio file', 'no audio provided', 'no audio has been', 'no audio file attached',
        "i do not hear", "i don't hear", "i cannot hear", 'cannot process audio',
        'audio is not available', 'no audio was attached',
    ],
    'video_input': [
        'no video attached', 'no video file', 'no video provided', 'no video has been',
        'no video link', "i do not see any video", "i don't see any video", "i cannot view the video",
        'cannot process video', 'video is not available', 'video is missing', 'no video in the conversation',
        "i don't have the ability to view", 'i am unable to view videos', 'cannot view videos',
    ],
}

def _fixture_refuses(response_text, cap):
    if not response_text:
        return False
    # Normalize curly quotes to ASCII so phrase matches survive smart-quote variations.
    norm = response_text.replace(chr(0x2019), chr(39)).replace(chr(0x2018), chr(39)).replace(chr(0x201C), chr(34)).replace(chr(0x201D), chr(34))
    low = norm.lower()
    for phrase in MM_REFUSAL_PHRASES.get(cap, []):
        if phrase in low:
            return True
    return False

def _fixture_has_substantive(response_text):
    """Strip  ̈think...  ̈ blocks; require >=20 chars of actual description in the body."""
    if not response_text:
        return False
    body = response_text
    open_tag  = "<"+ "think"
    close_tag = "<"+ "/think"
    while True:
        a = body.find(open_tag)
        if a < 0: break
        b = body.find(close_tag, a + len(open_tag))
        if b < 0: break
        body = body[:a] + body[b + len(close_tag):]
    return len(body.strip()) >= 20

def code_judge_multimodal(cap, raw):
    """Code-level fallback: per-fixture verdict + multi-fixture aggregation. Handles both shapes: image with {fixtures:[...]} and audio/video with {status, response_text}."""
    fixtures = raw.get('fixtures')
    if fixtures is None:
        # Audio/video raw shape: synthesize a single fixture from direct fields
        st = raw.get('status')
        if st is None and 'error_code' in raw and raw.get('response_text') is None:
            st = 400 if raw.get('error_code') else 200
        if st is None:
            st = 0
        fixtures = [{'name': cap + '_single', 'status': st, 'response_text': raw.get('response_text', '') or '', 'error_code': raw.get('error_code')}]
    verdicts = []
    for f in fixtures:
        st = f.get('status')
        if st is None or st == 0:
            verdicts.append(('false_other', f.get('name') + ': status=0 (network?)'))
            continue
        if 400 <= st < 500:
            verdicts.append(('false_upstream', f.get('name') + ': status=' + str(st)))
            continue
        if 500 <= st < 600:
            verdicts.append(('false_other', f.get('name') + ': server 5xx=' + str(st) + ' (overload/transient)'))
            continue
        txt = f.get('response_text') or ''
        if _fixture_refuses(txt, cap):
            verdicts.append(('false_model', f.get('name') + ': refusal phrase in 200 response'))
            continue
        if _fixture_has_substantive(txt):
            verdicts.append(('true', f.get('name') + ': substantive description (status=200)'))
            continue
        verdicts.append(('inconclusive', f.get('name') + ': status=200 but no substantive content'))
    # Aggregate
    if any(v[0] == 'true' for v in verdicts):
        return ('true', 'code-fallback: ' + ' / '.join(v[0]+':'+v[1] for v in verdicts))
    if any(v[0] == 'false_model' for v in verdicts):
        return ('false_model', 'code-fallback: ' + ' / '.join(v[0]+':'+v[1] for v in verdicts))
    if verdicts and all(v[0] == 'false_upstream' for v in verdicts):
        return ('false_upstream', 'code-fallback: ' + ' / '.join(v[0]+':'+v[1] for v in verdicts))
    if verdicts and all(v[0] == 'inconclusive' for v in verdicts):
        return ('inconclusive', 'code-fallback: all ambiguous (model response too short to decide)')
    return ('false_other', 'code-fallback: mixed/empty verdicts: ' + str(verdicts))

def judge_tool_type(raw, target_cap):
    if raw['status'] >= 400:
        return ('false_upstream', 'status ' + str(raw['status']))
    if raw['status'] != 200:
        return ('false_other', 'status ' + str(raw['status']))
    tcs = raw.get('tool_calls') or []
    if not tcs:
        return ('false_model', 'status 200 but no tool_calls')
    patterns = TOOL_NAME_PATTERNS.get(target_cap, [target_cap])
    for tc in tcs:
        if not isinstance(tc, dict):
            continue
        if tc.get('type') == target_cap:
            return ('true', 'tool_calls has type=' + target_cap)
        fn = tc.get('function') or {}
        name = (fn.get('name') or '').lower()
        for p in patterns:
            if p in name:
                return ('true', 'tool_calls has function name containing ' + p)
    fn_names = [tc.get('function', {}).get('name', '') for tc in tcs if isinstance(tc, dict)]
    return ('false_model', 'tool_calls exist but none match ' + target_cap + ': ' + json.dumps(fn_names, ensure_ascii=False))

PROMPT_TEMPLATE = '\'You are a STRICT capability judge for the LLM model "%s_MODEL%".\n\'\n\'Below are raw probe results for 3 multimodal capabilities: image_input (2 fixtures), audio_input, video_input.\n\'For EACH capability, classify it as one of:\n\'  - "true": model genuinely processed the input and gave a description of its content (color, shape, text, object, sound, motion, etc.)\n\'  - "false_model": API accepted the request (status=200) but the model responded with a REFUSAL like "I do not see an image attached" or "no audio was attached" or "I cannot view the video" -- the model did not process the input even though the API would have allowed it.\n\'  - "false_upstream": API rejected the request (status>=400) -- the gateway/upstream does not accept this input format. The model never had a chance to try. NOTE: this is PROVIDER-SPECIFIC. Another provider might accept the same input format.\n\'  - "false_other": any other failure (network, malformed, etc.)\n\'  - "inconclusive": you cannot tell from the data\n\'\n\'IMPORTANT: MULTI-FIXTURE COMBINATION RULE\n\'- image_input uses 2 fixtures (RED_PNG + GREEN_CIRCLE); audio/video use 1 fixture each.\n\'- Per-fixture verdict logic:\n\'  * status>=400 on a fixture --> that fixture is false_upstream\n\'  * status=200 + refusal text on a fixture --> that fixture is false_model\n\'  * status=200 + substantive description on a fixture --> that fixture is true\n\'- Overall verdict (the value of image_input / audio_input / video_input):\n\'  * If ANY fixture is true  -->  "true" (capability confirmed)\n\'  * Else if ANY fixture is false_model  -->  "false_model"\n\'  * Else if ALL fixtures are false_upstream  -->  "false_upstream" (provider does not accept this format)\n\'  * Else  -->  "false_other"\n\'- In reasoning_per_capability, give per-fixture breakdown so user sees which fixtures worked and which did not.\n\'\n\'POSITIVE EXAMPLES\n\'- true (image): status=200, response says "the image shows a red square with the word RED in white text in the center"\n\'- true (audio): status=200, response says "the audio sounds like a 440 Hz sine wave tone"\n\'- true (video): status=200, response describes frames, motion, or content of the video\n\'\n\'NEGATIVE EXAMPLES (refusals -- false_model)\n\'- false_model (image): response says "I am sorry, but I do not see an image attached to your message" -- refusal\n\'- false_model (image): response says "there is no image provided" / "no image is attached" / "I cannot view the image" / "please upload" -- all refusals\n\'- false_model (audio): response says "no audio was attached" / "I cannot process audio" -- refusal\n\'- false_model (video): response says "no video link" / "I do not see any video" / "video is missing" -- refusal\n\'\n\'NEGATIVE EXAMPLES (upstream rejection -- false_upstream)\n\'- false_upstream: status=400, error body has code like "unsupported_media_type" or "invalid_request_error" related to input format\n\'\n\'EDGE CASES (mark as inconclusive)\n\'- response is confident but generic ("the image looks great") with no specific detail\n\'- status=200, response is empty or only contains a thinking block with no actual answer\n\'- response contradicts itself (refuses but also gives description)\n\'\n\'ANTI-BIAS\n\'- Judge only the data below. Do not give credit for capabilities not demonstrated.\n\'- If status>=400 the answer is ALWAYS false_upstream (or false_other), never true.\n\'- If status=200 and response is a refusal pattern, it is false_model, NOT true.\n\'\n\'PROBE DATA (JSON)\n%s_PROBE_DATA%\n\'\n\'OUTPUT FORMAT (JSON only, no commentary, no markdown fences)\n\'{\n\'  "image_input": "true" | "false_model" | "false_upstream" | "false_other" | "inconclusive",\n\'  "audio_input": "true" | "false_model" | "false_upstream" | "false_other" | "inconclusive",\n\'  "video_input": "true" | "false_model" | "false_upstream" | "false_other" | "inconclusive",\n\'  "per_fixture": {\n\'    "image_input": [\n\'      {"name": "RED_PNG", "status": <int>, "verdict": "true|false_model|false_upstream|false_other"},\n\'      {"name": "GREEN_CIRCLE", "status": <int>, "verdict": "..."}\n\'    ],\n\'    "audio_input": [{"name": "AUDIO_WAV", "status": <int>, "verdict": "..."}],\n\'    "video_input": [{"name": "VIDEO_MP4", "status": <int>, "verdict": "..."}]\n\'  },\n\'  "reasoning_per_capability": {\n\'    "image_input": "per-fixture breakdown explaining RED_PNG and GREEN_CIRCLE separately",\n\'    "audio_input": "...",\n\'    "video_input": "..."\n\'  }\n\'}'


def call_multimodal_judge(judge_model, base_url, api_key, target_model, mm_raw):
    probe_data_json = json.dumps(mm_raw, ensure_ascii=False, indent=2)
    prompt = PROMPT_TEMPLATE.replace('%s_MODEL%', target_model).replace('%s_PROBE_DATA%', probe_data_json)
    body = {'model': judge_model, 'messages': [{'role':'user','content':prompt}], 'max_tokens': 1500, 'temperature': 0.0}
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
            parsed = parse_judge_response(content)
            return {'ok': parsed is not None, 'elapsed': elapsed, 'judgment': parsed, 'raw': content}
    except Exception as e:
        return {'ok': False, 'elapsed': 0, 'err': str(e)}

def parse_judge_response(content):
    """Robust JSON parse with fallbacks."""
    # 1) direct parse
    try:
        return json.loads(content)
    except Exception:
        pass
    # 2) triple-backtick block
    BT = chr(96)
    m = re.search(BT + BT + BT + r'(?:json)?\s*([\s\S]*?)' + BT + BT + BT, content)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    # 3) largest { ... } block
    m = re.search(r'\{[\s\S]*\}', content)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    # 4) field-level fallback using string find (avoids broken regex in source)
    out = {}
    DQ = chr(34)
    for cap in ['image_input', 'audio_input', 'video_input']:
        key = DQ + cap + DQ + ': ' + DQ
        i = content.find(key)
        if i >= 0:
            j2 = content.find(DQ, i + len(key))
            if j2 > 0:
                out[cap] = content[i + len(key):j2]
    # reasoning_per_capability block
    rpc_key = DQ + 'reasoning_per_capability' + DQ + ': '
    k = content.find(rpc_key)
    if k >= 0:
        so = content.find(chr(123), k)
        eo = content.find(chr(125), so) if so > 0 else -1
        if so > 0 and eo > 0:
            inner = content[so+1:eo]
            r = {}
            for cap in ['image_input', 'audio_input', 'video_input']:
                key = DQ + cap + DQ + ': ' + DQ
                i = inner.find(key)
                if i >= 0:
                    j2 = inner.find(DQ, i + len(key))
                    if j2 > 0:
                        r[cap] = inner[i + len(key):j2]
            out['reasoning_per_capability'] = r
    return out if out else None
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--judge-model', default=None, help='Override judge model. Default: self-eval.')
    ap.add_argument('--target', action='append', default=[], help='Target model name. Repeatable.')
    args = ap.parse_args()

    cfg = load_provider()
    print('Base URL:', cfg['base_url'])
    targets = args.target if args.target else [m['model'] for m in cfg['models']]
    print('Targets :', targets)
    print('Judge   :', '(self-eval)' if not args.judge_model else args.judge_model)
    print()

    CAPS_DISPLAY = ['text', 'image_input', 'audio_input', 'video_input',
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
        print('  probe phase: ' + str(round(probe_elapsed, 1)) + 's')

        judgments = {}
        judgments['text']          = judge_text(raw['text'])
        judgments['function_call'] = judge_function_call(raw['function_call'])
        judgments['reasoning']     = judge_reasoning(raw['reasoning'])
        judgments['web_search']    = judge_tool_type(raw['web_search'],    'web_search')
        judgments['file_search']   = judge_tool_type(raw['file_search'],   'file_search')
        judgments['computer_use']  = judge_tool_type(raw['computer_use'], 'computer_use')
        judgments['tool_search']   = judge_tool_type(raw['tool_search'],  'tool_search')
        judgments['mcp']           = judge_tool_type(raw['mcp'],          'mcp')

        mm_raw = {k: raw[k] for k in ['image_input', 'audio_input', 'video_input']}
        t0 = time.time()
        result = call_multimodal_judge(judge_model, cfg['base_url'], cfg['api_key'], target, mm_raw)
        judge_elapsed = time.time() - t0
        print('  judge phase: ' + str(round(judge_elapsed, 1)) + 's')

        if result['ok'] and result['judgment']:
            j = result['judgment']
            for k in ['image_input', 'audio_input', 'video_input']:
                v = j.get(k)
                if v in ('true', 'false_model', 'false_upstream', 'false_other'):
                    judgments[k] = (v, j.get('reasoning_per_capability', {}).get(k, ''))
                else:
                    statuses = [f.get('status') for f in raw[k].get('fixtures', [])] if 'fixtures' in raw[k] else [raw[k].get('status')]
                    all_4xx = bool(statuses) and all(s and 400 <= s < 500 for s in statuses)
                    any_5xx = any(s and 500 <= s < 600 for s in statuses)
                    if all_4xx:
                        judgments[k] = ('false_upstream', 'all fixtures 4xx')
                    elif any_5xx:
                        judgments[k] = ('false_other', 'server 5xx (overload/transient): ' + repr(statuses))
                    else:
                        code_v, code_why = code_judge_multimodal(k, raw[k])
                        judgments[k] = (code_v, 'LLM inconclusive -> ' + code_why)
            # 打印 per-fixture
            pf = j.get('per_fixture', {})
            for cap in ['image_input', 'audio_input', 'video_input']:
                fxs = pf.get(cap, [])
                if fxs:
                    print('  per_fixture ' + cap + ':')
                    for fx in fxs:
                        print('    ' + str(fx.get('name', '?')) + ' status=' + str(fx.get('status', '?')) + ' verdict=' + str(fx.get('verdict', '?')))
        else:
            err = result.get('err', 'JSON parse failed')
            print('  judge FAILED: ' + str(err))
            for k in ['image_input', 'audio_input', 'video_input']:
                statuses = [f.get('status') for f in raw[k].get('fixtures', [])] if 'fixtures' in raw[k] else [raw[k].get('status')]
                # Distinguish 4xx (true upstream rejection) from 5xx (server/overload).
                all_4xx = bool(statuses) and all(s and 400 <= s < 500 for s in statuses)
                any_5xx = any(s and 500 <= s < 600 for s in statuses)
                if all_4xx:
                    judgments[k] = ('false_upstream', 'all fixtures 4xx (fallback)')
                elif any_5xx:
                    judgments[k] = ('false_other', 'server 5xx (overload/transient): ' + repr(statuses))
                else:
                    # LLM judge parse-failed but raw has 200s -> use code-level refusal detection.
                    code_v, code_why = code_judge_multimodal(k, raw[k])
                    judgments[k] = (code_v, 'LLM parse-failed -> ' + code_why)

        for c in CAPS_DISPLAY:
            v, why = judgments[c]
            mark = {'true': '[+]', 'false_model': '[-M]', 'false_upstream': '[-U]',
                    'false_other': '[-X]', 'inconclusive': '[?]'}.get(v, '[?]')
            print('  ' + mark + ' ' + c.ljust(15) + ' ' + (why or '')[:120])

        all_results[target] = {
            'judge_model': judge_model,
            'probe_elapsed': probe_elapsed,
            'judge_elapsed': judge_elapsed,
            'judgments': {k: list(v) for k, v in judgments.items()},
            'raw': raw,
        }
        print()

    print('=' * 70)
    print('  SUMMARY (v4 hybrid, multi-fixture)')
    print('=' * 70)
    header = 'cap'.ljust(15) + ' | ' + ' | '.join(t[:24].ljust(24) for t in targets)
    print(header)
    print('-' * len(header))
    for c in CAPS_DISPLAY:
        row = c.ljust(15) + ' | '
        for t in targets:
            v = all_results.get(t, {}).get('judgments', {}).get(c, ('',))[0]
            mark = {'true': '+', 'false_model': '-M', 'false_upstream': '-U',
                    'false_other': '-X', 'inconclusive': '?'}.get(v, '?')
            row += mark.ljust(24) + ' | '
        print(row)
    print()
    print('Legend:')
    print('  +  true  -- model genuinely processed input / invoked tool')
    print('  -M false_model  -- API accepted (status=200) but model refused (refusal pattern)')
    print('  -U false_upstream  -- API rejected (status>=400); PROVIDER-specific boundary')
    print('  -X false_other  -- network/parse/other error')
    print('  ?  inconclusive  -- insufficient data to judge')

    out = os.path.join(HERE, 'probe_v4_result.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2, default=str)
    print(chr(10) + 'JSON: ' + out)


if __name__ == '__main__':
    main()
