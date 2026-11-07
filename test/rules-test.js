'use strict';
// Test đơn vị cho shared/rules.js (luật dùng chung server + offline).
const assert = require('assert'), { execSync } = require('child_process'), R = require('../shared/rules'), C = R.CFG;
let n = 0; const ok = m => { n++; console.log('  ✔', m) };
const cat = (kg, o = {}) => Object.assign(R.newBody({ x: 0, y: 0, ang: 0, vx: 0, vy: 0, alive: true, kills: 0 }, kg), o);

console.log('Luật nuốt');
for (const [a, b, exp] of [[60, 10, true], [16, 10, true], [15.9, 10, false], [10, 10, false], [14, 10, false], [10, 60, false], [30, 20, false], [32, 20, true]])
  assert.strictEqual(R.canSwallow(cat(a), cat(b)), exp, `${a}kg vs ${b}kg`);
ok(`ngưỡng ${C.SWALLOW_WEIGHT_RATIO}x: nặng hơn mới nuốt; gần bằng nhau (1.0x–1.59x) không nuốt được nhau; mèo nhỏ không bao giờ nuốt mèo lớn`);
assert(R.canSwallow(cat(14, { dashing: true }), cat(10)) && !R.canSwallow(cat(14), cat(10))); ok(`đang lao: ngưỡng hạ còn ${C.DASH_SWALLOW_RATIO}x`);
for (let a = 5; a <= 250; a += 5) for (let b = 5; b <= 250; b += 5) assert(!(R.canSwallow(cat(a, { dashing: true }), cat(b, { dashing: true })) && R.canSwallow(cat(b, { dashing: true }), cat(a, { dashing: true }))));
ok('không bao giờ tồn tại cặp mà cả hai cùng nuốt được nhau (quét 5–250kg)');

console.log('Một kẻ săn duy nhất / nhiều mục tiêu');
{ const A = cat(60, { id: 'A', x: 100, y: 100 }), B = cat(61, { id: 'B', x: 110, y: 100 }), P = cat(10, { id: 'P', x: 104, y: 100 });
  const sw = R.findSwallows([A, B, P]); assert.strictEqual(sw.length, 1); assert(sw[0][1] === P); ok('2 mèo cùng chạm 1 mồi: chỉ 1 vụ nuốt, không ai nhận kép (kẻ ăn sâu hơn thắng)');
  const A2 = cat(100, { x: 0, y: 0 }), B2 = cat(40, { x: 10, y: 0 }), C2 = cat(10, { x: 14, y: 0 }); const sw2 = R.findSwallows([A2, B2, C2]);
  const done = new Set(); for (const [a, b] of sw2) if (a.alive && b.alive) { R.applySwallow(a, b); done.add(b) }
  assert(!B2.alive && C2.alive); ok('chuỗi A>B>C: kẻ nặng nhất xử lý trước, mồi đã bị nuốt không còn đi nuốt tiếp'); }
{ const A = cat(60, { x: 0, y: 0 }), P = cat(10, { x: 200, y: 0 }); assert.strictEqual(R.findSwallows([A, P]).length, 0);
  assert.strictEqual(R.findSwallows([A, P], () => ({ x: 20, y: 0 })).length, 1); ok('bù trễ: posOf() tua lại vị trí mồi -> trúng khi vị trí cũ nằm trong tầm với'); }

console.log('Cân nặng, giới hạn, ăn');
{ const a = cat(10), before = a.kg; const g = R.feed(a, 1); assert(a.kg > before && Math.abs(a.kg - before - g) < 1e-9); ok(`ăn 1 hạt: 10kg -> ${a.kg.toFixed(2)}kg`);
  const big = cat(249.9); R.feed(big, 50); assert.strictEqual(big.kg, C.MAX_KG); ok(`trần tăng trưởng ${C.MAX_KG}kg`);
  const x = cat(60), y = cat(200); R.feed(x, 10); R.feed(y, 10); assert(60 + 10 * 1.5 / (1 + 60 / 110) - x.kg < 1e-9); assert(y.kg - 200 < x.kg - 60); ok('càng nặng ăn càng tăng chậm (không tăng đột biến)');
  const f = cat(10); f.en = 0; f.tired = true; R.feed(f, 4); assert(f.en === 8 && f.tired === true); R.feed(f, 3); assert(f.en === 14 && f.tired === false); ok('ăn thức ăn hồi năng lượng (+' + C.ENERGY_PER_V + '/giá trị) và hết kiệt sức khi đủ ' + C.DASH_MIN_START); }

console.log('Chạy nhanh: tiêu hao thức ăn & giảm cân');
{ const a = cat(10); let t = 0, dashed = 0; const k0 = a.kg, x0 = a.x;
  while (!a.tired && t < 30) { R.stepBody(a, .05, 0, true); t += .05; if (a.dashing) dashed += .05 }
  assert(a.tired && a.en === 0 && t > 4 && t < 8); assert(a.kg < k0 && a.kg >= C.MIN_KG); ok(`dash liên tục 10kg: cạn thức ăn sau ${t.toFixed(1)}s, cân nặng ${k0} -> ${a.kg.toFixed(2)}kg`);
  const x1 = a.x; R.stepBody(a, .05, 0, true); assert(!a.dashing && Math.abs(a.x - x1 - R.speedOf(a.kg, false) * .05) < .01); ok('hết thức ăn: không thể tiếp tục chạy nhanh (chỉ còn tốc độ thường)');
  let t2 = 0; while (a.tired && t2 < 20) { R.stepBody(a, .05, 0, true); t2 += .05 } assert(!a.tired && a.en >= C.DASH_MIN_START - .5); ok(`hồi chậm khi không chạy nhanh: ${t2.toFixed(1)}s để chạy nhanh lại (giữ phím cũng bị hạn chế)`);
  const fast = cat(10), slow = cat(10); R.stepBody(fast, 1, 0, true); R.stepBody(slow, 1, 0, false); assert(fast.x > slow.x * 1.6); ok('chạy nhanh nhanh hơn ~' + (fast.x / slow.x).toFixed(2) + 'x so với đi thường'); }
{ const a = cat(6.3); for (let i = 0; i < 400; i++) R.stepBody(a, .05, 0, true); assert(a.kg >= C.MIN_KG && !a.dashing); ok(`cân nặng không bao giờ xuống dưới sàn ${C.MIN_KG}kg và hết dash khi quá nhẹ`);
  const heavy = cat(120), light = cat(10); let th = 0, tl = 0; while (!heavy.tired) { R.stepBody(heavy, .05, 0, true); th += .05 } while (!light.tired) { R.stepBody(light, .05, 0, true); tl += .05 } assert(th > tl); ok(`mèo nặng dự trữ bền hơn: 120kg dash ${th.toFixed(1)}s > 10kg dash ${tl.toFixed(1)}s`);
  const m = cat(80); for (let i = 0; i < 2000; i++) R.stepBody(m, .05, 0, false); assert(m.kg < 80 && m.kg > 40); ok('hao dần tự nhiên khi >30kg (chống phình vô hạn): 80kg -> ' + m.kg.toFixed(1)); }
{ const a = cat(10); for (let i = 0; i < 5000; i++) { R.stepBody(a, .05, i % 7, i % 3 === 0); if (i % 50 === 0) R.feed(a, 3) } assert(Number.isFinite(a.kg) && a.kg >= C.MIN_KG && a.kg <= C.MAX_KG && a.en >= 0 && a.en <= 100); ok('chạy thử 5000 bước hỗn hợp: kg luôn hữu hạn, trong [' + C.MIN_KG + ',' + C.MAX_KG + '], năng lượng trong [0,100]'); }

console.log('Đồng bộ bản sao luật trong index.html');
execSync('node tools/sync-rules.js --check', { cwd: require('path').join(__dirname, '..') }); ok('index.html chứa đúng bản shared/rules.js hiện tại (không lệch giữa offline và online)');
console.log(`\n${n} kiểm tra đạt.`);
