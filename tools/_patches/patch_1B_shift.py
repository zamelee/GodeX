#!/usr/bin/env python
# Hotfix 1B correctness: shift defaultRatio to the right beforeEl.
# Sash applyRatio sets beforeEl style.flex = 0 0 N%, so:
#   probe-sash-models.before = probe-section-provider
#   probe-sash-caps.before   = probe-section-models
#   probe-sash-results.before= probe-section-caps
#   probe-sash-log.before    = probe-section-results
# To achieve visual target (provider 0.10, models 0.22, caps 0.18, results 0.30, log ~0.20):
#   probe-sash-models   defaultRatio: 0.10
#   probe-sash-caps     defaultRatio: 0.22
#   probe-sash-results  defaultRatio: 0.18
#   probe-sash-log      defaultRatio: 0.30

import os
SRC = r'D:\Documents\VibeCoding\GodeX\tools\sash-preview.html'
with open(SRC, 'r', encoding='utf-8') as f:
    s = f.read()

subs = [
    # models -> 0.10
    ('sash-preview.probeModelsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.22',
     'sash-preview.probeModelsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.10'),
    # caps -> 0.22
    ('sash-preview.probeCapsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.18',
     'sash-preview.probeCapsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.22'),
    # results -> 0.18
    ('sash-preview.probeResultsRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.30',
     'sash-preview.probeResultsRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.18'),
    # log -> 0.30
    ('sash-preview.probeLogRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.20',
     'sash-preview.probeLogRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.30'),
]

for old, new in subs:
    assert old in s, f'NOT FOUND: {old[:60]}'
    s = s.replace(old, new)

with open(SRC, 'w', encoding='utf-8') as f:
    f.write(s)
print('shifted defaultRatio to match visual target')
