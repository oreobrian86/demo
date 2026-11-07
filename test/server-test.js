'use strict';
process.env.MAX_CONN_PER_IP = '100'; // mọi client test cùng IP loopback
setTimeout(() => { console.error('TIMEOUT'); process.exit(2) }, 60000).unref();
// Test giao thức: 3 client WebSocket độc lập kết nối tới server thật qua mạng loopback.
const assert = require('assert'), WebSocket = require('ws');
const { start } = require('../server/server');
const srv = start(0); const port = () => srv.server.address().port;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hex = () => Array.from({ length: 24 }, () => '0123456789abcdef'[Math.random() * 16 | 0]).join('');
function client(name, room, pid = hex()) {
  const c = { name, pid, msgs: [], snaps: [], events: [], food: null, meta: {}, ws: null };
  c.connect = () => new Promise(res => {
    c.ws = new WebSocket('ws://localhost:' + port());
    c.ws.on('open', () => c.ws.send(JSON.stringify({ t: 'join', v: 2, room, pid: c.pid, name, bi: 1, col: '#ff8800' })));
    c.ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m);
      if (m.t === 'welcome') { c.welcome = m; c.id = m.id; c.meta = m.meta; c.off = new Set(m.off); res(c) }
      if (m.t === 'meta') c.meta = m.ents;
      if (m.t === 's') { c.snap = m; c.snaps.push(m); for (const e of m.e) { c.events.push(e); if (e[0] === 'f-') c.off.add(e[1]); if (e[0] === 'f+') c.off.delete(e[1]) } } });
  });
  c.in = (a, d = 0, i = 0) => c.ws.send(JSON.stringify({ t: 'in', a, d, i }));
  c.me = () => c.snap && c.snap.p.find(a => a[0] === c.id);
  return c;
}
let pass = 0; const ok = (n) => { pass++; console.log('  ✔', n) };
(async () => {
  console.log('Test 1: cùng một thế giới');
  const A = await client('Alice', 'T1').connect(), B = await client('Bob', 'T1').connect();
  await sleep(300);
  assert.notStrictEqual(A.id, B.id); assert.strictEqual(A.welcome.room, 'T1');
  assert(A.snap.p.some(a => a[0] === B.id), 'A thấy B'); assert(B.snap.p.some(a => a[0] === A.id), 'B thấy A');
  assert.strictEqual(A.meta[B.id][0], 'Bob'); assert.strictEqual(B.meta[A.id][0], 'Alice'); ok('A thấy B và B thấy A, tên đồng bộ');
  const botsA = A.snap.p.filter(a => A.meta[a[0]][3]).map(a => a[0]).sort().join(), botsB = B.snap.p.filter(a => B.meta[a[0]][3]).map(a => a[0]).sort().join();
  assert.strictEqual(botsA, botsB); ok('Cả hai thấy cùng danh sách bot: ' + botsA);
  assert.deepStrictEqual(A.welcome.food, B.welcome.food); ok('Cùng bố cục ' + A.welcome.food.length / 4 + ' hạt thức ăn');

  console.log('Test 2: chuyển động & ăn thức ăn đồng bộ');
  const posA0 = A.me().slice(1, 3); A.in(0, 0, 0); await sleep(1000);
  const a1 = A.me(), b_view = B.snap.p.find(x => x[0] === A.id);
  assert(Math.hypot(a1[1] - posA0[0], a1[2] - posA0[1]) > 100, 'A di chuyển'); assert.strictEqual(a1[1], b_view[1]); assert.strictEqual(a1[2], b_view[2]);
  ok('A di chuyển, B thấy đúng cùng toạ độ (server chuẩn)');
  // đưa A tới hạt gần nhất bằng input thật (chỉ gửi góc nhìn)
  const fl = A.welcome.food; let eatenIdx = -1;
  for (let t = 0; t < 400 && eatenIdx < 0; t++) {
    const me = A.me(); let best = -1, bd = 1e9;
    for (let i = 0; i < fl.length / 4; i++) { if (A.off.has(i)) continue; const d = Math.hypot(fl[i * 4] - me[1], fl[i * 4 + 1] - me[2]); if (d < bd) { bd = d; best = i } }
    A.in(Math.atan2(fl[best * 4 + 1] - me[2], fl[best * 4] - me[1])); await sleep(50);
    const ev = A.events.find(e => e[0] === 'f-' && e[2] === A.id); if (ev) eatenIdx = ev[1];
  }
  assert(eatenIdx >= 0, 'A ăn được hạt'); await sleep(200);
  assert(B.off.has(eatenIdx), 'B cũng thấy hạt biến mất'); assert(B.events.some(e => e[0] === 'f-' && e[1] === eatenIdx && e[2] === A.id));
  ok(`A ăn hạt #${eatenIdx} -> B nhận sự kiện biến mất`);
  const mBefore = 10; assert(A.me()[3] > mBefore); ok('Kích thước A tăng (server xác nhận): ' + A.me()[3]);

  console.log('Test 3: người mới nhận trạng thái hiện tại');
  const C = await client('Carol', 'T1').connect();
  assert(C.welcome.off.includes(eatenIdx), 'C nhận trạng thái hạt đã bị ăn'); assert(C.meta[A.id] && C.meta[B.id]); ok('Carol vào sau thấy hạt #' + eatenIdx + ' đã bị ăn, thấy Alice & Bob');
  await sleep(200); assert(A.events.some(e => e[0] === 'j' && e[1] === 'Carol')); ok('A nhận thông báo Carol vào phòng');

  console.log('Test 4: phòng tách biệt');
  const D = await client('Dan', 'OTHER').connect(); await sleep(200);
  assert(!Object.values(D.meta).some(m => m[0] === 'Alice' || m[0] === 'Bob') && D.welcome.n === 1); ok('Phòng OTHER không thấy người của phòng T1');

  console.log('Test 5: giới hạn phòng, thoát & kết nối lại');
  const room = srv.rooms.get('T1'), idleB = B.me()[1];
  B.ws.close(); await sleep(300);
  assert(A.snap.p.some(a => a[0] === B.id), 'B còn trong thời gian chờ kết nối lại'); ok('B mất kết nối: mèo B vẫn còn (grace) cho A thấy');
  const B2 = await client('Bob', 'T1', B.pid).connect(); assert(B2.welcome.resumed && B2.id === B.id); ok('B kết nối lại cùng pid -> nhận lại đúng mèo cũ (resumed)');
  C.ws.send(JSON.stringify({ t: 'leave' })); await sleep(300); assert(!A.snap.p.some(a => a[0] === C.id)); ok('Carol thoát chủ động -> biến mất ngay với mọi người');
  const bp = room.byPid.get(B.pid); bp.ws.close(); await sleep(200); bp.disc = Date.now() - 11000; await sleep(200);
  assert(!A.snap.p.some(a => a[0] === B.id)); ok('B mất kết nối > 10s -> mèo bị xoá khỏi phòng');
  const sock = []; for (let i = 0; i < 12; i++) sock.push(await client('P' + i, 'FULL').connect());
  const over = await new Promise(res => { const w = new WebSocket('ws://localhost:' + port()); w.on('open', () => w.send(JSON.stringify({ t: 'join', v: 2, room: 'FULL', pid: hex(), name: 'X' }))); w.on('message', d => { const m = JSON.parse(d); if (m.t === 'err') res(m) }) });
  assert(/đủ 12/.test(over.msg)); ok('Người thứ 13 bị từ chối: ' + over.msg);

  console.log('Test 6: tấn công & tiêu diệt (server phân xử; chỉ sắp đặt trước vị trí/kích thước)');
  const k = client('Killer', 'KILL'), v = client('Victim', 'KILL'); await k.connect(); await v.connect(); await sleep(150);
  const kr = srv.rooms.get('KILL'), kp = kr.players.get(k.id), vp = kr.players.get(v.id);
  kr.bots.forEach(b => { b.alive = false; b.respawn = 999 });
  kp.inp.i = vp.inp.i = 1; // đứng yên: lịch sử vị trí dùng cho bù trễ cần vài tick để bắt kịp việc dịch chuyển tức thì của test
  kp.kg = 60; kp.x = 2000; kp.y = 2000; vp.kg = 12; vp.x = 2010; vp.y = 2000;
  await sleep(450);
  const kev = v.events.find(e => e[0] === 'k'); assert(kev && kev[1] === k.id && kev[2] === v.id, 'Victim nhận sự kiện bị hạ');
  assert(k.events.some(e => e[0] === 'k' && e[2] === v.id), 'Killer nhận sự kiện kill');
  assert(!k.snap.p.some(a => a[0] === v.id) && !v.snap.p.some(a => a[0] === v.id), 'Victim biến mất khỏi snapshot của cả hai');
  const drops = k.events.filter(e => e[0] === 'd+'), dropsV = v.events.filter(e => e[0] === 'd+');
  assert(drops.length > 4 && JSON.stringify(drops) === JSON.stringify(dropsV)); ok(`Kill đồng bộ; ${drops.length} hạt rơi ra ở CÙNG vị trí với cả hai client`);
  assert(k.me()[6] === 1 && k.me()[3] > 60); ok('Cân nặng & kill của Killer: ' + k.me()[3] + ' kg, đã nuốt ' + k.me()[6]);
  v.ws.send(JSON.stringify({ t: 'spawn', name: 'Victim', bi: 0, col: '#112233' })); await sleep(250);
  assert(v.me() && v.me()[3] === 10); ok('Victim hồi sinh qua yêu cầu spawn');

  console.log('Test 7: PATE đồng bộ & không thể nhận thưởng 2 lần');
  const p1 = client('P1', 'PATE'), p2 = client('P2', 'PATE'); await p1.connect(); await p2.connect(); await sleep(150);
  const pr = srv.rooms.get('PATE'); pr.bots.forEach(b => { b.alive = false; b.respawn = 999 });
  const a = pr.players.get(p1.id), b = pr.players.get(p2.id); a.x = 1000; a.y = 1000; b.x = 1004; b.y = 1000; a.kg = b.kg = 20; a.ws.inp = null;
  a.inp.i = b.inp.i = 1; // đứng yên để so sánh công bằng
  const q = pr.spawnPate(1002, 1000); await sleep(200);
  assert(p1.events.some(e => e[0] === 'p+' && e[1] === q.id) && p2.events.some(e => e[0] === 'p+' && e[1] === q.id)); ok('Cả hai thấy pate xuất hiện cùng vị trí ' + q.x + ',' + q.y);
  const eats1 = p1.events.filter(e => e[0] === 'p-' && e[1] === q.id), eats2 = p2.events.filter(e => e[0] === 'p-' && e[1] === q.id);
  assert(eats1.length === 1 && eats2.length === 1 && eats1[0][2] === eats2[0][2]); const winner = eats1[0][2];
  const w = winner === p1.id ? p1 : p2, l = winner === p1.id ? p2 : p1;
  assert(w.me()[3] > 20 + 8 * 1.5 / (1 + 20 / 110) - 0.5, 'người ăn được cộng đúng'); assert(Math.abs(l.me()[3] - 20) < 0.01, 'người còn lại không nhận gì');
  ok(`Hai mèo chạm pate cùng lúc: chỉ ${winner === p1.id ? 'P1' : 'P2'} nhận (m ${w.me()[3]}), người kia vẫn m=${l.me()[3]}`);
  assert(pr.pates.size === 0); ok('Pate biến mất với mọi người');

  console.log(`\n${pass} kiểm tra đạt.`); srv.stop(); process.exit(0);
})().catch(e => { console.error('✘ FAIL:', e.message); console.error(e.stack.split('\n').slice(0, 4).join('\n')); srv.stop(); process.exit(1) });
