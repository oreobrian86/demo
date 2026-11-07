'use strict';
// Chép shared/rules.js vào index.html (giữa /*RULES-BEGIN*/ và /*RULES-END*/) để file game vẫn là 1 file tĩnh chạy được trên GitHub Pages / file://.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), idx = path.join(root, 'index.html');
const rules = fs.readFileSync(path.join(root, 'shared', 'rules.js'), 'utf8').trim();
let html = fs.readFileSync(idx, 'utf8');
const re = /\/\*RULES-BEGIN\*\/[\s\S]*?\/\*RULES-END\*\//;
if (!re.test(html)) throw new Error('Không tìm thấy marker RULES-BEGIN/END trong index.html');
const out = html.replace(re, () => '/*RULES-BEGIN*/\n' + rules + '\n/*RULES-END*/');
if (process.argv.includes('--check')) { process.exit(out === html ? 0 : 1) }
fs.writeFileSync(idx, out); console.log('index.html đã đồng bộ với shared/rules.js');
