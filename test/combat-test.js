'use strict';
// Test chiến đấu / cân nặng / dash / chống gian lận bằng client WebSocket thật. Chỉ SẮP ĐẶT tiền điều kiện (vị trí, cân nặng) qua room API;
// mọi quyết định nuốt, cộng cân, rơi thức ăn đều do server tự xử lý.
process.env.MAX_CONN_PER_IP = '200';
setTimeout(() => { console.error('TIMEOUT'); process.exit(2) }, 120000).unref();
const assert = require('assert'), WebSocket = require('ws'), R = require('../shared/rules'); const { start } = require('../server/server'); const { Room } = require('../server/game');
const srv = start(0), port = () => srv.server.address().port, sleep = ms => new Promise(r => setTimeout(r, ms));
const hex = () => Array.from({ length: 24 }, () => '0123456789abcdef'[Math.random() * 16 | 0]).join('');
let n = 0; const ok = m => { n++; console.log('  ✔', m) };
const tickMs = []; const _t = Room.prototype.tick; Room.prototype.tick = function (...a) { const t0 = process.hrtime.bigint(); const r = _t.apply(this, a); tickMs.push(Number(process.hrtime.bigint() - t0) / 1e6); return r };
function client(name, room) {
  const c = { name, events: [], snap: null, ack: null, bytes: 0, errors: [] };
  c.connect = () => new Promise(res => { c.ws = new WebSocket('ws://localhost:' + port()); c.ws.on('open', () => c.ws.send(JSON.stringify({ t: 'join', v: 2, room, pid: hex(), name, bi: 1, col: '#ff8800' })));
    c.ws.on('message', d => { c.bytes += d.length; const m = JSON.parse(d); if (m.t === 'welcome') { c.id = m.id; res(c) } if (m.t === 'meta') c.meta = m.ents;
      if (m.t === 's') { c.snap = m; c.ack = m.k.find(a => a[0] === c.id) || c.ack; for (const e of m.e) c.events.push(e) } });
    c.ws.on('close', () => { c.closed = true }) });
  c.in = (a, d = 0, i = 0) => c.ws.send(JSON.stringify({ t: 'in', a, d, i, c: Date.now() }));
  c.me = id => c.snap && c.snap.p.find(a => a[0] === (id || c.id));
  c.kills = () => c.events.filter(e => e[0] === 'k'); return c;
}
const setup = async (code, names) => { const cs = []; for (const nm of names) cs.push(await client(nm, code).connect()); await sleep(120); const room = srv.rooms.get(code);
  room.bots.forEach(b => { b.alive = false; b.respawn = 9999 }); const P = cs.map(c => room.players.get(c.id)); P.forEach(p => p.inp.i = 1); return { cs, room, P } };
const place = (e, kg, x, y) => { e.kg = kg; e.x = x; e.y = y; e.en = 100; e.tired = false };
const clearEv = cs => cs.forEach(c => c.events.length = 0);

(async () => {
  console.log('1. Người chơi A nuốt người chơi B; cân nặng đồng bộ');
  { const { cs: [A, B], P: [pa, pb] } = await setup('C1', ['A', 'B']); place(pa, 60, 1000, 1000); place(pb, 12, 1010, 1000); await sleep(600);
    const k = A.kills(); assert.strictEqual(k.length, 1); assert(k[0][1] === A.id && k[0][2] === B.id); assert(B.kills().length === 1 && B.kills()[0][2] === B.id);
    assert(!A.snap.p.some(a => a[0] === B.id) && !B.snap.p.some(a => a[0] === B.id)); ok('A nuốt B: cả hai client nhận cùng 1 sự kiện, B biến mất khỏi snapshot của cả hai');
    assert(k[0][6] > 2.5 && k[0][6] < 4); const wa = A.me(), wb = B.snap.p.find(a => a[0] === A.id); assert.strictEqual(wa[3], wb[3]); assert(wa[3] > 60); ok(`A tăng ${k[0][6]} kg khi nuốt B (mồi ${k[0][7]} kg). Cân nặng A: A thấy ${wa[3]} = B thấy ${wb[3]}`); }
  console.log('2. Người chơi nuốt bot; bot không hỏng AI sau đó');
  { const { cs: [A], room, P: [pa] } = await setup('C2', ['A']); const bot = room.bots[0]; bot.alive = true; bot.respawn = 0; place(bot, 20, 2000, 2000); bot.ai.t = 99; place(pa, 60, 2010, 2000); await sleep(500);
    const k = A.kills(); assert(k.length === 1 && k[0][1] === A.id && k[0][2] === bot.id); ok('A nuốt bot (sự kiện kill đến client A)');
    await sleep(3500); const nb = room.bots[0]; assert(nb.alive && nb.id !== bot.id && A.meta[nb.id] && A.meta[nb.id][3] === 1); ok('bot bị nuốt hồi sinh sau ~3s với id mới, đã được đồng bộ meta tới client');
    const p0 = [nb.x, nb.y]; await sleep(2000); assert(Math.hypot(nb.x - p0[0], nb.y - p0[1]) > 50); ok('bot mới vẫn di chuyển (AI không hỏng)'); }
  console.log('3. Bot nuốt người chơi');
  { const { cs: [A], room, P: [pa] } = await setup('C3', ['A']); const bot = room.bots[0]; bot.alive = true; place(bot, 60, 2000, 2000); bot.ai.t = 99; place(pa, 12, 2010, 2000); await sleep(500);
    const k = A.kills(); assert(k.length === 1 && k[0][1] === bot.id && k[0][2] === A.id && k[0][5] === bot.name); ok(`bot "${bot.name}" nuốt người chơi A; A nhận sự kiện kèm tên kẻ nuốt`); }
  console.log('4. Bot nuốt bot');
  { const { cs: [A], room } = await setup('C4', ['A']); const [b1, b2] = room.bots; [b1, b2].forEach(b => { b.alive = true; b.ai.t = 99 }); place(b1, 60, 3000, 3000); place(b2, 15, 3010, 3000); await sleep(500);
    const k = A.kills(); assert(k.length === 1 && k[0][1] === b1.id && k[0][2] === b2.id); ok('bot 60kg nuốt bot 15kg; client quan sát nhận sự kiện'); }
  console.log('5. Mèo nhỏ / gần bằng nhau không nuốt được nhau');
  { const { cs: [A, B], P: [pa, pb] } = await setup('C5', ['A', 'B']); place(pa, 14, 2000, 2000); place(pb, 10, 2005, 2000); await sleep(1500);
    assert.strictEqual(A.kills().length, 0); ok('14kg vs 10kg (1.4x < 1.6x) chồng lên nhau 1.5s: không ai bị nuốt');
    place(pa, 12, 2000, 2000); pa.ang = 0; place(pb, 30, 2300, 2000); pa.inp = { a: 0, d: 1, i: 0, at: Date.now(), ct: 0 }; clearEv([A, B]); const iv = setInterval(() => A.in(0, 1), 40); await sleep(2200); clearInterval(iv);
    const ks = A.kills(); assert(ks.length >= 1 && ks.every(e => e[1] === B.id)); ok('A (12kg) lao hết sức vào B (30kg): kết quả duy nhất là B nuốt A, A không thể nuốt B'); }
  console.log('6. Hai người cùng chạm một mục tiêu: chỉ một người nuốt được');
  { const { cs: [A, B, C], P: [pa, pb, pc] } = await setup('C6', ['A', 'B', 'C']); place(pa, 60, 1000, 1000); place(pb, 61, 1008, 1000); place(pc, 10, 1004, 1000); await sleep(600);
    for (const c of [A, B, C]) assert.strictEqual(c.kills().filter(e => e[2] === C.id).length, 1); const w = A.kills()[0][1]; assert.strictEqual(pa.kills + pb.kills, 1); assert.strictEqual(A.kills()[0][6] > 0, true);
    ok(`mục tiêu chỉ bị nuốt 1 lần và chỉ 1 kẻ săn được tính lượt nuốt + thưởng cân (${w === A.id ? 'A' : 'B'}); mục tiêu biến mất ở cả 3 client`); }
  console.log('7. Chạy nhanh tiêu hao thức ăn, hết thì bị hạn chế, ăn thì hồi');
  { const { cs: [A], room, P: [pa] } = await setup('C7', ['A']); room.food.forEach(f => { f.a = false; f.t = 1e9 }); place(pa, 40, 500, 2000); pa.ang = 0; pa.inp.i = 0; const log = []; const iv = setInterval(() => A.in(0, 1), 40); let last = null;
    for (let s = 0; s < 14; s++) { await sleep(1000); const m = A.me(); log.push({ x: m[1], kg: m[3], dash: m[5], en: A.ack[3], tired: A.ack[4] }); if (m[1] > 3800) { pa.x = 500; pa.en = pa.en } }
    clearInterval(iv); const en = log.map(l => l.en); assert(en[0] < 100 && Math.min(...en) <= 6 && log.some(l => l.tired === 1)); assert(log[0].dash === 1 && log[log.length - 1].dash === 0);
    ok('dash giữ liên tục: thanh thức ăn ' + en.slice(0, 12).join('→') + ' (hết thì tự ngừng chạy nhanh)');
    const kgs = log.map(l => l.kg); assert(kgs[0] < 40 && kgs[kgs.length - 1] < kgs[0] && kgs.every(k => k >= R.CFG.MIN_KG)); ok('cân nặng giảm khi chạy nhanh: ' + kgs[0] + ' kg → ' + kgs[kgs.length - 1] + ' kg (sàn ' + R.CFG.MIN_KG + ')');
    A.in(0, 0); await sleep(3000); const e1 = A.ack[3]; pa.en = 8; pa.tired = true; pa.x = 700; pa.y = 700; room.food.forEach(f => f.a = false); const f = room.food[0]; f.a = true; f.t = 0; f.x = pa.x + 3; f.y = pa.y; f.v = 3; pa.inp.i = 1; await sleep(300); assert(A.ack[3] >= 8 + 3 * R.CFG.ENERGY_PER_V - 2 && A.ack[4] === 0); ok('ăn 1 thức ăn (giá trị 3): năng lượng 8 → ' + A.ack[3] + ' và hết trạng thái kiệt sức'); }
  console.log('8. Chống gửi dữ liệu giả');
  { const { cs: [A, B], room, P: [pa, pb] } = await setup('C8', ['A', 'B']); place(pa, 12, 1000, 1000); place(pb, 60, 3000, 3000); const kg0 = pa.kg;
    const bad = [{ t: 'in', a: 'x', d: 1, i: 0, c: 'bad' }, { t: 'in', a: 1e999, d: 'yes', i: [], kg: 9999 }, { t: 'kill', target: B.id }, { t: 'swallow', a: A.id, b: B.id }, { t: 'set', kg: 500, en: 999 }, { t: 'spawn', name: '<img onerror=1>', kg: 500 }, [1, 2, 3], 'str', 42, null, { t: 'join', v: 2, room: 'C8', pid: hex(), name: 'dup' }];
    for (const m of bad) A.ws.send(JSON.stringify(m)); A.ws.send(Buffer.from([0, 255, 3, 9])); A.ws.send('{bad json'); await sleep(400);
    assert(pa.kg <= kg0 + 0.01 && pb.alive && pb.kg >= 59 && A.snap && !A.closed); assert(Number.isFinite(pa.inp.a)); ok('thông điệp kill/swallow/set kg/NaN/JSON hỏng/nhị phân đều bị bỏ qua: cân nặng & trạng thái không đổi, server vẫn chạy');
    A.ws.send('x'.repeat(5000)); await sleep(300); assert(A.closed); ok('khung dữ liệu quá lớn (5KB) bị ngắt kết nối');
    const C = await client('C', 'C8').connect(); await sleep(100); const pc = room.players.get(C.id); place(pc, 40, 600, 2000); pc.inp.i = 0; pc.en = 0; pc.tired = true; const x0 = pc.x; const iv = setInterval(() => C.in(0, 1), 30); await sleep(1000); clearInterval(iv);
    const dist = pc.x - x0, base = R.speedOf(pc.kg, false), dashSp = R.speedOf(pc.kg, true); assert(dist < base * 1.0 + 15 && dist < dashSp * .7); ok(`client ép dash=1 khi đã hết thức ăn: server vẫn chỉ cho đi ${dist.toFixed(0)}px/s (thường ${base.toFixed(0)}, dash ${dashSp.toFixed(0)})`); }
  console.log('9. Bù trễ: kẻ săn trễ mạng vẫn nuốt được mục tiêu đang chạy');
  { const room = new Room('LAG'); const fake = { readyState: 1, send() { } }; room.bots.forEach(b => { b.alive = false; b.respawn = 9e9 });
    const A = room.addPlayer('a'.repeat(24), fake, { name: 'A', bi: 0, col: '#fff' }, true), B = room.addPlayer('b'.repeat(24), fake, { name: 'B', bi: 0, col: '#fff' }, true); let now = 1e6;
    place(A, 60, 1000, 1000); place(B, 12, 1100, 1000); B.ang = 0; const tryRtt = rtt => { const r = new Room('x'); return rtt };
    for (let i = 0; i < 12; i++) { now += 50; A.inp = { a: 0, d: 0, i: 1, at: now, ct: 0 }; B.inp = { a: 0, d: 0, i: 0, at: now, ct: 0 }; room.step(.05, now); room.ev = [] } // B chạy thẳng ~190px/s, lịch sử vị trí được ghi
    const reach = R.reachOf(A, B.kg); A.x = B.x - (reach + 25); A.y = B.y; // A cách B hiện tại 25px NGOÀI tầm với
    const back = room.rewind(B, 270); assert(Math.abs(B.x - A.x) > reach && Math.abs(back.x - A.x) < reach);
    A.rtt = 0; room.fight(); assert(!room.ev.some(e => e[0] === 'k')); ok(`RTT 0ms: B cách ${(B.x - A.x).toFixed(0)}px (tầm ${reach.toFixed(0)}px) => trượt`);
    A.rtt = 200; room.fight(); assert(room.ev.some(e => e[0] === 'k' && e[1] === A.id && e[2] === B.id)); ok(`RTT 200ms (bù ${R.CFG.INTERP_MS + 200}ms): cùng vị trí hiện tại nhưng B ${B.x - back.x > 0 ? (B.x - back.x).toFixed(0) : 0}px phía trước so với màn hình A nhìn thấy => trúng`);
    const C = room.addPlayer('c'.repeat(24), fake, { name: 'C', bi: 0, col: '#fff' }, true); place(C, 5, 3000, 3000); C.ang = 0; A.rtt = 9999; const L = room.lagOf(A); assert(L === R.CFG.LAG_MAX_MS); ok(`RTT khai khống/quá lớn bị chặn ở ${R.CFG.LAG_MAX_MS}ms; RTT do SERVER đo bằng ping/pong nên client không tự khai được`); }
  console.log('10. Nhiều người chơi cùng lúc (tải)');
  { const N = 11, cs = []; for (let i = 0; i < N; i++) cs.push(await client('P' + i, 'LOAD').connect()); const room = srv.rooms.get('LOAD'); assert.strictEqual(room.humans(), N); tickMs.length = 0; const t0 = Date.now(); cs.forEach(c => c.bytes = 0);
    const ivs = cs.map((c, i) => setInterval(() => c.in(Math.random() * 6.28, Math.random() < .3 ? 1 : 0), 50)); await sleep(15000); ivs.forEach(clearInterval); const dt = (Date.now() - t0) / 1000;
    const avg = tickMs.reduce((a, b) => a + b, 0) / tickMs.length, mx = Math.max(...tickMs); const kb = cs.reduce((a, c) => a + c.bytes, 0) / N / dt / 1024;
    assert(cs.every(c => !c.closed && c.snap) && avg < 10); ok(`${N} người + 7 bot trong 1 phòng 15s: tick trung bình ${avg.toFixed(2)}ms (tối đa ${mx.toFixed(1)}ms / ngân sách 50ms); ${kb.toFixed(1)} KB/s mỗi client`);
    const allKg = cs.map(c => c.snap.p.map(a => a[3])).flat(); assert(allKg.every(k => Number.isFinite(k) && k >= R.CFG.MIN_KG - 0.001 && k <= R.CFG.MAX_KG)); ok('mọi cân nặng trong snapshot hữu hạn và trong [' + R.CFG.MIN_KG + ',' + R.CFG.MAX_KG + ']');
    const same = cs.every(c => JSON.stringify(c.snap.p.map(a => a[0]).sort()) === JSON.stringify(cs[0].snap.p.map(a => a[0]).sort()) || Math.abs(c.snap.p.length - cs[0].snap.p.length) <= 1); assert(same); ok('mọi client thấy cùng tập mèo đang sống (chênh tối đa 1 do lệch tick)'); }
  console.log(`\n${n} kiểm tra đạt.`); srv.stop(); process.exit(0);
})().catch(e => { console.error('✘ FAIL:', e.message); console.error((e.stack || '').split('\n').slice(0, 5).join('\n')); srv.stop(); process.exit(1) });
