#!/usr/bin/env python
# Patch sash-preview.html: 1B / 2D / 3-cap-zh
# 1B: defaultRatio probe layout (provider auto, models 0.22, caps 0.18, results 0.30, log 0.20)
# 2D: relative tracking (no first-mousemove jump)
# 3:   cap checkboxes show Chinese annotation underneath (cap-top + cap-zh)

import os, sys, time

TOOLS = r'D:\Documents\VibeCoding\GodeX\tools'
SRC   = os.path.join(TOOLS, 'sash-preview.html')
PATCH_DIR = os.path.join(TOOLS, '_patches')

ts = time.strftime('%Y%m%d_%H%M%S')
BAK = f'{SRC}.bak_1B2D3_{ts}'

with open(SRC, 'r', encoding='utf-8') as f:
    s = f.read()
with open(BAK, 'w', encoding='utf-8') as f:
    f.write(s)
print(f'backup: {BAK}')

errs = []
def must_replace(needle, label):
    if needle not in s:
        errs.append(f'NOT FOUND: {label}')
        return False
    return True

# ----- 1B: defaultRatio -----
ratio_subs = [
    ('sash-preview.probeModelsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.18',
     'sash-preview.probeModelsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.22'),
    ('sash-preview.probeCapsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.18',
     'sash-preview.probeCapsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.18'),  # unchanged
    ('sash-preview.probeResultsRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.24',
     'sash-preview.probeResultsRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.30'),
    ('sash-preview.probeLogRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.3',
     'sash-preview.probeLogRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.20'),
]
for old, new in ratio_subs:
    if not must_replace(old, 'ratio'): continue
    s = s.replace(old, new)

# ----- 2D: relative tracking -----
old_down = '''  _onDown(ev) {
    ev.preventDefault();
    this.dragging = true;
    this.sash.classList.add("dragging");
    document.body.style.cursor = this.dir === "v" ? "col-resize" : "row-resize";
    window.addEventListener("mousemove", this._onMove);
    window.addEventListener("mouseup", this._onUp);
  }'''
new_down = '''  _onDown(ev) {
    ev.preventDefault();
    this.dragging = true;
    this.sash.classList.add("dragging");
    document.body.style.cursor = this.dir === "v" ? "col-resize" : "row-resize";
    // 2D: capture anchor (mouse + current ratio) so first mousemove
    // does NOT jump the sash to wherever the cursor happens to be.
    this._startX = ev.clientX;
    this._startY = ev.clientY;
    this._startRatio = this._currentRatio();
    window.addEventListener("mousemove", this._onMove);
    window.addEventListener("mouseup", this._onUp);
  }
  _currentRatio() {
    const rect = this.container.getBoundingClientRect();
    const beforeRect = this.before.getBoundingClientRect();
    const totalPx = this.dir === "v" ? rect.width : rect.height;
    const beforePx = this.dir === "v" ? beforeRect.width : beforeRect.height;
    return totalPx > 0 ? beforePx / totalPx : this.defaultRatio;
  }'''
if must_replace(old_down, '_onDown'):
    s = s.replace(old_down, new_down)

old_move = '''  _onMove(ev) {
    if (!this.dragging) return;
    const rect = this.container.getBoundingClientRect();
    const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
    let ratio;
    if (this.dir === "v") ratio = (x - rect.left) / rect.width;
    else ratio = (y - rect.top) / rect.height;
    const totalPx = this.dir === "v" ? rect.width : rect.height;
    const minR = this.minBefore / totalPx;
    const maxR = 1 - (this.minAfter / totalPx);
    ratio = Math.max(minR, Math.min(maxR, ratio));
    this.applyRatio(ratio, false);
    document.getElementById('info').textContent = this.sash.id + ': ' + (ratio*100).toFixed(1) + '%';
  }'''
new_move = '''  _onMove(ev) {
    if (!this.dragging) return;
    const rect = this.container.getBoundingClientRect();
    const totalPx = this.dir === "v" ? rect.width : rect.height;
    const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
    // 2D: ratio change = mouse delta / container length, anchored at mousedown.
    const delta = this.dir === "v" ? (x - this._startX) : (y - this._startY);
    let ratio = this._startRatio + delta / totalPx;
    const minR = this.minBefore / totalPx;
    const maxR = 1 - (this.minAfter / totalPx);
    ratio = Math.max(minR, Math.min(maxR, ratio));
    this.applyRatio(ratio, false);
    document.getElementById('info').textContent = this.sash.id + ': ' + (ratio*100).toFixed(1) + '%';
  }'''
if must_replace(old_move, '_onMove'):
    s = s.replace(old_move, new_move)

# ----- 3: cap checkboxes with Chinese subtitle -----
old_cap = '''    <div style="background:var(--bg);border:1px solid var(--border);padding:6px;display:flex;gap:8px 16px;flex-wrap:wrap;font-size:11px">
      <span>\u2610 Context</span><span>\u2610 MaxTokens</span><span>\u2610 Text</span><span>\u2610 Image</span><span>\u2610 Video</span><span>\u2610 Audio</span>
      <span>\u2610 Func</span><span>\u2610 Reason</span><span>\u2610 Computer</span><span>\u2610 ToolSearch</span><span>\u2610 WebSearch</span><span>\u2610 FileSearch</span><span>\u2610 MCP</span>
    </div>'''
# In the source these are actually "\u2610" or "\u2611" depending on checked state.
# Read the actual literal from the source to be safe.
import re
m = re.search(r'<div style="background:var\(--bg\);border:1px solid var\(--border\);padding:6px;display:flex;gap:8px 16px;flex-wrap:wrap;font-size:11px">\s*\n([\s\S]+?)\s*</div>', s)
if not m:
    errs.append('caps HTML block not found (regex)')
else:
    old_cap_real = m.group(0)
    new_cap = '''    <div class="cap-row">
      <div class="cap-item"><div class="cap-top">\u2611 Context</div><div class="cap-zh">\u4e0a\u4e0b\u6587\u7a97\u53e3</div></div>
      <div class="cap-item"><div class="cap-top">\u2611 MaxTokens</div><div class="cap-zh">\u6700\u5927\u8f93\u51fa</div></div>
      <div class="cap-item"><div class="cap-top">\u2611 Text</div><div class="cap-zh">\u6587\u672c</div></div>
      <div class="cap-item"><div class="cap-top">\u2611 Image</div><div class="cap-zh">\u56fe\u7247</div></div>
      <div class="cap-item"><div class="cap-top">\u2612 Video</div><div class="cap-zh">\u89c6\u9891</div></div>
      <div class="cap-item"><div class="cap-top">\u2612 Audio</div><div class="cap-zh">\u97f3\u9891</div></div>
      <div class="cap-item"><div class="cap-top">\u2611 Func</div><div class="cap-zh">\u51fd\u6570\u8c03\u7528</div></div>
      <div class="cap-item"><div class="cap-top">\u2611 Reason</div><div class="cap-zh">\u601d\u7ef4\u94fe</div></div>
      <div class="cap-item"><div class="cap-top">\u2612 Computer</div><div class="cap-zh">\u8ba1\u7b97\u673a\u64cd\u4f5c</div></div>
      <div class="cap-item"><div class="cap-top">\u2612 ToolSearch</div><div class="cap-zh">\u5de5\u5177\u641c\u7d22</div></div>
      <div class="cap-item"><div class="cap-top">\u2612 WebSearch</div><div class="cap-zh">\u7f51\u9875\u641c\u7d22</div></div>
      <div class="cap-item"><div class="cap-top">\u2612 FileSearch</div><div class="cap-zh">\u6587\u4ef6\u641c\u7d22</div></div>
      <div class="cap-item"><div class="cap-top">\u2612 MCP</div><div class="cap-zh">MCP \u670d\u52a1\u5668</div></div>
    </div>'''
    # Use unchecked boxes for ones that were unchecked in source. We approximate by trusting source.
    # Re-resolve checked vs unchecked from source spans
    span_states = re.findall(r'<span>([\u2610\u2611\u2612])\s*([A-Za-z]+)</span>', old_cap_real)
    print('caps detected from source:', span_states)
    # Rebuild with detected check states:
    zh_map = {
        'Context':'上下文窗口','MaxTokens':'最大输出','Text':'文本','Image':'图片',
        'Video':'视频','Audio':'音频','Func':'函数调用','Reason':'思维链',
        'Computer':'计算机操作','ToolSearch':'工具搜索','WebSearch':'网页搜索',
        'FileSearch':'文件搜索','MCP':'MCP 服务器',
    }
    items_html = []
    for mark, name in span_states:
        zh = zh_map.get(name, '')
        items_html.append(f'      <div class="cap-item"><div class="cap-top">{mark} {name}</div><div class="cap-zh">{zh}</div></div>')
    new_cap = '    <div class="cap-row">\n' + '\n'.join(items_html) + '\n    </div>'
    s = s.replace(old_cap_real, new_cap, 1)

# ----- CSS for .cap-row / .cap-item / .cap-top / .cap-zh -----
css_anchor = '.sash-v::before{top:50%;left:50%;transform:translate(-50%,-50%);width:2px;height:36px;border-radius:1px}'
css_addon = css_anchor + '\n.cap-row{display:flex;gap:6px 14px;flex-wrap:wrap;padding:6px;background:var(--bg);border:1px solid var(--border);align-items:flex-start}\n.cap-item{display:flex;flex-direction:column;align-items:center;line-height:1.2;gap:1px}\n.cap-top{font-size:11px;font-weight:600;white-space:nowrap}\n.cap-zh{font-size:10px;color:var(--text2);white-space:nowrap}'
if must_replace(css_anchor, 'css anchor'):
    s = s.replace(css_anchor, css_addon)

if errs:
    print('ERRORS:')
    for e in errs: print(' ', e)
    sys.exit(1)

with open(SRC, 'w', encoding='utf-8') as f:
    f.write(s)

# Save patch log
LOG = os.path.join(PATCH_DIR, f'patch_1B2D3_{ts}.log')
with open(LOG, 'w', encoding='utf-8') as f:
    f.write(f'bak: {BAK}\n')
print(f'patched OK ({len(errs)==0 and "all subs" or "with errors"})')

# Quick summary
with open(SRC, 'r', encoding='utf-8') as f:
    new_s = f.read()
print('new line count:', new_s.count('\n'))
print('contains _currentRatio:', '_currentRatio' in new_s)
print('contains _startRatio: ', '_startRatio'  in new_s)
print('contains .cap-zh:     ', '.cap-zh'      in new_s)
print('defaultRatio 0.22:    ', 'defaultRatio: 0.22' in new_s)
print('defaultRatio 0.30:    ', 'defaultRatio: 0.30' in new_s)
print('defaultRatio 0.20:    ', 'defaultRatio: 0.20' in new_s)
print('cap-row:              ', 'class="cap-row"' in new_s)
