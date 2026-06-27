const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const dir = 'D:/Documents/VibeCoding/GodeX/studio-tauri/src-tauri/target/release/build/godex-studio-8f68c89455d7cec8/out/tauri-codegen-assets';
const files = fs.readdirSync(dir).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtime.getTime() }));
files.sort((a,b) => b.t - a.t);
const x = files[0];
const buf = fs.readFileSync(path.join(dir, x.f));
const s = zlib.brotliDecompressSync(buf).toString('utf-8');
console.log('latest:', x.f, '(' + s.length + ')');
const checks = {
    mainId: s.includes('<main id="main">'),
    containFix: s.includes('contain:layout style'),
    modeDropdown: s.includes('lp-godex-mode'),
    modeToggle: s.includes('lp-godex-active'),
    onGodexModeChange: s.includes('onGodexModeChange'),
    onGodexActiveToggle: s.includes('onGodexActiveToggle'),
    oldExtModeCheckbox: s.includes('lp-godex-extmode'),
};
console.log(JSON.stringify(checks, null, 2));
