const fs = require('fs');
const f = 'studio-tauri/model-probe/src/index.html';
let s = fs.readFileSync(f, 'utf-8');
// Line 523 has the bug: missing closing } for outer "function:" value
// Match the exact line
const NL = '\r\n';
const badLine = '    function: {type:"function",function:{name:"test",description:"test",parameters:{type:"object",properties:{a:{type:"string"}},required:["a"]}},';
const fixedLine = '    function: {type:"function",function:{name:"test",description:"test",parameters:{type:"object",properties:{a:{type:"string"}},required:["a"]}}},';
if (!s.includes(badLine)) { console.log('bad line not found'); process.exit(1); }
if (s.includes(fixedLine)) { console.log('already fixed'); process.exit(0); }
s = s.replace(badLine, fixedLine);
fs.writeFileSync(f, s);
console.log('fixed');
