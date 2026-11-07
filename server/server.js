'use strict';
// KHÁNH MIU — server HTTP + WebSocket. Phục vụ cả index.html (tiện deploy 1 nơi) lẫn multiplayer.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const { Room, CFG } = require('./game');

const PROTOCOL = 2, TICK_MS = 50, MAX_ROOMS = 40, MAX_CONN_PER_IP = +process.env.MAX_CONN_PER_IP || 10, IDLE_ROOM_MS = 60000;
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const rooms = new Map(), ipCount = new Map();
const cleanRoom = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const cleanName = s => Array.from(String(s || '').replace(/[\u0000-\u001f<>&"'`\\]/g, '').trim()).slice(0, 12).join('') || 'Mèo';
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)) };
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

function start(port = process.env.PORT || 3000) {
  const indexPath = path.join(__dirname, '..', 'index.html');
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (url === '/health') {
      let players = 0; for (const r of rooms.values()) players += r.connected();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, rooms: rooms.size, players }));
    }
    if (url === '/' || url === '/index.html') {
      fs.readFile(indexPath, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('index.html not found') }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(buf);
      });
      return;
    }
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

    ws.on('message', raw => {
      const now = Date.now(); tokens = Math.min(100, tokens + (now - lastRefill) / 1000 * 80); lastRefill = now;
      if (--tokens < 0) return; // chống flood
      let m; try { m = JSON.parse(raw) } catch (e) { return }
      if (!m || typeof m !== 'object') return;
      const p = ws.player, room = ws.room;
      if (m.t === 'join') {
        if (p) return;
        if (m.v !== PROTOCOL) return (send(ws, { t: 'err', msg: 'Phiên bản game đã cũ. Hãy tải lại trang (Ctrl+F5) rồi vào lại.' }), ws.close());
        const code = cleanRoom(m.room) || 'PUBLIC';
        let r = rooms.get(code);
        if (!r) { if (rooms.size >= MAX_ROOMS) return (send(ws, { t: 'err', msg: 'Server đang quá tải phòng, thử lại sau.' }), ws.close()); r = new Room(code); rooms.set(code, r) }
        const pid = /^[a-f0-9]{24}$/.test(m.pid) ? m.pid : null;
        if (!pid) return ws.close();
        const info = { name: cleanName(m.name), bi: Number.isInteger(m.bi) && m.bi >= 0 && m.bi < 10 ? m.bi : 0, col: /^#[0-9a-fA-F]{6}$/.test(m.col) ? m.col : '#b98a5a' };
        let pl = r.byPid.get(pid), resumed = false;
        if (pl) { // kết nối lại: gắn socket mới vào mèo cũ
          if (pl.ws && pl.ws !== ws) { const old = pl.ws; pl.ws = null; old.close(4000, 'replaced') }
          pl.ws = ws; pl.disc = null; resumed = true;
        } else {
          if (r.humans() >= CFG.MAX_PLAYERS) { send(ws, { t: 'err', msg: `Phòng ${code} đã đủ ${CFG.MAX_PLAYERS} người. Hãy tạo phòng khác.` }); return ws.close() }
          pl = r.addPlayer(pid, ws, info, m.sp !== 0);
        }
        ws.player = pl; ws.room = r; send(ws, r.welcome(pl, resumed)); return;
      }
      if (!p || !room) return;
      if (m.t === 'in') {
        if (Number.isFinite(m.a)) p.inp.a = m.a; p.inp.d = m.d ? 1 : 0; p.inp.i = m.i ? 1 : 0; p.inp.at = now;
        if (Number.isFinite(m.c)) p.inp.ct = Math.round(m.c); // mốc thời gian của client, chỉ dùng để client tự đối chiếu vị trí; server KHÔNG tin vào nó cho luật chơi
      } else if (m.t === 'spawn') {
        if (p.alive) return;
        room.spawn(p, { name: cleanName(m.name), bi: Number.isInteger(m.bi) && m.bi >= 0 && m.bi < 10 ? m.bi : p.bi, col: /^#[0-9a-fA-F]{6}$/.test(m.col) ? m.col : p.col });
        send(ws, { t: 'spawned', you: [Math.round(p.x), Math.round(p.y), p.kg, Math.round(p.en)] });
      } else if (m.t === 'leave') {
        ws.player = null; p.ws = null; room.removePlayer(p); ws.close();
      }
    });
    ws.on('close', () => {
      const c = (ipCount.get(ip) || 1) - 1; c ? ipCount.set(ip, c) : ipCount.delete(ip);
      const p = ws.player, room = ws.room;
      if (!p || p.ws !== ws) return;
      p.ws = null;
      if (p.alive) p.disc = Date.now(); else room.removePlayer(p); // mèo còn sống được giữ GRACE_MS để kết nối lại
    });
    ws.on('error', () => { });
  });

  let last = Date.now();
  const loop = setInterval(() => {
    const now = Date.now(), dt = Math.min(.1, (now - last) / 1000); last = now;
    for (const [code, r] of rooms) {
      if (r.humans() === 0) { if (now - r.emptySince > IDLE_ROOM_MS) rooms.delete(code); continue }
      r.tick(dt, now);
    }
  }, TICK_MS);
  const hb = setInterval(() => { const t = Date.now(); wss.clients.forEach(ws => { if (t - ws.lastPong > 25000) return ws.terminate(); ws.pingAt = t; ws.ping() }) }, 2000);
  server.listen(port, () => { if (require.main === module) console.log(`KHÁNH MIU server chạy ở cổng ${server.address().port}`) });
  return { server, wss, rooms, stop() { clearInterval(loop); clearInterval(hb); wss.clients.forEach(c => c.terminate()); server.close() } };
}
if (require.main === module) start();
module.exports = { start };
