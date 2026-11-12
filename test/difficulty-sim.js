'use strict';
// So sánh 3 cấp độ khó bằng mô phỏng server nhanh. node test/difficulty-sim.js [phút mỗi lượt] [số lượt]
const { Room } = require('../server/game'); const R = require('../shared/rules'), rad = R.rad;
const MIN = +process.argv[2] || 3, RUNS = +process.argv[3] || 30, fake = { readyState: 1, send() { } };
const SIGHT = 700; // người chơi "biết né" cũng chỉ thấy trong bán kính này (như màn hình thật)
function run(dif, who) {
  const r = new Room('SIM', dif); let now = 1e6; const st = { humanDeaths: 0, botBot: 0, botKillsHuman: 0, humanKills: 0, kgSum: 0, kgN: 0, dashTicks: 0, ticks: 0, stepMs: 0 };
  const H = r.addPlayer('a'.repeat(24), fake, { name: 'H', bi: 0, col: '#f80' }, true); let evCount = 0;
  const hid = () => H.id;
  for (let t = 0; t < MIN * 60 * 20; t++) {
    now += 50;
    if (H.alive) {
      if (who === 'average') { // người chơi trung bình: chỉ quyết định lại mỗi 0.4s, thấy trong 500px, chỉ dash khi kẻ địch rất gần
        if (t % 8 === 0) { let thr = null, td = 500; for (const o of r.alive()) { if (o === H) continue; const d = Math.hypot(o.x - H.x, o.y - H.y); if (d < td && o.kg >= H.kg * 1.4) { thr = o; td = d } }
          if (thr) H.plan = { a: Math.atan2(H.y - thr.y, H.x - thr.x), d: td < 150 && !H.tired && H.en > 15 ? 1 : 0 };
          else { let bf = null, bd = 700; for (const f of r.food) { if (!f.a) continue; const d = Math.abs(f.x - H.x) + Math.abs(f.y - H.y); if (d < bd) { bd = d; bf = f } } H.plan = { a: bf ? Math.atan2(bf.y - H.y, bf.x - H.x) : H.ang + .05, d: 0 } } }
        H.inp = { a: (H.plan || { a: H.ang }).a, d: (H.plan || { d: 0 }).d, i: 0, at: now, ct: 0 };
      } else H.inp = { a: H.ang, d: 0, i: 0, at: now, ct: 0 }; // 'passive': đứng/trôi thẳng
    }
    const t0 = process.hrtime.bigint(); r.step(.05, now); st.stepMs += Number(process.hrtime.bigint() - t0) / 1e6; st.ticks++;
    for (const e of r.ev) if (e[0] === 'k') { if (e[2] === hid()) { st.humanDeaths++; if (e[1] !== hid() && !r.bots.every(b => b.id !== e[1])) st.botKillsHuman++ } else if (e[1] === hid()) st.humanKills++; else st.botBot++ }
    r.ev = []; for (const b of r.bots) if (b.alive) { st.kgSum += b.kg; st.kgN++; if (b.dashing) st.dashTicks++ }
    if (!H.alive) r.spawn(H, { name: 'H', bi: 0, col: '#f80' });
  }
  return st;
}
const out = {};
for (const who of ['passive', 'average']) for (const dif of ['easy', 'normal', 'hard']) {
  const tot = { humanDeaths: 0, botBot: 0, kgSum: 0, kgN: 0, dashTicks: 0, ticks: 0, stepMs: 0 }; for (let i = 0; i < RUNS; i++) { const s = run(dif, who); for (const k in tot) tot[k] += s[k] }
  const mins = RUNS * MIN; out[who + '/' + dif] = { 'bot giết người/phút': +(tot.humanDeaths / mins).toFixed(2), 'bot giết bot/phút': +(tot.botBot / mins).toFixed(2), 'kg TB của bot': +(tot.kgSum / tot.kgN).toFixed(1), '% thời gian bot dash': +(tot.dashTicks / tot.kgN * 100).toFixed(1), 'ms/tick (step)': +(tot.stepMs / tot.ticks).toFixed(4) };
}
console.log(`Mô phỏng ${RUNS} lượt x ${MIN} phút mỗi ô`); console.table(out);
