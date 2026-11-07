'use strict';
// E2E combat: 2 trình duyệt Chromium độc lập chơi qua WebSocket tới server thật. Chỉ sắp đặt cân nặng/vị trí ban đầu qua room API.
process.env.MAX_CONN_PER_IP = '100';
const assert = require('assert'), { chromium } = require('playwright'); const { start } = require('../server/server');
const SHOTS = process.env.SHOTS || '/home/claude/shots'; const srv = start(0), URL = 'http://localhost:' + srv.server.address().port + '/?room=';
const sleep = ms => new Promise(r => setTimeout(r, ms)); let n = 0; const ok = m => { n++; console.log('  ✔', m) };
async function open(name, room) { const browser = await chromium.launch(), page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) });
  await page.goto(URL + room); await page.fill('#nm', name); await page.click('#play'); await page.waitForFunction(() => S.online && me && me.alive, null, { timeout: 15000 }); return { browser, page, errs } }
const pilot = (page, mode) => page.evaluate(m => { clearInterval(window.__ap); if (!m) return; window.__ap = setInterval(() => { if (!me || !me.alive) return; let best = null, bd = 1e9; for (const o of Object.values(peers)) { if (!o.alive || o.kg * 1.8 > me.kg) continue; const d = Math.hypot(o.x - me.x, o.y - me.y); if (d < bd) { bd = d; best = o } }
  if (!best) return; const a = Math.atan2(best.y - me.y, best.x - me.x); mouse.has = true; mouse.x = innerWidth / 2 + Math.cos(a) * 300; mouse.y = innerHeight / 2 + Math.sin(a) * 300; mouse.down = !!m && bd < 300 && !me.tired }, 16) }, mode);
(async () => {
  const A = await open('Alice', 'EC'), B = await open('Bob', 'EC'); await sleep(1200); const room = srv.rooms.get('EC'); room.bots.forEach(b => { b.alive = false; b.respawn = 9e9 });
  const pa = [...room.players.values()].find(p => p.name === 'Alice'), pb = [...room.players.values()].find(p => p.name === 'Bob'), st = p => p.evaluate(() => ({ kg: me.kg, en: me.en, kills: me.kills, mode: S.mode, hud: $('hudt').textContent, bar: $('enf').style.width, others: Object.values(peers).map(o => [o.name, o.kg]) }));
  console.log('Hiển thị kg & thanh thức ăn trên HUD');
  { const s = await st(A.page); assert(/Cân nặng: [0-9.]+ kg/.test(s.hud) && !/Điểm/.test(s.hud)); ok('HUD hiện "' + s.hud.slice(0, 40).replace(/\s+/g, ' ') + '…" (không còn điểm)');
    const lb = await A.page.evaluate(() => $('lb').textContent); assert(/Bảng xếp hạng \(kg\)/.test(lb) && /\d kg/.test(lb)); ok('bảng xếp hạng theo kg: "' + lb.slice(0, 60) + '…"'); }
  console.log('Chạy nhanh trên trình duyệt: thanh dự trữ tụt, cân nặng giảm');
  { pb.x = 300; pb.y = 300; room.food.forEach(f => { f.a = false; f.t = 1e9 }); pa.x = 2000; pa.y = 2000; pa.ang = Math.PI / 2; await A.page.evaluate(() => { mouse.has = true; mouse.x = innerWidth / 2; mouse.y = innerHeight / 2 + 300; mouse.down = true }); const e0 = await st(A.page); await sleep(2500); const e1 = await st(A.page);
    assert(e1.en < e0.en - 20 && e1.kg < e0.kg && parseFloat(e1.bar) < parseFloat(e0.bar)); ok(`giữ dash 2.5s: thanh ${e0.bar} → ${e1.bar}, cân nặng ${e0.kg.toFixed(2)} → ${e1.kg.toFixed(2)} kg`);
    await sleep(4500); const e2 = await st(A.page); assert(e2.en <= 10 && await A.page.evaluate(() => $('enw').classList.contains('low'))); ok(`sau ~7s thanh cạn (${e2.bar}), HUD báo đỏ "Hết sức"`);
    await A.page.evaluate(() => { mouse.down = false }); await sleep(100); await A.page.screenshot({ path: SHOTS + '/hud_energy_low.png' }); }
  console.log('Người chơi A nuốt người chơi B (trình duyệt thật)');
  { room.food.forEach(f => { f.t = 0 }); pa.en = 100; pa.tired = false; pa.kg = 60; pa.x = 1500; pa.y = 1500; pb.kg = 12; pb.x = 1500 + 260; pb.y = 1500; pb.ang = 0; await pilot(A.page, 1); const kg0 = pa.kg;
    await B.page.waitForFunction(() => S.mode === 'over', null, { timeout: 20000 }); await pilot(A.page, 0); await sleep(300);
    const go = await B.page.evaluate(() => $('gos').textContent); assert(/Bị nuốt bởi Alice/.test(go) && /Cân nặng cao nhất/.test(go)); ok('Bob thấy màn hình: "' + go.slice(0, 80) + '"'); await B.page.screenshot({ path: SHOTS + '/gameover_kg.png' });
    const s = await st(A.page); assert(s.kills === 1 && !s.others.some(o => o[0] === 'Bob')); ok(`Alice: đã nuốt ${s.kills}, Bob biến mất khỏi bản đồ của Alice; Alice ${kg0}kg → ${s.kg.toFixed(1)}kg`); }
  console.log('Cân nặng đồng bộ realtime giữa hai trình duyệt');
  { await B.page.click('#rs'); await B.page.waitForFunction(() => S.mode === 'play' && me.alive, null, { timeout: 8000 }); pa.kg = 40; pb.x = pa.x + 400; pb.y = pa.y; pa.inp.i = 1; await sleep(800);
    const r = []; for (const kg of [10.0, 14.5, 22.0]) { pb.kg = kg; pb.x = Math.min(pb.x, 3900); await sleep(500); const [a, b] = await Promise.all([A.page.evaluate(() => Object.values(peers).find(o => o.name === 'Bob').kg), B.page.evaluate(() => me.kg)]); assert(Math.abs(a - b) < .3 && Math.abs(b - kg) < .6, `${a} ${b} ${kg}`); r.push(`${b.toFixed(1)}↔${a.toFixed(1)}`) }
    ok('Bob đổi cân nặng 10 → 14.5 → 22 kg: Bob thấy ↔ Alice thấy = ' + r.join(', ')); }
  console.log('Hiệu ứng nuốt, nhãn kg trên đầu mèo');
  { await Promise.all([A.page, B.page].map(p => p.evaluate(() => { S.paused = true }))); // giữ 2 mèo đứng yên bằng chính cơ chế tạm dừng điều khiển của Settings online
    pa.kg = 70; pa.x = 2400; pa.y = 2400; pb.kg = 12; pb.x = 2400; pb.y = 2400 + 600; pa.inp.i = 1; pb.inp.i = 1;
    await A.page.evaluate(() => { cam.x = me.x; cam.y = me.y; clearInterval(window.__ap) }); await sleep(900); pb.x = pa.x + 90; pb.y = pa.y - 20; pb.kg = 20; await sleep(120);
    await A.page.screenshot({ path: SHOTS + '/labels_before.png' }); pa.inp.i = 1; pb.x = pa.x + 15; pb.y = pa.y; let fx = null; for (let i = 0; i < 30 && !fx; i++) { await sleep(30); fx = await A.page.evaluate(() => ghosts.length ? { ghosts: ghosts.length, floats: floats.length, gulp: me.gulp > 0 } : null) }
    assert(fx && fx.ghosts >= 1 && fx.floats >= 1 && fx.gulp); const tt = await A.page.evaluate(() => $('toast').textContent); assert(/Bạn nuốt Bob! \+[0-9.]+ kg/.test(tt), tt); await A.page.screenshot({ path: SHOTS + '/swallow_fx.png' }); ok('thông báo "' + tt + '"; hiệu ứng nuốt: mồi bị hút nhỏ dần (ghost) + chữ +kg bay lên + kẻ nuốt phình (gulp)'); }
  console.log('Bot nuốt người chơi trên trình duyệt');
  { await B.page.click('#rs'); await B.page.waitForFunction(() => S.mode === 'play' && me.alive, null, { timeout: 8000 }); await B.page.evaluate(() => { S.paused = true }); const bot = room.bots[0]; bot.alive = true; bot.ai.t = 99; bot.kg = 70; bot.x = 3000; bot.y = 1000; pb.kg = 10; pb.x = 3000 + 30; pb.y = 1000; pb.inp.i = 1; pa.x = 500; pa.y = 500;
    await B.page.waitForFunction(() => S.mode === 'over', null, { timeout: 15000 }); const go = await B.page.evaluate(() => $('gos').textContent); assert(go.includes(bot.name)); ok(`Bob bị bot "${bot.name}" nuốt: "${go.slice(0, 50)}"`); }
  assert(A.errs.length + B.errs.length === 0, 'JS errors: ' + A.errs.concat(B.errs)); ok('không có lỗi console ở cả hai trình duyệt');
  await A.browser.close(); await B.browser.close(); console.log(`\n${n} kiểm tra đạt.`); srv.stop(); process.exit(0);
})().catch(e => { console.error('✘ FAIL:', e.message); console.error((e.stack || '').split('\n').slice(0, 4).join('\n')); srv.stop(); process.exit(1) });
setTimeout(() => { console.error('TIMEOUT'); process.exit(2) }, 160000).unref();
