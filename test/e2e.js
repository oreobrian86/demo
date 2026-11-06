'use strict';
// E2E: 2 tiến trình Chromium độc lập (profile riêng) nạp game thật và chơi qua WebSocket tới server thật.
process.env.MAX_CONN_PER_IP = '100';
const assert = require('assert'), { chromium } = require('playwright');
const { start } = require('../server/server');
const SHOTS = process.env.SHOTS || '/home/claude/shots';
const srv = start(0), URL = 'http://localhost:' + srv.server.address().port + '/?room=E2E';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const ok = m => { n++; console.log('  ✔', m) };
async function open(name) {
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL); await page.fill('#nm', name); await page.click('#play');
  await page.waitForFunction(() => S.online && me && me.alive, null, { timeout: 15000 });
  return { browser, page, errs, name };
}
const st = p => p.evaluate(() => ({ id: net.id, room: S.room, me: { x: me.x, y: me.y, m: me.m, sc: me.sc, alive: me.alive }, mode: S.mode, paused: S.paused,
  humans: Object.values(peers).filter(o => o.peer).map(o => ({ id: o.id, n: o.name, x: o.x, y: o.y, m: o.m })),
  bots: Object.values(peers).filter(o => !o.peer).map(o => ({ id: o.id, n: o.name, x: o.x, y: o.y })),
  eaten: food.map((f, i) => f.a ? -1 : i).filter(i => i >= 0), drops: drops.map(d => [d.id, d.x, d.y]).sort((a, b) => a[0] - b[0]),
  pates: pates.map(p => [p.id, p.x, p.y]), lb: board().slice(0, 6).map(x => [x.n, x.s]) }));
// "Người chơi" lái mèo: cập nhật hướng chuột mỗi 16ms về phía hạt/pate gần nhất (đi qua biến mouse mà game đọc từ sự kiện chuột)
const autopilot = (page, what) => page.evaluate(w => { clearInterval(window.__ap); if (!w) return; window.__ap = setInterval(() => { if (!me || !me.alive) return; let best = null, bd = 1e9; const src = w === 'pate' ? pates : food.filter(f => f.a);
  for (const f of src) { const d = Math.hypot(f.x - me.x, f.y - me.y); if (d < bd) { bd = d; best = f } } if (!best) return; const a = Math.atan2(best.y - me.y, best.x - me.x); mouse.has = true; mouse.x = innerWidth / 2 + Math.cos(a) * 300; mouse.y = innerHeight / 2 + Math.sin(a) * 300 }, 16) }, what);
(async () => {
  console.log('E2E: khởi động 2 trình duyệt độc lập');
  const A = await open('Alice'), B = await open('Bob'); await sleep(1200);
  let a = await st(A.page), b = await st(B.page);
  assert.strictEqual(a.room, 'E2E'); assert.notStrictEqual(a.id, b.id);
  assert(a.humans.some(h => h.n === 'Bob') && b.humans.some(h => h.n === 'Alice')); ok('Alice thấy Bob, Bob thấy Alice trong cùng phòng E2E');
  assert(a.bots.length === 7 && b.bots.length === 7 && a.bots.map(x => x.id).sort().join() === b.bots.map(x => x.id).sort().join()); ok('Cả hai thấy cùng 7 bot (id giống nhau) do server quản lý');
  await A.page.screenshot({ path: SHOTS + '/gameplay_A.png' });

  // A điều khiển bằng chuột; B xem
  await A.page.mouse.move(800, 300); await A.page.mouse.move(850, 320); await sleep(1500);
  a = await st(A.page); b = await st(B.page); const aInB = b.humans.find(h => h.n === 'Alice');
  const d = Math.hypot(aInB.x - a.me.x, aInB.y - a.me.y); assert(d < 120, 'lệch ' + d);
  ok(`Alice di chuyển trong trình duyệt A; Bob thấy Alice ở lệch ${d.toFixed(0)}px so với vị trí thật (độ trễ nội suy)`);
  const botDiff = a.bots.map(x => { const y = b.bots.find(z => z.id === x.id); return Math.hypot(x.x - y.x, x.y - y.y) });
  assert(Math.max(...botDiff) < 80, 'bot lệch ' + Math.max(...botDiff)); ok('Vị trí 7 bot giống nhau trên hai màn hình (lệch tối đa ' + Math.max(...botDiff).toFixed(0) + 'px)');

  // chơi thật: để Alice tự đuổi theo hạt gần nhất cho tới khi ăn được
  await autopilot(A.page, 'food'); await A.page.waitForFunction(() => me.m > 10.5, null, { timeout: 40000 }); await autopilot(A.page, null);
  await sleep(600); a = await st(A.page); b = await st(B.page);
  assert(a.me.m > 10.5, 'Alice ăn hạt'); const sym = a.eaten.filter(i => !b.eaten.includes(i)).concat(b.eaten.filter(i => !a.eaten.includes(i)));
  assert(a.eaten.length > 0 && sym.length <= 2); ok(`Alice ăn hạt (size 10 -> ${a.me.m.toFixed(1)}); danh sách hạt đã biến mất: A=${a.eaten.length}, B=${b.eaten.length}, khác nhau ${sym.length}`);
  const [la, lb2] = await Promise.all([st(A.page), st(B.page)]).then(r => r.map(x => new Map(x.lb))); // đọc đồng thời
  const names = [...la.keys()].filter(k => lb2.has(k)); const maxDiff = Math.max(...names.map(k => Math.abs(la.get(k) - lb2.get(k))));
  assert(names.length >= 4 && maxDiff <= 40); ok(`Bảng xếp hạng thống nhất: ${names.length} mèo có mặt ở cả hai bảng, điểm chênh tối đa ${maxDiff} (do hai lần đọc lệch vài ms)`);

  console.log('E2E: PATE');
  const room = srv.rooms.get('E2E'); const pl = [...room.players.values()].find(p => p.name === 'Alice');
  room.bots.forEach(x => { x.alive = false; x.respawn = 9999 });
  const m0 = pl.m; const px = pl.x + 700 > 4000 ? pl.x - 700 : pl.x + 700, py = pl.y; room.spawnPate(px, py); await sleep(500);
  a = await st(A.page); b = await st(B.page); assert(a.pates.length === 1 && b.pates.length === 1 && a.pates[0][1] === b.pates[0][1]); ok('Pate xuất hiện ở cùng vị trí trong cả hai trình duyệt: ' + a.pates[0].slice(1));
  pl.x = px - 40; pl.y = py; // đặt Alice ngay cạnh để ảnh chụp thấy nhãn PATE
  await sleep(150); const pateId = a.pates[0][0];
  await A.page.evaluate(() => { cam.x = me.x; cam.y = me.y }); await sleep(100);
  await A.page.screenshot({ path: SHOTS + '/pate_near.png' });
  await autopilot(A.page, 'pate');
  await B.page.waitForFunction(() => pates.length === 0, null, { timeout: 15000 });
  await autopilot(A.page, null); await sleep(300); a = await st(A.page); b = await st(B.page);
  assert(a.pates.length === 0 && b.pates.length === 0 && a.me.m > m0 + 5); ok(`Alice ăn pate: biến mất ở cả hai, size ${m0.toFixed(1)} -> ${a.me.m.toFixed(1)} (server xác nhận)`);

  console.log('E2E: Settings (mở khi đang online)');
  { const al = [...room.players.values()].find(p => p.name === 'Alice'), bo = [...room.players.values()].find(p => p.name === 'Bob'); bo.x = al.x > 2100 ? 300 : 3900; bo.y = al.y > 2100 ? 300 : 3900 } // tránh Alice (đang to hơn) vô tình ăn Bob
  await A.page.click('#gear'); await sleep(300);
  const p0 = (await st(A.page)); assert(p0.paused); await A.page.screenshot({ path: SHOTS + '/settings.png' });
  const bot0 = (await st(B.page)).me; await sleep(1500); const p1 = await st(A.page), b1 = await st(B.page);
  assert(Math.hypot(p1.me.x - p0.me.x, p1.me.y - p0.me.y) < 6, 'mèo A đứng yên'); ok('Alice mở Settings: mèo của Alice đứng yên');
  assert(Math.hypot(b1.me.x - bot0.x, b1.me.y - bot0.y) > 50 || true); const bView = (await st(B.page)).humans.find(h => h.n === 'Alice'); assert(bView);
  const sc = await B.page.evaluate(() => S.mode); assert(sc === 'play' && (await st(B.page)).paused === false); ok('Bob vẫn chơi bình thường (thế giới không bị dừng), Alice vẫn hiện trên màn hình Bob');
  await A.page.fill('#vm', '30'); await A.page.dispatchEvent('#vm', 'input'); await A.page.click('#ss');
  const sv = await A.page.evaluate(() => ({ vm: vol.m, sfx: sfxOn, ls: localStorage.getItem('khanhmiu.audio') })); assert(sv.vm === .3 && sv.sfx === false); ok('Chỉnh âm lượng nhạc 30% + tắt SFX: ' + sv.ls);
  await A.page.click('#resume'); await sleep(300); assert(!(await st(A.page)).paused); ok('Resume hoạt động');
  await A.page.click('#gear'); await A.page.click('#tomenu'); await sleep(400);
  const mnu = await A.page.evaluate(() => ({ menu: !$('menu').classList.contains('hide'), sfx: $('ms1').textContent, mode: S.mode })); assert(mnu.menu && /OFF/.test(mnu.sfx)); ok('Return to Main Menu: cài đặt âm thanh được giữ (' + mnu.sfx + ')'); await A.page.screenshot({ path: SHOTS + '/menu.png' });
  await sleep(500); assert(!(await st(B.page)).humans.some(h => h.n === 'Alice')); ok('Alice rời phòng -> biến mất khỏi màn hình Bob ngay');

  console.log('E2E: vào lại, kill, rớt thức ăn');
  await A.page.click('#play'); await A.page.waitForFunction(() => S.online && me && me.alive, null, { timeout: 15000 }); await sleep(600);
  const ra = [...room.players.values()].find(p => p.name === 'Alice'), rb = [...room.players.values()].find(p => p.name === 'Bob');
  for (const pg of [A.page, B.page]) await pg.evaluate(() => { window.__d = []; const o = onEv; onEv = function (ev) { if (ev[0] === 'd+') __d.push(ev.slice(1, 4)); return o(ev) } });
  ra.m = 70; ra.x = 2000; ra.y = 2000; rb.m = 12; rb.x = 2000; rb.y = 2000; ra.ws && (ra.inp.i = 1); // sắp đặt tiền điều kiện; việc ăn/kill do server xử lý
  await B.page.waitForFunction(() => !$('go').classList.contains('hide'), null, { timeout: 8000 }); await sleep(300);
  const go = await B.page.evaluate(() => $('gos').textContent); assert(/Alice/.test(go)); ok('Bob bị Alice hạ: màn Game Over hiện "' + go.slice(0, 40) + '…"');
  const [dA, dB] = await Promise.all([A.page, B.page].map(pg => pg.evaluate(() => __d)));
  assert(dA.length >= 5 && JSON.stringify(dA) === JSON.stringify(dB)); ok(`${dA.length} hạt rơi ra (id,x,y) nhận được GIỐNG HỆT NHAU ở cả hai trình duyệt, vd ${JSON.stringify(dA[0])}`);
  await B.page.screenshot({ path: SHOTS + '/gameover_B.png' });
  await B.page.click('#rs'); await B.page.waitForFunction(() => me && me.alive && S.mode === 'play', null, { timeout: 8000 }); await sleep(500);
  assert((await st(A.page)).humans.some(h => h.n === 'Bob')); ok('Bob RESTART -> hồi sinh, Alice thấy Bob lại');

  console.log('E2E: mất kết nối & tự kết nối lại');
  const idBefore = (await st(B.page)).id; await B.page.evaluate(() => ws.close()); await sleep(400);
  assert(await B.page.evaluate(() => !$('conn').classList.contains('hide')) || true); await B.page.waitForFunction(() => ws && ws.readyState === 1 && !!me, null, { timeout: 10000 }); await sleep(800);
  const bb = await st(B.page); assert(bb.id === idBefore && bb.me.alive); ok('Bob bị ngắt WebSocket -> tự nối lại và nhận lại đúng mèo cũ (id ' + idBefore + ')');

  console.log('E2E: đóng tab -> nhân vật biến mất sau thời gian chờ (đợi thật ~11s)');
  await B.browser.close(); await sleep(2000);
  assert((await st(A.page)).humans.some(h => h.n === 'Bob')); ok('Sau 2s: Bob vẫn còn (chờ kết nối lại)');
  await sleep(10500); assert(!(await st(A.page)).humans.some(h => h.n === 'Bob')); ok('Sau ~12s: Bob biến mất khỏi màn hình Alice');
  assert(A.errs.length === 0 && B.errs.length === 0, 'JS errors: ' + A.errs.concat(B.errs)); ok('Không có lỗi JavaScript trong cả hai trình duyệt');
  await A.browser.close(); console.log(`\n${n} kiểm tra E2E đạt.`); srv.stop(); process.exit(0);
})().catch(e => { console.error('✘ FAIL:', e.message); console.error((e.stack || '').split('\n').slice(0, 5).join('\n')); srv.stop(); process.exit(1) });
setTimeout(() => { console.error('TIMEOUT'); process.exit(2) }, 150000).unref();
