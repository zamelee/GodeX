#!/usr/bin/env python
# Hotfix 4b: compute layout ratio BEFORE promoting auto->pct so the cached
# _lastRatio (from init rAF) doesn't leak into the first explicit value.

import os
SRC = r'D:\Documents\VibeCoding\GodeX\tools\sash-preview.html'
with open(SRC, 'r', encoding='utf-8') as f:
    s = f.read()

# (1) Split layout-derived ratio into its own helper so mousedown can use it
#     BEFORE the promote would change beforeStyle.
old_cur = '''  _currentRatio() {
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
new_cur = '''  _layoutRatio() {
    // Always derive from actual layout (ignores cached _lastRatio).
    // Used both by _currentRatio in auto mode and by _onDown to capture
    // a fresh value before promoting auto -> pct.
    const rect = this.container.getBoundingClientRect();
    const beforeRect = this.before.getBoundingClientRect();
    const totalPx = this.dir === "v" ? rect.width : rect.height;
    const beforePx = this.dir === "v" ? beforeRect.width : beforeRect.height;
    return totalPx > 0 ? beforePx / totalPx : this.defaultRatio;
  }
  _currentRatio() {
    // pct mode: prefer the last explicit ratio we applied (denominator matches flex-basis: N%).
    // auto mode: derive from actual layout (content-driven); a stale cached _lastRatio
    //   from init must NOT leak in here, so we explicitly use the layout path.
    if (this.beforeStyle === "pct" && typeof this._lastRatio === "number") {
      return this._lastRatio;
    }
    return this._layoutRatio();
  }'''
assert old_cur in s, '_currentRatio not found'
s = s.replace(old_cur, new_cur)

# (2) _onDown: compute layout-derived ratio BEFORE promoting auto->pct
old_down = '''    if (this.beforeStyle === "auto") {
      this.beforeStyle = "pct";
      this.applyRatio(this._currentRatio(), false);
    }
    this._startRatio = this._currentRatio();'''
new_down = '''    if (this.beforeStyle === "auto") {
      // Capture layout-derived ratio BEFORE switching to pct — otherwise the
      // stale _lastRatio (from init rAF applyRatio with defaultRatio) leaks in.
      const layoutR = this._layoutRatio();
      this.beforeStyle = "pct";
      this.applyRatio(layoutR, false);
    }
    this._startRatio = this._currentRatio();'''
assert old_down in s, '_onDown promote block not found'
s = s.replace(old_down, new_down)

# (3) Reset button: also flip beforeStyle back to 'auto' so a user-promoted sash
#     fully reverts to CSS auto (not just clears localStorage).
old_reset = '''function resetAllRatios() {
  for (const s of _godexSashes) {
    localStorage.removeItem(s.storageKey);
    s.applyRatio(s.defaultRatio, false);
  }
  updateHeights();
}'''
new_reset = '''function resetAllRatios() {
  for (const s of _godexSashes) {
    localStorage.removeItem(s.storageKey);
    // For sash with beforeStyle!="pct" (i.e. init-mode auto), restore auto so
    // CSS controls height again; otherwise just re-apply the default ratio.
    if (s.beforeStyle !== "pct") {
      s.applyRatio(s.defaultRatio, false);
    } else {
      s.beforeStyle = "auto";
      s.applyRatio(s.defaultRatio, false);
    }
  }
  updateHeights();
}'''
assert old_reset in s, 'resetAllRatios not found'
s = s.replace(old_reset, new_reset)

with open(SRC, 'w', encoding='utf-8') as f:
    f.write(s)
print('hotfix applied: 4b')
