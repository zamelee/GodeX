#!/usr/bin/env python
# Hot-fix: 2D denominator consistency + 1B log breathing room.

import os
SRC = r'D:\Documents\VibeCoding\GodeX\tools\sash-preview.html'
with open(SRC, 'r', encoding='utf-8') as f:
    s = f.read()

# === 2D: store last applied ratio so _currentRatio() returns the same denominator ===
# Update applyRatio to record _lastRatio
old_apply_tail = '''    if (persist) localStorage.setItem(this.storageKey, String(r));
  }'''
new_apply_tail = '''    this._lastRatio = r;            // 2D: cache so _currentRatio matches this same denominator
    if (persist) localStorage.setItem(this.storageKey, String(r));
  }'''
assert old_apply_tail in s, 'applyRatio tail not found'
s = s.replace(old_apply_tail, new_apply_tail)

# Update _currentRatio to use cached value (falls back to defaultRatio at first call)
old_cur = '''  _currentRatio() {
    const rect = this.container.getBoundingClientRect();
    const beforeRect = this.before.getBoundingClientRect();
    const totalPx = this.dir === "v" ? rect.width : rect.height;
    const beforePx = this.dir === "v" ? beforeRect.width : beforeRect.height;
    return totalPx > 0 ? beforePx / totalPx : this.defaultRatio;
  }'''
new_cur = '''  _currentRatio() {
    // 2D: prefer the last ratio we actually applied (same denominator as
    // flex-basis: N%, which uses the container's clientHeight/clientWidth).
    // Falls back to defaultRatio before the first applyRatio() call.
    if (typeof this._lastRatio === "number") return this._lastRatio;
    return this.defaultRatio;
  }'''
assert old_cur in s, '_currentRatio not found'
s = s.replace(old_cur, new_cur)

# === 1B: re-balance so log gets ~20% of probe layout ===
# Total defaultRatio sum was 0.80; reduce to ~0.74 so log auto-grow has more room.
new_ratios = [
    ('probeModelsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.10',
     'probeModelsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.09'),
    ('probeCapsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.22',
     'probeCapsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.20'),
    ('probeResultsRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.18',
     'probeResultsRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.16'),
    ('probeLogRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.30',
     'probeLogRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.28'),
]
for old, new in new_ratios:
    assert old in s, f'NOT FOUND: {old[:50]}'
    s = s.replace(old, new)

with open(SRC, 'w', encoding='utf-8') as f:
    f.write(s)
print('hotfix applied: 2D denominator + 1B rebalance')
