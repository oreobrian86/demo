'use strict';
// Lượng hoá lỗi "chạm mà không nuốt": kẻ săn 60kg lướt qua mồi 12kg đứng yên với độ lệch ngang ngẫu nhiên trong vùng THÂN CHẠM NHAU (<= ra+rb).
// So sánh luật v2 (tầm 0.85/0.15, chỉ kiểm tra vị trí cuối mỗi tick 50ms) với v3 (tầm 1.0/0.3 +0.25 khi lao, va chạm quét).
const R = require('../shared/rules'), rad = R.rad, TICK = .05, N = 20000, ra = rad(60), rb = rad(12);
function trial(speed, dash, rule) {
  const lat = Math.random() * (ra + rb), phase = Math.random() * speed * TICK, x0 = -300 + phase; let px = x0, hit = false;
  const reach = rule === 'v2' ? ra * .85 + rb * .15 : ra * (1.0 + (dash ? .25 : 0)) + rb * .3;
  for (let t = 0; t < 200 && px < 300; t++) {
    const nx = px + speed * TICK;
    if (rule === 'v3') { const d = R.sweptDist({ x: nx, y: 0, px, py: 0 }, { x0: 0, y0: lat, x1: 0, y1: lat }); if (d <= reach) { hit = true; break } }
    else if (Math.hypot(nx, lat) <= reach) { hit = true; break }
    px = nx;
  }
  return hit;
}
const out = {};
for (const [name, speed, dash] of [['đi bộ', R.speedOf(60, false), false], ['chạy nhanh (dash)', R.speedOf(60, true), true]]) for (const rule of ['v2', 'v3']) { let h = 0; for (let i = 0; i < N; i++) if (trial(speed, dash, rule)) h++; out[name + ' · ' + rule] = (h / N * 100).toFixed(1) + '%' }
console.log(`Mèo ${60}kg (bán kính ${ra.toFixed(1)}px) lướt qua mèo ${12}kg (${rb.toFixed(1)}px) đứng yên; thân chạm nhau khi lệch ngang <= ${(ra + rb).toFixed(1)}px; ${N} lần mỗi ô`); console.table(out);
const lat = { v2: ra * .85 + rb * .15, v3: ra + rb * .3, v3dash: ra * 1.25 + rb * .3 }; console.log('Tầm nuốt (px):', Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, +v.toFixed(1)])), ' - mồi phải bị phủ bao nhiêu mới nuốt:', `v2 tâm mồi phải nằm trong ${(lat.v2 / (ra + rb) * 100).toFixed(0)}% quãng thân chạm nhau, v3 ${(lat.v3 / (ra + rb) * 100).toFixed(0)}%`);
