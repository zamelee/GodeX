#!/usr/bin/env python
# Patch 4: "Provider/选择模型/能力探测 初始高度自适应内容"
# Approach:
#   - CSS makes provider/models/caps default to `flex: 0 0 auto` (content-driven).
#   - Sash gains a `beforeStyle: 'pct' | 'auto'` option; init for 3 sashes uses 'auto'.
#   - On first user drag (_onDown), we promote beforeStyle to 'pct' and apply current
#     layout ratio as N%, so subsequent drag math is consistent.
#   - 'auto' mode _currentRatio() derives from bounding rect (no stored ratio needed).
#   - Sash probe-sash-log still uses 'pct' to control results (which gets flex:0 0 35%).

import os, time
SRC = r'D:\Documents\VibeCoding\GodeX\tools\sash-preview.html'
ts = time.strftime('%Y%m%d_%H%M%S')
BAK = f'{SRC}.bak_4_auto_{ts}'

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

# ----- (A) CSS: provider/models/caps auto, results 35%, log grow -----
css_anchor = '.layout-probe .probe-section{flex:0 0 auto;min-height:60px;display:flex;flex-direction:column;gap:6px}'
css_addon = css_anchor + '\n.layout-probe #probe-section-provider,\n.layout-probe #probe-section-models,\n.layout-probe #probe-section-caps { flex: 0 0 auto; min-height: 60px; }\n.layout-probe #probe-section-results { flex: 0 0 35%; }\n.layout-probe #probe-section-log { flex: 1 1 0; min-height: 100px; }'
if must(css_anchor, 'css anchor'):
    s = s.replace(css_anchor, css_addon)

# ----- (B) Sash: constructor takes beforeStyle, default 'pct' -----
old_sig = '''class Sash {
  constructor({sashEl, beforeEl, afterEl, dir, storageKey, minBefore=80, minAfter=80, defaultRatio=0.5, mode="pct"}) {'''
new_sig = '''class Sash {
  constructor({sashEl, beforeEl, afterEl, dir, storageKey, minBefore=80, minAfter=80, defaultRatio=0.5, mode="pct", beforeStyle="pct"}) {'''
if must(old_sig, 'Sash constructor sig'):
    s = s.replace(old_sig, new_sig)

# Add field assignment inside constructor (after this.mode = mode;)
old_init = '    this.mode = mode;\n    this.container = sashEl.parentElement;'
new_init = '    this.mode = mode;\n    this.beforeStyle = beforeStyle;\n    this.container = sashEl.parentElement;'
if must(old_init, 'Sash ctor fields'):
    s = s.replace(old_init, new_init)

# ----- (C) applyRatio respects beforeStyle -----
old_apply = '''  applyRatio(ratio, persist=true) {
    const r = Math.max(0.05, Math.min(0.95, ratio));
    if (this.mode === "px") {
      const total = this.dir === "v" ? this.container.clientWidth : this.container.clientHeight;
      const px = Math.round(r * total);
      this.before.style.flex = `0 0 ${px}px`;
      this.after.style.flex = "1 1 0";
    } else if (this.dir === "v") {
      this.before.style.flex = `0 0 ${(r*100).toFixed(2)}%`;
      this.after.style.flex = "1 1 0";
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
if must(old_apply, 'applyRatio body'):
    s = s.replace(old_apply, new_apply)

# ----- (D) _currentRatio: in auto mode derive from layout -----
old_cur = '''  _currentRatio() {
    // 2D: prefer the last ratio we actually applied (same denominator as
    // flex-basis: N%, which uses the container's clientHeight/clientWidth).
    // Falls back to defaultRatio before the first applyRatio() call.
    if (typeof this._lastRatio === "number") return this._lastRatio;
    return this.defaultRatio;
  }'''
new_cur = '''  _currentRatio() {
    // pct mode: prefer the last ratio we applied (denominator matches flex-basis: N%).
    // auto mode or pre-init: derive from actual layout (content-driven auto).
    if (typeof this._lastRatio === "number" && this.beforeStyle === "pct") {
      return this._lastRatio;
    }
    const rect = this.container.getBoundingClientRect();
    const beforeRect = this.before.getBoundingClientRect();
    const totalPx = this.dir === "v" ? rect.width : rect.height;
    const beforePx = this.dir === "v" ? beforeRect.width : beforeRect.height;
    return totalPx > 0 ? beforePx / totalPx : this.defaultRatio;
  }'''
if must(old_cur, '_currentRatio'):
    s = s.replace(old_cur, new_cur)

# ----- (E) _onDown: promote auto -> pct on first user interaction -----
old_down = '''  _onDown(ev) {
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
    // Promote auto -> pct and freeze current layout ratio as explicit %.
    // Without this, an "auto" before would jump on first mousemove.
    if (this.beforeStyle === "auto") {
      this.beforeStyle = "pct";
      this.applyRatio(this._currentRatio(), false);
    }
    this._startRatio = this._currentRatio();
    window.addEventListener("mousemove", this._onMove);
    window.addEventListener("mouseup", this._onUp);
  }'''
if must(old_down, '_onDown'):
    s = s.replace(old_down, new_down)

# ----- (F) initSashes: 3 probe sashes use beforeStyle='auto' -----
# probe-sash-models
old_p1 = '''    sashEl: $("probe-sash-models"), beforeEl: $("probe-section-provider"), afterEl: $("probe-section-models"),
    dir: "h", storageKey: "sash-preview.probeModelsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.09,'''
new_p1 = '''    sashEl: $("probe-sash-models"), beforeEl: $("probe-section-provider"), afterEl: $("probe-section-models"),
    dir: "h", storageKey: "sash-preview.probeModelsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.09, beforeStyle: "auto",'''
if must(old_p1, 'sash-models init'):
    s = s.replace(old_p1, new_p1)

# probe-sash-caps
old_p2 = '''    sashEl: $("probe-sash-caps"), beforeEl: $("probe-section-models"), afterEl: $("probe-section-caps"),
    dir: "h", storageKey: "sash-preview.probeCapsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.20,'''
new_p2 = '''    sashEl: $("probe-sash-caps"), beforeEl: $("probe-section-models"), afterEl: $("probe-section-caps"),
    dir: "h", storageKey: "sash-preview.probeCapsRatio", minBefore: 60, minAfter: 60, defaultRatio: 0.20, beforeStyle: "auto",'''
if must(old_p2, 'sash-caps init'):
    s = s.replace(old_p2, new_p2)

# probe-sash-results
old_p3 = '''    sashEl: $("probe-sash-results"), beforeEl: $("probe-section-caps"), afterEl: $("probe-section-results"),
    dir: "h", storageKey: "sash-preview.probeResultsRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.16,'''
new_p3 = '''    sashEl: $("probe-sash-results"), beforeEl: $("probe-section-caps"), afterEl: $("probe-section-results"),
    dir: "h", storageKey: "sash-preview.probeResultsRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.16, beforeStyle: "auto",'''
if must(old_p3, 'sash-results init'):
    s = s.replace(old_p3, new_p3)

# probe-sash-log: keep beforeStyle='pct', bump defaultRatio 0.28 -> 0.35
old_p4 = '''    sashEl: $("probe-sash-log"), beforeEl: $("probe-section-results"), afterEl: $("probe-section-log"),
    dir: "h", storageKey: "sash-preview.probeLogRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.28,'''
new_p4 = '''    sashEl: $("probe-sash-log"), beforeEl: $("probe-section-results"), afterEl: $("probe-section-log"),
    dir: "h", storageKey: "sash-preview.probeLogRatio", minBefore: 80, minAfter: 80, defaultRatio: 0.35,'''
if must(old_p4, 'sash-log init'):
    s = s.replace(old_p4, new_p4)

if errs:
    print('ERRORS:'); [print(' ', e) for e in errs]; raise SystemExit(1)

with open(SRC, 'w', encoding='utf-8') as f:
    f.write(s)
print('patched OK')
print('contains beforeStyle:', 'beforeStyle' in s)
print('contains auto-flex:',  '"auto"' in s)
print('contains #probe-section-results { flex: 0 0 35%', 'flex: 0 0 35%' in s)
