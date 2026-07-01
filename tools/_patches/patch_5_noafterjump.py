#!/usr/bin/env python
# Patch 5: kill "mousedown instant jump" by not writing after.style.flex.
#   - CSS: .form-section gains `flex: 1 1 auto` so studio-fs-models grows in col-right
#     even when sash.applyRatio no longer sets its inline flex.
#   - Sash.applyRatio: remove every `this.after.style.flex = "1 1 0"` write.
#     after's grow/auto behavior is now purely CSS-defined, so mousedown alone
#     never causes the section below the sash to abruptly resize.

import os, time
SRC = r'D:\Documents\VibeCoding\GodeX\tools\sash-preview.html'
ts = time.strftime('%Y%m%d_%H%M%S')
BAK = f'{SRC}.bak_5_noafterjump_{ts}'

with open(SRC, 'r', encoding='utf-8') as f:
    s = f.read()
with open(BAK, 'w', encoding='utf-8') as f:
    f.write(s)
print(f'backup: {BAK}')

errs = []
def must(old, label):
    if old not in s:
        errs.append(f'NOT FOUND: {label}'); return False
    return True

# (1) CSS: form-section grows so sash-forms after (fs-models) still fills col-right
old_fs = '.form-section{background:var(--bg);border:1px solid var(--border);padding:8px;display:flex;flex-direction:column;overflow:auto;font-size:11px}'
new_fs = '.form-section{flex:1 1 auto;background:var(--bg);border:1px solid var(--border);padding:8px;display:flex;flex-direction:column;overflow:auto;font-size:11px}'
if must(old_fs, 'form-section CSS'):
    s = s.replace(old_fs, new_fs)

# (2) Sash.applyRatio: stop writing after.style.flex entirely
old_apply = '''  applyRatio(ratio, persist=true) {
    const r = Math.max(0.05, Math.min(0.95, ratio));
    if (this.mode === "px") {
      const total = this.dir === "v" ? this.container.clientWidth : this.container.clientHeight;
      const px = Math.round(r * total);
      this.before.style.flex = `0 0 ${px}px`;
      this.after.style.flex = "1 1 0";
    } else if (this.beforeStyle === "auto") {
      // auto: leave CSS to size it (defaultRatio applies only on Reset)
      this.before.style.flex = "";
      this.after.style.flex = "";
    } else {
      this.before.style.flex = `0 0 ${(r*100).toFixed(2)}%`;
      this.after.style.flex = "1 1 0";
    }
    this._lastRatio = r;            // 2D: cache so _currentRatio matches this same denominator
    if (persist) localStorage.setItem(this.storageKey, String(r));
  }'''
new_apply = '''  applyRatio(ratio, persist=true) {
    const r = Math.max(0.05, Math.min(0.95, ratio));
    if (this.mode === "px") {
      const total = this.dir === "v" ? this.container.clientWidth : this.container.clientHeight;
      const px = Math.round(r * total);
      this.before.style.flex = `0 0 ${px}px`;
      // After: deliberately NOT written. CSS (grow / auto) controls its size,
      // so mousedown alone never causes the section below the sash to jump.
    } else if (this.beforeStyle === "auto") {
      // auto: leave CSS to size it (defaultRatio applies only on Reset)
      this.before.style.flex = "";
    } else {
      this.before.style.flex = `0 0 ${(r*100).toFixed(2)}%`;
      // Same: don't touch after.
    }
    this._lastRatio = r;            // 2D: cache so _currentRatio matches this same denominator
    if (persist) localStorage.setItem(this.storageKey, String(r));
  }'''
if must(old_apply, 'applyRatio body'):
    s = s.replace(old_apply, new_apply)

if errs:
    print('ERRORS:'); [print(' ', e) for e in errs]; raise SystemExit(1)

with open(SRC, 'w', encoding='utf-8') as f:
    f.write(s)
print('patched OK')
