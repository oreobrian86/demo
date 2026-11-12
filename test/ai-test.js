'use strict';
// Chứng minh 3 cấp độ khó khác nhau về HÀNH VI (không phải chỉ số), và bot không "nhìn xuyên" ngoài tầm.
const assert = require('assert'), R = require('../shared/rules'), C = R.CFG; let n = 0; const ok = m => { n++; console.log('  ✔', m) };
let ID = 1; const cat = (kg, x, y, o = {}) => Object.assign(R.newBody({ id: ID++, x, y, ang: 0, vx: 0, vy: 0, px: x, py: y, alive: true, kills: 0, bot: true, ai: { t: 0, tx: 0, ty: 0 } }, kg), o);
const think = (b, list, dif, lists = [[]], dt = .01) => { b.ai.t = 0; R.think(b, dt, list, lists, dif); return b.ai };
const DIFS = ['easy', 'normal', 'hard'];

console.log('1. Tầm nhìn: bot không biết vị trí ngoài tầm (không gian lận)');
{ const res = {}; for (const dif of DIFS) { res[dif] = []; for (const d of [350, 450, 550, 600, 700, 900]) { let hunted = 0; for (let t = 0; t < 120; t++) { const b = cat(30, 2000, 2000), p = cat(10, 2000 + d, 2000, { bot: true }); if (think(b, [b, p], dif).mode === 'hunt') hunted++ } res[dif].push(hunted > 0 ? 1 : 0) } }
  console.table({ easy: res.easy, normal: res.normal, hard: res.hard }); console.log('   (cột = khoảng cách 350,450,550,600,700,900px; 1 = bot phát hiện và săn)');
  assert.deepStrictEqual(res.easy, [1, 0, 0, 0, 0, 0]); assert.deepStrictEqual(res.normal, [1, 1, 0, 0, 0, 0]); assert.deepStrictEqual(res.hard, [1, 1, 1, 1, 0, 0]); ok('tầm nhìn easy 420 < normal 520 < hard 650px; ngoài tầm thì không săn dù ở 700–900px (nhỏ hơn khung nhìn người chơi)'); }

console.log('2. Ưu tiên săn người chơi hay bot');
{ const rate = (dif, human) => { let k = 0; for (let t = 0; t < 600; t++) { const b = cat(30, 2000, 2000), p = cat(10, 2200, 2000, { bot: !human }); if (think(b, [b, p], dif).mode === 'hunt') k++ } return k / 600 };
  const e = [rate('easy', true), rate('easy', false)], nm = [rate('normal', true), rate('normal', false)], h = [rate('hard', true), rate('hard', false)];
  assert(e[0] < .25 && e[1] > .2 && e[1] < .5 && e[0] < e[1]); assert(nm[0] === 1 && h[0] === 1); ok(`EASY chỉ săn ${(e[0] * 100).toFixed(0)}% người chơi / ${(e[1] * 100).toFixed(0)}% bot nhỏ (hay bỏ qua, ưu tiên kiếm cá); NORMAL/HARD săn 100%`); }

console.log('3. Bỏ chạy: easy phản ứng muộn, không dash');
{ const run = dif => { const b = cat(15, 2000, 2000), t = cat(60, 2000 + 330, 2000); const a = think(b, [b, t], dif); return { mode: a.mode, dsh: a.dsh } };
  const e = run('easy'), nm = run('normal'), h = run('hard'); assert(e.mode !== 'flee' && nm.mode === 'flee' && h.mode === 'flee'); ok('mèo lớn cách 330px: EASY chưa thèm chạy, NORMAL và HARD đã bỏ chạy');
  const close = dif => { const b = cat(15, 2000, 2000), t = cat(60, 2000 + 60, 2000); return think(b, [b, t], dif) }; const ce = close('easy'), cn = close('normal'); assert(ce.mode === 'flee' && !ce.dsh && cn.dsh); ok('mèo lớn áp sát 60px: EASY chạy nhưng KHÔNG dash, NORMAL dash'); }

console.log('4. Nhịp phản ứng');
{ const mean = dif => { let s = 0; for (let i = 0; i < 400; i++) { const b = cat(30, 2000, 2000); b.ai.t = 0; R.think(b, 0, [b], [[]], dif); s += b.ai.t } return s / 400 }; const m = DIFS.map(mean); assert(m[0] > m[1] && m[1] > m[2] && m[0] > .6 && m[2] < .2); ok(`thời gian giữa 2 lần suy nghĩ: easy ${m[0].toFixed(2)}s > normal ${m[1].toFixed(2)}s > hard ${m[2].toFixed(2)}s`); }

console.log('5. HARD chọn mục tiêu, tránh bẫy, chặn đầu, rút lui');
{ // mồi A gần nhưng đang đứng cạnh mèo lớn (bẫy); mồi B xa hơn nhưng an toàn
  const scene = () => { const b = cat(30, 2000, 2000), A = cat(10, 2420, 2000, { bot: true }), B = cat(12, 1650, 2250, { bot: true }), big = cat(80, 2640, 2000, { bot: true }); return { b, A, B, big, list: [b, A, B, big] } }; // big ở 640px: ngoài tầm bỏ chạy của hard (560) nhưng trong tầm nhìn (650); normal không thấy nó (520)
  let hardA = 0, normA = 0, N = 200; for (let i = 0; i < N; i++) { let s = scene(); let a = think(s.b, s.list, 'hard'); if (a.mode === 'hunt' && Math.hypot(a.tx - s.A.x, a.ty - s.A.y) < 60) hardA++; s = scene(); a = think(s.b, s.list, 'normal'); if (a.mode === 'hunt' && Math.hypot(a.tx - s.A.x, a.ty - s.A.y) < 60) normA++ }
  assert(normA === N && hardA === 0); ok('mồi A nằm cạnh mèo 80kg: NORMAL (không thấy mèo lớn) lao vào A, HARD thấy nguy hiểm nên bỏ A và chọn mồi an toàn B'); }
{ const lead = dif => { const b = cat(30, 2000, 2000), p = cat(10, 2300, 2000, { bot: true, vx: 0, vy: 190 }); const a = think(b, [b, p], dif); return a.ty - p.y }; const ln = lead('normal'), lh = lead('hard'); assert(lh > ln * 1.8 && ln > 40); ok(`chặn đầu mồi đang chạy ngang (190px/s): NORMAL nhắm trước ${ln.toFixed(0)}px, HARD nhắm trước ${lh.toFixed(0)}px`); }
{ const run = dif => { const b = cat(30, 2000, 2000), p = cat(10, 2200, 2000, { bot: true }); b.en = 10; b.tired = true; think(b, [b, p], dif, [[]], .01); b.en = 100; b.tired = false; const a = think(b, [b, p], dif, [[]], 1.0); return a.mode }; const n1 = run('normal'), h1 = run('hard'); assert(n1 === 'hunt' && h1 !== 'hunt'); ok('vừa hết sức rồi hồi đủ: NORMAL đuổi lại ngay, HARD vẫn rút lui ~3s (không lao vào lại khi chưa sẵn sàng)'); }
{ const dsh = dif => { const b = cat(30, 2000, 2000), p = cat(10, 2000 + R.rad(30) * 4.4 + 60, 2000, { bot: true }); return think(b, [b, p], dif).dsh }; const far = dsh('hard'); const near = (() => { const b = cat(30, 2000, 2000), p = cat(10, 2000 + R.rad(30) * 3, 2000, { bot: true }); return think(b, [b, p], 'hard').dsh })(); assert(far === false && near === true); ok('HARD áp sát bằng tốc độ thường, chỉ lao (dash) khi đã vào tầm tấn công'); }
{ const wall = dif => { const b = cat(15, 120, 2000), t = cat(60, 200, 1800); const a = think(b, [b, t], dif); return a.tx }; const w = wall('hard'), wn = wall('normal'); assert(w > wn + 100); ok(`bị đuổi sát tường trái: NORMAL chạy thẳng ngược hướng (đích x=${wn.toFixed(0)}, ra ngoài/vào góc), HARD cộng lực đẩy khỏi tường nên trượt dọc tường (đích x=${w.toFixed(0)})`); }

console.log('6. Chi phí CPU AI không tăng quá mức');
{ const lists = [Array.from({ length: 650 }, (_, i) => ({ x: i * 6 % 4200, y: i * 11 % 4200, a: true }))]; const T = {}; for (const dif of DIFS) { const bots = Array.from({ length: 7 }, (_, i) => cat(20 + i * 8, 500 + i * 400, 2000)); const t0 = process.hrtime.bigint(); for (let k = 0; k < 20000; k++) { const b = bots[k % 7]; b.ai.t = 0; R.think(b, 0, bots, lists, dif) } T[dif] = Number(process.hrtime.bigint() - t0) / 20000 / 1000 }
  console.log('   µs / lần suy nghĩ:', JSON.stringify(Object.fromEntries(Object.entries(T).map(([k, v]) => [k, +v.toFixed(1)])))); assert(T.hard < 200); ok(`1 lần suy nghĩ của bot tốn ~${T.hard.toFixed(0)}µs (hard): 7 bot suy nghĩ ~6 lần/giây mỗi con => không đáng kể`); }
console.log(`\n${n} kiểm tra đạt.`);
