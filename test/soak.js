'use strict';
// Soak: server chạy như tiến trình riêng (như trên Render); nhiều client vào/ra liên tục + dữ liệu rác; kiểm tra log lỗi, bộ nhớ, /health.
const { spawn } = require('child_process'), http = require('http'), WebSocket = require('ws'), assert = require('assert');
const SECS = +process.argv[2] || 45, sleep = ms => new Promise(r => setTimeout(r, ms)), hex = () => Array.from({ length: 24 }, () => '0123456789abcdef'[Math.random() * 16 | 0]).join('');
const srv = spawn('node', ['--max-old-space-size=128', 'server/server.js'], { cwd: require('path').join(__dirname, '..'), env: Object.assign({}, process.env, { PORT: '0', MAX_CONN_PER_IP: '500' }) });
let out = '', err = ''; srv.stdout.on('data', d => out += d); srv.stderr.on('data', d => err += d);
const get = (port, p) => new Promise((res, rej) => http.get({ port, path: p, host: '127.0.0.1' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)) }).on('error', rej));
(async () => {
  const port = await new Promise(res => srv.stdout.on('data', d => { const m = /cổng (\d+)/.exec(String(d)); if (m) res(+m[1]) }));
  let joins = 0, kills = 0, msgs = 0, closed = 0, errsRecv = 0; const live = new Set(); const t0 = Date.now(); const rooms = ['S1', 'S2', 'S3'];
  let active = 0; const spawnClient = () => { active++; const room = rooms[Math.random() * 3 | 0], w = new WebSocket('ws://127.0.0.1:' + port); let iv = null, myId = null;
    w.on('open', () => { w.send(JSON.stringify({ t: 'join', v: 2, room, pid: hex(), name: 'S' + (joins++), bi: joins % 10, col: '#aa5500' })); live.add(w);
      iv = setInterval(() => { if (w.readyState !== 1) return; const r = Math.random(); if (r < .85) w.send(JSON.stringify({ t: 'in', a: Math.random() * 6.3, d: Math.random() < .3 ? 1 : 0, i: 0, c: Date.now() })); else if (r < .9) w.send('{broken'); else if (r < .95) w.send(JSON.stringify({ t: 'spawn', name: 'R' })); else w.send(JSON.stringify({ t: 'zzz', kg: 1e9 })) }, 50) });
    w.on('message', d => { msgs++; const m = JSON.parse(d); if (m.t === 'welcome') myId = m.id; if (m.t === 's') for (const e of m.e) if (e[0] === 'k') kills++; if (m.t === 'err') errsRecv++ });
    w.on('close', () => { clearInterval(iv); live.delete(w); closed++; active-- }); w.on('error', () => { });
    setTimeout(() => { if (w.readyState === 1) (Math.random() < .5 ? w.close() : w.terminate()) }, 3000 + Math.random() * 12000) };
  for (let i = 0; i < 24; i++) spawnClient();
  while (Date.now() - t0 < SECS * 1000) { await sleep(400); while (active < 24) spawnClient() }
  const h = JSON.parse(await get(port, '/health')); const rss = (await new Promise(res => { const p = spawn('ps', ['-o', 'rss=', '-p', srv.pid]); let o = ''; p.stdout.on('data', d => o += d); p.on('close', () => res(+o / 1024)) }));
  live.forEach(w => w.terminate()); await sleep(500); srv.kill();
  console.log(JSON.stringify({ secs: SECS, joins, closedSockets: closed, messagesReceived: msgs, killEventsSeen: kills, health: h, serverRssMB: +rss.toFixed(1), serverStderr: err.trim() || '(trống)', serverStdout: out.trim().split('\n').slice(-2) }));
  assert(!err.trim(), 'server stderr: ' + err); assert(h.ok && rss < 150); console.log('✔ Server sống sót, không ghi lỗi, /health ok, RAM hợp lý'); process.exit(0);
})().catch(e => { console.error('✘ FAIL', e.message); srv.kill(); process.exit(1) });
setTimeout(() => { srv.kill(); console.error('TIMEOUT'); process.exit(2) }, 120000).unref();
