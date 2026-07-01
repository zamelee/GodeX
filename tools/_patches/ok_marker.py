#!/usr/bin/env python
# Mark current sash-preview.html as confirmed-working copy.
# Uses git style: <src>.OK_<YYYYMMDD_HHMMSS>.html (BOM-free UTF-8).

import os, time, shutil, hashlib

SRC = r'D:\Documents\VibeCoding\GodeX\tools\sash-preview.html'
ts  = time.strftime('%Y%m%d_%H%M%S')
DST = f'{SRC}.OK_{ts}.html'

with open(SRC, 'rb') as f:
    data = f.read()
sha = hashlib.sha256(data).hexdigest()[:16]
size = len(data)
with open(DST, 'wb') as f:
    f.write(data)

print(f'OK copy: {DST}')
print(f'  size: {size} bytes')
print(f'  sha256 (first 16): {sha}')

# Also write a manifest pointing to the latest
M = r'D:\Documents\VibeCoding\GodeX\tools\sash-preview.MANIFEST.tsv'
line = f'{ts}\t{DST}\t{size}\t{sha}\n'
with open(M, 'a', encoding='utf-8') as f:
    f.write(line)
print(f'  manifest updated: {M}')
