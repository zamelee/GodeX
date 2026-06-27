const fs = require('fs');
const f = 'studio-tauri/src/index.html';
let s = fs.readFileSync(f, 'utf-8');
const oldLine = '<main>';
if (!s.includes(oldLine)) { console.log('OLD not found'); process.exit(1); }
if (s.includes('<main id="main">')) { console.log('already has id'); process.exit(0); }
s = s.replace('<main>', '<main id="main">');
fs.writeFileSync(f, s);
console.log('patched <main> -> <main id="main">');
