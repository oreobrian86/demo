'use strict';
// Đo khả năng người chơi (trình duyệt thật) nuốt bot khi có độ trễ mạng. Dùng: node test/latency-chase.js <oneWayMs> [giây]
process.env.MAX_CONN_PER_IP = '100';
const { chromium } = require('playwright'); const { start } = require('../server/server'); const { delayProxy } = require('./lib/delayproxy');
const oneWay = +process.argv[2] || 0, secs = +process.argv[3] || 40, sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const srv = start(0), sp = srv.server.address().port, px = await delayProxy(sp, oneWay);
  const b = await chromium.launch(), pg = await (await b.newContext({ viewport: { width: 900, height: 600 } })).newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://localhost:${sp}/?room=CH${oneWay}&server=ws://localhost:${px.port}`); await pg.fill('#nm', 'Hunter'); await pg.click('#play');
  await pg.waitForFunction(() => S.online && me && me.alive, null, { timeout: 20000 }); await sleep(800);
  const room = srv.rooms.get('CH' + oneWay), h = [...room.players.values()][0]; h.kg = 60; // đủ lớn để nuốt phần lớn bot (sắp đặt tiền điều kiện)
  await pg.evaluate(() => { window.__c = new Set(); window.__k = []; const o = onEv; onEv = function (ev) { if (ev[0] === 'k' && ev[1] === net.id) __k.push(ev[2]); return o(ev) };
    clearInterval(window.__ap); window.__ap = setInterval(() => { if (!me || !me.alive) return; let best = null, bd = 1e9;
      for (const o of Object.values(peers)) { if (!o.alive || o.kg * 2.2 > me.kg) continue; const d = Math.hypot(o.x - me.x, o.y - me.y); if (d < bd) { bd = d; best = o } }
      if (!best) { mouse.has = true; mouse.x = innerWidth / 2 + 300; mouse.y = innerHeight / 2; return }
      const a = Math.atan2(best.y - me.y, best.x - me.x); mouse.has = true; mouse.x = innerWidth / 2 + Math.cos(a) * 300; mouse.y = innerHeight / 2 + Math.sin(a) * 300; mouse.down = bd < 260 && !me.tired;
      if (bd < RL.reachOf({ kg: me.kg, dashing: me.dashing }, best.kg)) __c.add(best.id) }, 16) });
  await sleep(secs * 1000);
  const r = await pg.evaluate(() => ({ contacts: __c.size, kills: __k.length, ids: [...__c], killed: __k, kg: me.kg })); const conv = r.ids.filter(i => r.killed.includes(i)).length;
  console.log(JSON.stringify({ oneWayMs: oneWay, rttMs: oneWay * 2, secs, visualContacts: r.contacts, kills: r.kills, contactsConvertedToKill: conv, finalKg: +r.kg.toFixed(1), jsErrors: errs.length }));
  await b.close(); px.close(); srv.stop(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1) });
setTimeout(() => process.exit(2), 120000).unref();
