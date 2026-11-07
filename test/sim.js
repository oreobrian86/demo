'use strict';
// Mô phỏng nhanh phía server (không mạng). node test/sim.js [số phút mô phỏng] [số lần chạy]
const { Room, rad } = require('../server/game'); const RR = require('../shared/rules');
if (process.argv[4]) Object.assign(RR.CFG, JSON.parse(process.argv[4])); // ví dụ: '{"LUNGE_REACH":0.6}'
const mins = +process.argv[2] || 10, runs = +process.argv[3] || 5;
const kg = e => e.kg;
function run(scn) {
  const r = new Room('SIM'); let now = 1e6; const stat = { botBot: 0, botHuman: 0, humanBot: 0, humanHuman: 0, contacts: 0 };
  const H = r.addPlayer('a'.repeat(24), { readyState: 1, send() { } }, { name: 'H', bi: 0, col: '#ff8800' }, true);
  if (scn === 'hunter') H.kg = 60; // người đi săn, nặng sẵn
  const seen = new Set();
  for (let t = 0; t < mins * 60 * 20; t++) {
    now += 50;
    if (scn === 'hunter' && H.alive) { // "người chơi hoàn hảo": thấy mọi thứ, không trễ
      let best = null, bd = 1e9; for (const o of r.alive()) { if (o === H || kg(o) * 2.5 > kg(H)) continue; const d = Math.hypot(o.x - H.x, o.y - H.y); if (d < bd) { bd = d; best = o } }
      H.inp = best ? { a: Math.atan2(best.y - H.y, best.x - H.x), d: bd < 260 ? 1 : 0, i: 0, at: now } : { a: H.ang, d: 0, i: 0, at: now };
      if (best && bd < rad(kg(H)) * .85 + rad(kg(best)) * .15) seen.add(best.id);
    } else if (H.alive) H.inp = { a: H.ang, d: 0, i: 0, at: now }; // người chơi đứng im thả trôi
    r.step(.05, now);
    for (const e of r.ev) if (e[0] === 'k') { const a = e[1] === H.id, b = e[2] === H.id, ah = [...r.players.keys()].includes(e[1]);
      if (a && !b) stat.humanBot++; else if (b && !ah) stat.botHuman++; else if (!a && !b) stat.botBot++; }
    r.ev = [];
    if (!H.alive) r.spawn(H, { name: 'H', bi: 0, col: '#ff8800' }), scn === 'hunter' && (H.kg = 60);
  }
  stat.contacts = seen.size; return stat;
}
for (const scn of ['hunter', 'passive']) {
  const tot = { botBot: 0, botHuman: 0, humanBot: 0, humanHuman: 0, contacts: 0 };
  for (let i = 0; i < runs; i++) { const s = run(scn); for (const k in tot) tot[k] += s[k] }
  console.log(scn.padEnd(8), `(${runs} lần x ${mins} phút mô phỏng)`, JSON.stringify(tot));
}
