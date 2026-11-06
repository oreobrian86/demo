'use strict';
// 1) Chế độ offline vẫn chơi được (hồi quy)  2) Frontend ở origin khác + ?server= (mô phỏng GitHub Pages + backend riêng)  3) Không có server -> báo offline
process.env.MAX_CONN_PER_IP = '100';
const assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const { start } = require('../server/server'); const srv = start(0); const SP = srv.server.address().port;
const sleep = ms => new Promise(r => setTimeout(r, ms)); let n = 0; const ok = m => { n++; console.log('  ✔', m) };
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const stat = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(html) }).listen(0, '127.0.0.1');
(async () => {
  const b = await chromium.launch(); const errs = [];
  // --- offline
  let pg = await (await b.newContext({ viewport: { width: 900, height: 600 } })).newPage(); pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://localhost:${SP}/`); await pg.click('#off'); await sleep(500);
  let s = await pg.evaluate(() => ({ online: S.online, bots: bots.length, mode: S.mode, food: food.length })); assert(!s.online && s.bots === 7 && s.mode === 'play'); ok('Offline: 7 bot cục bộ, không dùng mạng');
  await pg.mouse.move(800, 300); await sleep(1200); await pg.click('#gear'); const x0 = await pg.evaluate(() => [me.x, me.y, bots[0].x, bots[0].y, S.t]); await sleep(1000);
  const x1 = await pg.evaluate(() => [me.x, me.y, bots[0].x, bots[0].y, S.t]); assert(x0.every((v, i) => v === x1[i])); ok('Offline + Settings: toàn bộ game tạm dừng (mèo, bot, đồng hồ đều đứng yên)');
  await pg.click('#resume'); await sleep(600); const x2 = await pg.evaluate(() => [me.x, S.t]); assert(x2[1] > x1[4]); ok('Offline: Resume chạy tiếp');
  await pg.evaluate(() => { pates.push({ id: 99, x: me.x + 20, y: me.y, l: 50 }); }); const m0 = await pg.evaluate(() => me.m); await sleep(500);
  const m1 = await pg.evaluate(() => ({ m: me.m, p: pates.length })); assert(m1.m > m0 + 5 && m1.p === 0); ok(`Offline: ăn pate tăng size ${m0.toFixed(1)} -> ${m1.m.toFixed(1)}`);
  await pg.click('#gear'); await pg.click('#tomenu'); await sleep(300); assert(await pg.evaluate(() => S.mode === 'menu' && bots.length === 7)); ok('Offline: Return to Main Menu');
  // --- cross-origin (GitHub Pages giả lập)
  const url = `http://127.0.0.1:${stat.address().port}/?server=ws://localhost:${SP}&room=XO`;
  const c1 = await (await b.newContext()).newPage(), c2 = await (await b.newContext()).newPage(); [c1, c2].forEach(p => p.on('pageerror', e => errs.push(e.message)));
  for (const [p, nm] of [[c1, 'Mai'], [c2, 'Nam']]) { await p.goto(url); await p.fill('#nm', nm); await p.click('#play'); await p.waitForFunction(() => S.online && me && me.alive, null, { timeout: 15000 }) }
  await sleep(1000);
  const sees = await c1.evaluate(() => Object.values(peers).filter(o => o.peer).map(o => o.name)); assert(sees.includes('Nam')); ok('Frontend ở origin :' + stat.address().port + ' + backend :' + SP + ' (khác origin): hai người vẫn gặp nhau');
  const inv = await c1.evaluate(() => inviteLink()); assert(/room=XO/.test(inv) && /server=/.test(inv)); ok('Link mời: ' + inv);
  // --- không có server cấu hình (file://)
  const f = await (await b.newContext()).newPage(); await f.goto('file://' + path.join(__dirname, '..', 'index.html')); await sleep(300);
  const msg = await f.evaluate(() => $('net').textContent); assert(/offline/.test(msg)); await f.click('#play'); await sleep(400); assert(await f.evaluate(() => S.mode === 'play' && !S.online)); ok('Không có server: START rơi về offline, thông báo "' + msg + '"');
  assert(errs.length === 0, errs.join()); ok('Không có lỗi JavaScript');
  await b.close(); stat.close(); srv.stop(); console.log(`\n${n} kiểm tra đạt.`); process.exit(0);
})().catch(e => { console.error('✘ FAIL:', e.message, (e.stack || '').split('\n')[1]); process.exit(1) });
setTimeout(() => { console.error('TIMEOUT'); process.exit(2) }, 90000).unref();
