const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const dir = 'D:/Documents/VibeCoding/GodeX/studio-tauri/src-tauri/target/release/build/godex-studio-8f68c89455d7cec8/out/tauri-codegen-assets';
const files = fs.readdirSync(dir).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtime.getTime() }));
files.sort((a,b) => b.t - a.t);
for (const x of files.slice(0, 4)) {
    const buf = fs.readFileSync(path.join(dir, x.f));
    const s = zlib.brotliDecompressSync(buf).toString('utf-8');
    const checks = {
        size: s.length,
        hasMainId: s.includes('<main id="main">'),
        hasContainFix: s.includes('contain:layout style'),
        hasInitSashes: s.includes('initSashes'),
        hasModelProbeCfg: s.includes('get_initial_config_path'),
        hasModelList: s.includes('.model-list'),
    };
    console.log(x.f, JSON.stringify(checks));
}
