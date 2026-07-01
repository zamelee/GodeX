
const $ = (id) => document.getElementById(id);
const _godexSashes = [];
class Sash {
  constructor({ sashEl, beforeEl, afterEl, dir, storageKey, minBefore = 80, minAfter = 80, defaultRatio = 0.5, mode = "pct" }) {
    this.sash = sashEl;
    this.before = beforeEl;
    this.after = afterEl;
    this.dir = dir; // 'h' (horizontal sash, vertical split) or 'v' (vertical sash, horizontal split)
    this.storageKey = storageKey;
    this.minBefore = minBefore;
    this.minAfter = minAfter;
    this.defaultRatio = defaultRatio;
    this.mode = mode; // "pct" => flex-basis:%; "px" => flex-basis:px
    this.container = sashEl.parentElement;
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onDown = this._onDown.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    sashEl.addEventListener("mousedown", this._onDown);
    sashEl.addEventListener("touchstart", this._onTouchStart, { passive: false });
    // Defer to next frame so the flex layout has computed container size.
    const me = this;
    requestAnimationFrame(() => requestAnimationFrame(() => { me.applyRatio(me._loadRatio(), false); }));
  }
  _loadRatio() {
    const v = parseFloat(localStorage.getItem(this.storageKey));
    if (Number.isFinite(v) && v >= 0.05 && v <= 0.95) return v;
    return this.defaultRatio;
  }
  applyRatio(ratio, persist = true) {
    const r = Math.max(0.05, Math.min(0.95, ratio));
    if (this.mode === "px") {
      const total = this.dir === "v" ? this.container.clientWidth : this.container.clientHeight;
      const px = Math.round(r * total);
      this.before.style.flex = `0 0 ${px}px`;
      this.after.style.flex = "1 1 0";
    } else if (this.dir === "v") {
      this.before.style.flex = `0 0 ${(r * 100).toFixed(2)}%`;
      this.after.style.flex = "1 1 0";
    } else {
      this.before.style.flex = `0 0 ${(r * 100).toFixed(2)}%`;
      this.after.style.flex = "1 1 0";
    }
    if (persist) localStorage.setItem(this.storageKey, String(r));
  }
  _onMove(ev) {
    if (!this.dragging) return;
    const rect = this.container.getBoundingClientRect();
    const pos = (ev.touches ? ev.touches[0].clientY : ev.clientY);
    const pos2 = (ev.touches ? ev.touches[0].clientX : ev.clientX);
    let ratio;
    if (this.dir === "v") {
      ratio = (pos2 - rect.left) / rect.width;
    } else {
      ratio = (pos - rect.top) / rect.height;
    }
    // Enforce minimums.
    const totalPx = this.dir === "v" ? rect.width : rect.height;
    const minBeforeRatio = this.minBefore / totalPx;
    const maxBeforeRatio = 1 - (this.minAfter / totalPx);
    ratio = Math.max(minBeforeRatio, Math.min(maxBeforeRatio, ratio));
    this.applyRatio(ratio, /*persist=*/false);
  }
  _onUp() {
    if (!this.dragging) return;
    this.dragging = false;
    this.sash.classList.remove("dragging");
    document.body.style.cursor = "";
    // Persist final ratio.
    const rect = this.container.getBoundingClientRect();
    const beforeRect = this.before.getBoundingClientRect();
    const totalPx = this.dir === "v" ? rect.width : rect.height;
    const beforePx = this.dir === "v" ? beforeRect.width : beforeRect.height;
    this.applyRatio(beforePx / totalPx, /*persist=*/true);
    window.removeEventListener("mousemove", this._onMove);
    window.removeEventListener("mouseup", this._onUp);
    window.removeEventListener("touchmove", this._onMove);
    window.removeEventListener("touchend", this._onUp);
  }
  _onDown(ev) {
    ev.preventDefault();
    this.dragging = true;
    this.sash.classList.add("dragging");
    document.body.style.cursor = this.dir === "v" ? "col-resize" : "row-resize";
    window.addEventListener("mousemove", this._onMove);
    window.addEventListener("mouseup", this._onUp);
  }
  _onTouchStart(ev) {
    ev.preventDefault();
    this.dragging = true;
    this.sash.classList.add("dragging");
    window.addEventListener("touchmove", this._onMove, { passive: false });
    window.addEventListener("touchend", this._onUp);
  }
}
function initSashes() {
  // A: header / main / log-region — between main and log-region.
  // The parent of #sash-main-log is <body>.
  _godexSashes.push(new Sash({
    sashEl: $("sash-main-log"),
    beforeEl: $("main"),
    afterEl: $("log-region"),
    dir: "h",
    storageKey: "godex-studio.mainLogRatio",
    minBefore: 200, minAfter: 120, defaultRatio: 0.6,
  }));
  // D: col-left / col-right — vertical split.
  // E: forms area — vertical split between #fs-provider and #fs-models.
  // The parent of #sash-forms is #forms-area.
  _godexSashes.push(new Sash({
    sashEl: $("sash-forms"),
    beforeEl: $("fs-provider"),
    afterEl: $("fs-models"),
    dir: "h",
    storageKey: "godex-studio.formsRatio",
    minBefore: 80, minAfter: 80, defaultRatio: 0.35, mode: "px",
  }));

  _godexSashes.push(new Sash({
    sashEl: $("sash-cols"),
    beforeEl: $("col-left"),
    afterEl: $("col-right"),
    dir: "v",
    storageKey: "godex-studio.colsRatio",
    minBefore: 120, minAfter: 240, defaultRatio: 0.22,
  }));
  // B: Studio / GodeX panels — horizontal split inside log-region.
  _godexSashes.push(new Sash({
    sashEl: $("log-sash"),
    beforeEl: $("lp-studio"),
    afterEl: $("lp-godex"),
    dir: "h",
    storageKey: "godex-studio.sashRatio",
    minBefore: 120, minAfter: 80, defaultRatio: 0.6,
  }));
}


window.addEventListener("resize", function(){
  for(var s of _godexSashes){ try{s.applyRatio(s._loadRatio(), false);}catch(e){} }
});

document.addEventListener("mousemove", function(e){
  for(var s of _godexSashes){
    if(s.dragging){
      var rect = s.container.getBoundingClientRect();
      var pos = (e.touches ? e.touches[0].clientY : e.clientY);
      var pos2 = (e.touches ? e.touches[0].clientX : e.clientX);
      var ratio = s.dir === "v" ? (pos2 - rect.left)/rect.width : (pos - rect.top)/rect.height;
      var totalPx = s.dir === "v" ? rect.width : rect.height;
      var minR = s.minBefore / totalPx;
      var maxR = 1 - s.minAfter / totalPx;
      ratio = Math.max(minR, Math.min(maxR, ratio));
      s.applyRatio(ratio, false);
      document.getElementById("info").textContent = s.sash.id + ": " + (ratio*100).toFixed(1) + "%";
    }
  }
});
try {
  initSashes();
} catch(e) {
  var d = document.getElementById("diag");
  d.style.display = "block";
  d.innerHTML = "initSashes ERROR: " + e.message;
}
var d = document.getElementById("diag");
d.style.display = "block";
if (_godexSashes.length >= 3) {
  var sml = _godexSashes[2];
  d.innerHTML =
    "Sash count: " + _godexSashes.length + "<br>" +
    "sash[2]=sash-main-log<br>" +
    "before=main, after=log-region<br>" +
    "container=" + sml.container.tagName + " (parent of sash-main-log)";
} else {
  d.innerHTML = "_godexSashes=" + _godexSashes.length;
}
