'use strict';
// Client mạng yếu không được kéo cả phòng: bỏ snapshot (cái sau ghi đè), giữ sự kiện, gửi bù / resync, ngắt nếu tồn đọng quá lớn.
const assert = require('assert'), { Room, CFG, counters } = require('../server/game'), Wire = require('../shared/wire'), R = require('../shared/rules'); let n = 0; const ok = m => { n++; console.log('  ✔', m) };
const fakeWs = () => ({ readyState: 1, bufferedAmount: 0, sent: [], terminated: false, send(d) { this.sent.push(d) }, terminate() { this.terminated = true } });
const bin = ws => ws.sent.filter(d => typeof d !== 'string'), txt = ws => ws.sent.filter(d => typeof d === 'string').map(JSON.parse);
const mk = () => { const room = new Room('SLOW'); room.bots.forEach(b => { b.alive = false; b.respawn = 9e9 }); const wa = fakeWs(), wb = fakeWs(); const A = room.addPlayer('a'.repeat(24), wa, { name: 'A', bi: 0, col: '#fff' }, true), B = room.addPlayer('b'.repeat(24), wb, { name: 'B', bi: 0, col: '#fff' }, true); [A, B].forEach(p => p.inp.i = 1); let now = 1e6; return { room, wa, wb, A, B, tick: () => { now += 50; A.inp.at = B.inp.at = now; room.tick(.05, now) } } };

console.log('1. Client chậm bị bỏ snapshot, client khoẻ không bị ảnh hưởng');
{ const { room, wa, wb, A, B, tick } = mk(); for (let i = 0; i < 5; i++) tick(); const a0 = bin(wa).length, b0 = bin(wb).length; assert(a0 === 5 && b0 === 5);
  B.ws.bufferedAmount = CFG.SLOW_BYTES + 1000; const sk0 = counters.skipped; for (let i = 0; i < 40; i++) { room.ev.push(['f-', i, A.id]); tick() }
  assert.strictEqual(bin(wa).length - a0, 40); assert.strictEqual(bin(wb).length - b0, 0); assert.strictEqual(counters.skipped - sk0, 40); ok('B nghẽn 40 tick: A vẫn nhận đủ 40 snapshot, B không bị đẩy thêm byte nào, đếm được 40 snapshot bị bỏ');
  assert.strictEqual(B.pend.length, 40); ok('40 sự kiện của B được giữ lại (không mất)');
  B.ws.bufferedAmount = 0; tick(); const f = bin(wb)[bin(wb).length - 1], d = Wire.decodeSnap(f); assert(d.ev && d.ev.length >= 40 && d.ev.filter(e => e[0] === 'f-').length === 40 && B.pend.length === 0); ok(`B hết nghẽn: nhận lại ngay 1 gói chứa đủ ${d.ev.length} sự kiện bị lỡ, rồi trở lại bình thường`); }
console.log('2. Tồn đọng quá nhiều sự kiện thì gửi lại toàn bộ trạng thái (resync)');
{ const { room, wa, wb, A, B, tick } = mk(); B.ws.bufferedAmount = CFG.SLOW_BYTES + 1; for (let i = 0; i < CFG.PEND_MAX + 50; i++) { room.ev.push(['f-', i % 650, A.id]); tick() } assert(B.resync && B.pend.length === 0);
  room.food[7].a = false; room.food[7].t = 1e9; B.ws.bufferedAmount = 0; const rs0 = counters.resyncs; tick(); const w = txt(wb).filter(m => m.t === 'welcome').pop(); assert(w && w.resync === true && w.off.includes(7) && counters.resyncs === rs0 + 1 && !B.resync); ok(`quá ${CFG.PEND_MAX} sự kiện tồn đọng: B nhận bản trạng thái mới (welcome.resync) khớp server (cá #7 đã bị ăn), đếm resync = ${counters.resyncs}`);
  const before = bin(wb).length; tick(); assert.strictEqual(bin(wb).length, before + 1); ok('sau resync B lại nhận snapshot đều đặn'); }
console.log('3. Client tồn đọng cực lớn bị ngắt, không kéo phòng');
{ const { room, wa, wb, A, B, tick } = mk(); B.ws.bufferedAmount = CFG.KILL_BYTES + 1; const k0 = counters.killedSlow; tick(); assert(wb.terminated && counters.killedSlow === k0 + 1); const a = bin(wa).length; tick(); assert.strictEqual(bin(wa).length, a + 1); ok(`bufferedAmount > ${CFG.KILL_BYTES / 1024}KB: server ngắt kết nối B; A không bị ảnh hưởng`); }
console.log('4. Chi phí tick không tăng khi có client chậm');
{ const t = (slow) => { const { room, B, tick } = mk(); for (let i = 0; i < 6; i++) { const w = fakeWs(); room.addPlayer(String(i).repeat(24).slice(0, 24).replace(/[^a-f0-9]/g, 'c'), w, { name: 'P' + i, bi: 0, col: '#fff' }, true) } if (slow) B.ws.bufferedAmount = 1e5; const t0 = process.hrtime.bigint(); for (let i = 0; i < 2000; i++) tick(); return Number(process.hrtime.bigint() - t0) / 2000 / 1000 };
  const normal = t(false), slow = t(true); assert(slow < normal * 1.3 + 20); ok(`tick/phòng 8 người: bình thường ${normal.toFixed(0)}µs, có 1 client nghẽn ${slow.toFixed(0)}µs`); }
console.log(`\n${n} kiểm tra đạt.`);
