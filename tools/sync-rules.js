'use strict';
// Chép shared/rules.js và shared/wire.js vào index.html (giữa các marker) để file game vẫn là 1 file tĩnh chạy được trên GitHub Pages / file://.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), idx = path.join(root, 'index.html');
let html = fs.readFileSync(idx, 'utf8'), out = html;
for (const [name, tag] of [['rules', 'RULES'], ['wire', 'WIRE']]) {
  const src = fs.readFileSync(path.join(root, 'shared', name + '.js'), 'utf8').trim();
  const re = new RegExp('/\\*' + tag + '-BEGIN\\*/[\\s\\S]*?/\\*' + tag + '-END\\*/');
  if (!re.test(out)) throw new Error('Không tìm thấy marker ' + tag + '-BEGIN/END trong index.html');
  out = out.replace(re, () => '/*' + tag + '-BEGIN*/\n' + src + '\n/*' + tag + '-END*/');
}
if (process.argv.includes('--check')) process.exit(out === html ? 0 : 1);
fs.writeFileSync(idx, out); console.log('index.html đã đồng bộ với shared/rules.js + shared/wire.js');
