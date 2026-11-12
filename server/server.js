'use strict';
// KHÁNH MIU — server HTTP + WebSocket. Phục vụ cả index.html (tiện deploy 1 nơi) lẫn multiplayer.
const http = require('http'), fs = require('fs'), path = require('path'), { monitorEventLoopDelay } = require('perf_hooks');
const { WebSocketServer } = require('ws');
const { Room, CFG, counters } = require('./game'), Wire = require('../shared/wire'), R_ = require('../shared/rules');

const PROTOCOL = Wire.PROTO, TICK_MS = 50, MAX_ROOMS = +process.env.MAX_ROOMS || 40, MAX_CONN_PER_IP = +process.env.MAX_CONN_PER_IP || 10, IDLE_ROOM_MS = 60000;
const LOG_EVERY_S = process.env.LOG_STATS_EVERY_S === undefined ? 60 : +process.env.LOG_STATS_EVERY_S;
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const cleanRoom = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const cleanName = s => Array.from(String(s || '').replace(/[\u0000-\u001f<>&"'`\\]/g, '').trim()).slice(0, 12).join('') || 'Mèo';
const cleanDif = s => R_.DIF_NAMES.includes(s) ? s : 'normal';
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)) };
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] };

function start(port = process.env.PORT || 3000) {
  const rooms = new Map(), ipCount = new Map(), indexPath = path.join(__dirname, '..', 'index.html');
  // ----- thống kê / giám sát -----
  const loopLag = monitorEventLoopDelay({ resolution: 10 }); loopLag.enable();
  const S = { t0: Date.now(), tickMs: [], ticks: 0, last: null, win: null };
  const humansTotal = () => { let n = 0; for (const r of rooms.values()) n += r.connected(); return n };
  function sample() { // cửa sổ thống kê gần nhất (~5 giây)
    const now = Date.now(), cpu = process.cpuUsage(), cur = { t: now, cpu: cpu.user + cpu.system, bytes: counters.bytes, msgs: counters.msgs, ticks: S.ticks };
    if (S.last) { const dt = (now - S.last.t) / 1000, tm = S.tickMs.splice(0), rt = []; for (const r of rooms.values()) for (const p of r.players.values()) if (p.ws && p.rtt) rt.push(p.rtt); const m = process.memoryUsage();
      S.win = { windowS: +dt.toFixed(1), tickHz: +((cur.ticks - S.last.ticks) / dt).toFixed(1), tickMsAvg: +(tm.reduce((a, b) => a + b, 0) / Math.max(1, tm.length)).toFixed(3), tickMsP95: +q(tm, .95).toFixed(3), tickMsMax: +Math.max(0, ...tm).toFixed(2),
        eventLoopLagMs: { mean: +(loopLag.mean / 1e6).toFixed(2), p99: +(loopLag.percentile(99) / 1e6).toFixed(2), max: +(loopLag.max / 1e6).toFixed(2) }, cpuPctOfOneCore: +((cur.cpu - S.last.cpu) / 1e6 / dt * 100).toFixed(2),
        outKBps: +((cur.bytes - S.last.bytes) / dt / 1024).toFixed(2), outMsgsPerSec: +((cur.msgs - S.last.msgs) / dt).toFixed(1), pingMs: { avg: rt.length ? Math.round(rt.reduce((a, b) => a + b, 0) / rt.length) : 0, max: rt.length ? Math.round(Math.max(...rt)) : 0 },
        rssMB: +(m.rss / 1048576).toFixed(1), heapUsedMB: +(m.heapUsed / 1048576).toFixed(1) }; loopLag.reset() }
    S.last = cur }
  function metrics() { const rs = [...rooms.values()].map(r => ({ room: r.code, difficulty: r.dif, humans: r.connected(), bots: r.bots.filter(b => b.alive).length })); const players = humansTotal();
    return Object.assign({ ok: true, uptimeS: Math.round((Date.now() - S.t0) / 1000), version: 'v3', players, rooms: rs.length, roomList: rs, totals: { bytesOut: counters.bytes, msgsOut: counters.msgs, snapshotsSkippedSlowClient: counters.skipped, resyncs: counters.resyncs, slowClientsDisconnected: counters.killedSlow }, renderFreeBudget: 'Render Free = 0.1 CPU (10% of one core): keep cpuPctOfOneCore well below 10' }, S.win ? { window: S.win } : {}) }
  const logTimer = setInterval(() => { sample() }, 5000);
  const statLog = LOG_EVERY_S > 0 ? setInterval(() => { const w = S.win; if (!w || !humansTotal()) return; console.log(`[stats] players=${humansTotal()} rooms=${rooms.size} tick=${w.tickHz}Hz ${w.tickMsAvg}/${w.tickMsP95}/${w.tickMsMax}ms(avg/p95/max) loopLag p99=${w.eventLoopLagMs.p99}ms max=${w.eventLoopLagMs.max}ms cpu=${w.cpuPctOfOneCore}% rss=${w.rssMB}MB out=${w.outKBps}KB/s ping avg=${w.pingMs.avg}ms max=${w.pingMs.max}ms skipped=${counters.skipped} resync=${counters.resyncs}`) }, LOG_EVERY_S * 1000) : null;
  sample();

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0]; res.setHeader('Access-Control-Allow-Origin', '*');
    if (url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: humansTotal() })) }
    if (url === '/metrics') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(metrics(), null, 1)) }
    if (url === '/' || url === '/index.html') { fs.readFile(indexPath, (err, buf) => { if (err) { res.writeHead(404); return res.end('index.html not found') } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(buf) }); return }
    res.writeHead(404); res.end('Not found');
  });
  const wss = new WebSocketServer({ server, maxPayload: 2048 });

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin;
    if (ALLOWED.length && origin && !ALLOWED.includes(origin)) return ws.close(4403, 'origin');
    const ip = ipOf(req), n = (ipCount.get(ip) || 0) + 1;
    if (n > MAX_CONN_PER_IP) return ws.close(4429, 'too many');
    ipCount.set(ip, n);
    ws.lastPong = Date.now(); ws.pingAt = 0;
    ws.on('pong', () => { const t = Date.now(); ws.lastPong = t; if (ws.pingAt && ws.player) { const r = t - ws.pingAt, p = ws.player; p.rtt = p.rtt ? p.rtt * .7 + r * .3 : r } }); // RTT do SERVER đo (client không thể khai man)
    let tokens = 100, lastRefill = Date.now();

    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      const now = Date.now(); tokens = Math.min(100, tokens + (now - lastRefill) / 1000 * 80); lastRefill = now;
      if (--tokens < 0) return; // chống flood
      let m; try { m = JSON.parse(raw) } catch (e) { return }
      if (!m || typeof m !== 'object') return;
      const p = ws.player, room = ws.room;
      if (m.t === 'join') {
        if (p) return;
        if (m.v !== PROTOCOL) return (send(ws, { t: 'err', msg: 'Phiên bản game đã cũ. Hãy tải lại trang (Ctrl+F5) rồi vào lại.' }), ws.close());
        const code = cleanRoom(m.room) || 'PUBLIC', dif = cleanDif(m.dif), key = code === 'PUBLIC' ? 'PUBLIC:' + dif : code; // phòng chung tách theo độ khó; phòng riêng theo độ khó của người tạo
        let r = rooms.get(key);
        if (!r) { if (rooms.size >= MAX_ROOMS) return (send(ws, { t: 'err', msg: 'Server đang quá tải phòng, thử lại sau.' }), ws.close()); r = new Room(code, dif); r.key = key; rooms.set(key, r) }
        const pid = /^[a-f0-9]{24}$/.test(m.pid) ? m.pid : null;
        if (!pid) return ws.close();
        const info = { name: cleanName(m.name), bi: Number.isInteger(m.bi) && m.bi >= 0 && m.bi < 10 ? m.bi : 0, col: /^#[0-9a-fA-F]{6}$/.test(m.col) ? m.col : '#b98a5a' };
        let pl = r.byPid.get(pid), resumed = false;
        if (pl) { if (pl.ws && pl.ws !== ws) { const old = pl.ws; pl.ws = null; old.close(4000, 'replaced') } pl.ws = ws; pl.disc = null; resumed = true }
        else { if (r.humans() >= CFG.MAX_PLAYERS) { send(ws, { t: 'err', msg: `Phòng ${code} đã đủ ${CFG.MAX_PLAYERS} người. Hãy tạo phòng khác.` }); return ws.close() } pl = r.addPlayer(pid, ws, info, m.sp !== 0) }
        ws.player = pl; ws.room = r; send(ws, r.welcome(pl, resumed)); return;
      }
      if (!p || !room) return;
      if (m.t === 'in') {
        if (Number.isFinite(m.a)) p.inp.a = m.a; p.inp.d = m.d ? 1 : 0; p.inp.i = m.i ? 1 : 0; p.inp.at = now;
        if (Number.isFinite(m.c)) p.inp.ct = Math.round(m.c) >>> 0; // mốc thời gian của client, chỉ để client tự đối chiếu vị trí; server KHÔNG tin vào nó cho luật chơi
      } else if (m.t === 'pg') { send(ws, { t: 'pg', c: Number.isFinite(m.c) ? m.c : 0 }) } // client đo ping hiển thị
      else if (m.t === 'spawn') {
        if (p.alive) return;
        room.spawn(p, { name: cleanName(m.name), bi: Number.isInteger(m.bi) && m.bi >= 0 && m.bi < 10 ? m.bi : p.bi, col: /^#[0-9a-fA-F]{6}$/.test(m.col) ? m.col : p.col });
        send(ws, { t: 'spawned', you: [Math.round(p.x), Math.round(p.y), p.kg, Math.round(p.en)] });
      } else if (m.t === 'leave') { ws.player = null; p.ws = null; room.removePlayer(p); ws.close() }
    });
    ws.on('close', () => {
      const c = (ipCount.get(ip) || 1) - 1; c ? ipCount.set(ip, c) : ipCount.delete(ip);
      const p = ws.player, room = ws.room; if (!p || p.ws !== ws) return;
      p.ws = null; if (p.alive) p.disc = Date.now(); else room.removePlayer(p); // mèo còn sống được giữ GRACE_MS để kết nối lại
    });
    ws.on('error', () => { });
  });

  // Vòng lặp game tự bù trễ: giữ đúng 20 tick/giây thay vì trôi dần như setInterval khi CPU bị bóp (Render Free chỉ có 0.1 CPU).
  let last = Date.now(), next = Date.now() + TICK_MS, loopT = null, stopped = false;
  const loop = () => {
    if (stopped) return; const t0 = process.hrtime.bigint(), now = Date.now(), dt = Math.min(.1, (now - last) / 1000); last = now;
    for (const [key, r] of rooms) { if (r.humans() === 0) { if (now - r.emptySince > IDLE_ROOM_MS) rooms.delete(key); continue } r.tick(dt, now) }
    S.tickMs.push(Number(process.hrtime.bigint() - t0) / 1e6); S.ticks++; next += TICK_MS; if (next < Date.now() - 200) next = Date.now(); loopT = setTimeout(loop, Math.max(0, next - Date.now()));
  };
  loopT = setTimeout(loop, TICK_MS);
  const hb = setInterval(() => { const t = Date.now(); wss.clients.forEach(ws => { if (t - ws.lastPong > 25000) return ws.terminate(); ws.pingAt = t; ws.ping() }) }, 2000);
  server.listen(port, () => { if (require.main === module) console.log(`KHÁNH MIU server chạy ở cổng ${server.address().port}`) });
  return { server, wss, rooms, metrics, stop() { stopped = true; clearTimeout(loopT); clearInterval(hb); clearInterval(logTimer); if (statLog) clearInterval(statLog); loopLag.disable(); wss.clients.forEach(c => c.terminate()); server.close() } };
}
if (require.main === module) start();
module.exports = { start };
