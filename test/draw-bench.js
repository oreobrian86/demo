'use strict';
// Đo chi phí draw() của client với nhiều mèo + nhiều thức ăn trong khung nhìn. node test/draw-bench.js [thư mục project]
process.env.MAX_CONN_PER_IP = '999';
const dir = process.argv[2] || require('path').join(__dirname, '..'); const { chromium } = require('playwright'); const { start } = require(dir + '/server/server');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const srv = start(0), sp = srv.server.address().port, b = await chromium.launch(), pg = await (await b.newContext({ viewport: { width: 900, height: 600 } })).newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://localhost:${sp}/?room=DB`); await pg.fill('#nm', 'Bench'); await pg.click('#play'); await pg.waitForFunction(() => S.online && me && me.alive, null, { timeout: 15000 }); await sleep(800);
  const room = srv.rooms.get('DB'); const p = [...room.players.values()][0]; p.x = 2100; p.y = 2100; room.bots.forEach((x, i) => { x.alive = true; x.ai.t = 99; x.x = 2100 + Math.cos(i) * 300; x.y = 2100 + Math.sin(i) * 250; x.kg = 14 + i * 4 });
  for (let i = 0; i < 650; i++) { const f = room.food[i]; f.x = 2100 + (Math.random() - .5) * 900; f.y = 2100 + (Math.random() - .5) * 600; f.a = true; f.t = 0 }
  await sleep(1200); const r = await pg.evaluate(() => { const vis = food.filter(f => f.a && Math.abs(f.x - me.x) < 450 / cam.z && Math.abs(f.y - me.y) < 300 / cam.z).length; const ents = all().length; for (let i = 0; i < 30; i++) draw(); const N = 300, t0 = performance.now(); for (let i = 0; i < N; i++) draw(); const ms = (performance.now() - t0) / N;
    const t1 = performance.now(); for (let i = 0; i < 300; i++) stepFx(.016); const fxms = (performance.now() - t1) / 300; return { visibleFood: vis, entities: ents, drawMsAvg: +ms.toFixed(3), stepFxMsAvg: +fxms.toFixed(4), zoom: +cam.z.toFixed(2) } });
  p.kg = 230; await sleep(2500); const r2 = await pg.evaluate(() => { cam.z = .42; const vis = food.filter(f => f.a && Math.abs(f.x - me.x) < 450 / cam.z && Math.abs(f.y - me.y) < 300 / cam.z).length; for (let i = 0; i < 30; i++) draw(); const N = 300, t0 = performance.now(); for (let i = 0; i < N; i++) draw(); return { visibleFood: vis, entities: all().length, drawMsAvg: +((performance.now() - t0) / N).toFixed(3), zoom: +cam.z.toFixed(2) } });
  console.log(JSON.stringify({ normalView: r, zoomedOutView: r2 })); if (errs.length) console.log('ERR', errs.join()); await b.close(); srv.stop(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1) });
setTimeout(() => process.exit(2), 90000).unref();
