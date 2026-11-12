'use strict';
// Client WebSocket dùng chung cho test: nói giao thức v3 (snapshot nhị phân + sự kiện nhúng trong khung), ghép dòng snapshot như client thật.
const WebSocket = require('ws'), Wire = require('../../shared/wire');
const hex = () => Array.from({ length: 24 }, () => '0123456789abcdef'[Math.random() * 16 | 0]).join('');
const toAB = d => d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
function makeClient(port, name, room, pid = hex(), opts = {}) {
  const c = { name, pid, events: [], ents: new Map(), seen: new Map(), snap: null, ack: null, ackObj: null, meta: {}, bytes: 0, frames: 0, closed: false, errors: [], off: new Set(), n: 0 };
  c.connect = () => new Promise(res => {
    c.ws = new WebSocket('ws://localhost:' + port);
    c.ws.on('open', () => c.ws.send(JSON.stringify({ t: 'join', v: opts.v || Wire.PROTO, room, pid: c.pid, name, bi: 1, col: '#ff8800', dif: opts.dif || 'normal' })));
    c.ws.on('message', (d, isBin) => {
      c.bytes += d.length; const now = Date.now();
      if (isBin) { const dec = Wire.decodeSnap(toAB(d)); if (!dec) return; c.frames++; c.n = dec.n;
        for (const r of dec.rows) { c.ents.set(r[0], r); c.seen.set(r[0], now) }
        if (dec.ack) { c.ackObj = dec.ack; c.ack = [c.id, dec.ack.ct, dec.ack.age, dec.ack.en, dec.ack.tired] }
        const evs = dec.ev || [];
        for (const e of evs) { c.events.push(e); if (e[0] === 'f-') c.off.add(e[1]); if (e[0] === 'f+') c.off.delete(e[1]); if (e[0] === 'k') { c.ents.delete(e[2]); c.seen.delete(e[2]) } if (e[0] === 'l') { c.ents.delete(e[2]); c.seen.delete(e[2]) } }
        for (const [id, t] of c.seen) if (now - t > 2500) { c.ents.delete(id); c.seen.delete(id) }
        c.snap = { n: dec.n, p: [...c.ents.values()], e: evs, k: c.ack ? [c.ack] : [] }; return }
      let m; try { m = JSON.parse(d) } catch (e) { return }
      if (m.t === 'welcome') { c.welcome = m; c.id = m.id; c.meta = m.meta; c.off = new Set(m.off); res(c) } else if (m.t === 'meta') c.meta = m.ents; else if (m.t === 'err') { c.errors.push(m); res(c) }
    });
    c.ws.on('close', () => { c.closed = true });
  });
  c.in = (a, d = 0, i = 0) => c.ws.send(JSON.stringify({ t: 'in', a, d, i, c: Date.now() % 1e9 }));
  // dòng của người chơi: [id,x,y,kg,góc,dash,kills]; kills lấy từ ack riêng
  c.me = id => { const r = c.ents.get(id || c.id); if (!r) return undefined; return (id || c.id) === c.id ? [...r, c.ackObj ? c.ackObj.kills : 0] : [...r, 0] };
  c.kills = () => c.events.filter(e => e[0] === 'k');
  return c;
}
module.exports = { makeClient, hex, toAB };
