'use strict';
// KHÁNH MIU — mô phỏng thế giới phía server (server-authoritative).
// Logic cổng từ client gốc (move / think / eat / fight / dropFood) để cảm giác chơi giữ nguyên.
const R_ = require('../shared/rules'), Wire = require('../shared/wire');
const { W, TAU } = Object.assign({ TAU: R_.TAU }, R_.CFG), NF = 650, rad = R_.rad;
const CFG = Object.assign({
  BOTS: 7,
  MAX_PLAYERS: 12,          // giới hạn người chơi mỗi phòng
  FOOD_REGROW: 25,          // giây hạt thức ăn mọc lại
  DROP_LIFE: 60,            // giây thức ăn rơi ra tồn tại
  GRACE_MS: 10000,          // giữ mèo của người mất kết nối bao lâu trước khi xoá
  STALE_MS: 2000,           // quá lâu không có input -> mèo đứng yên
  PATE_V: 8, PATE_MAX: 3, PATE_EVERY: 6, PATE_P: 0.35, PATE_LIFE: 75,
  DOUBLE_DROP_HUMAN: true,  // giữ đúng hành vi bản gốc: người chơi chết rơi thức ăn 2 lần (xem README)
  HIST_TICKS: 20,           // lưu 1 giây lịch sử vị trí (20 tick) để bù trễ
  AOI_R: 1500,              // mèo trong bán kính này (quanh mèo của người nhận) được gửi 20 lần/giây
  FAR_EVERY: 4,             // mèo ở xa chỉ gửi 1/4 số tick (5 lần/giây; đủ cho minimap)
  SLOW_BYTES: 24576,        // client có >24KB chưa gửi xong = đang nghẽn: bỏ snapshot (sẽ bị ghi đè), giữ sự kiện
  KILL_BYTES: 524288,       // >512KB tồn đọng: ngắt kết nối thay vì kéo cả phòng
  PEND_MAX: 400             // số sự kiện tối đa giữ cho client chậm; vượt quá thì gửi lại toàn bộ trạng thái (resync)
}, {});
const ENC = new TextEncoder(), counters = { bytes: 0, msgs: 0, skipped: 0, resyncs: 0, killedSlow: 0 };
const rnd = (a, b) => a + Math.random() * (b - a), clamp = R_.clamp;
const BREED_COLORS = ['#b98a5a', '#f29a3c', '#2e2e38', '#f6f3f0', '#f6f3f0', '#26262e', '#eadcc2', '#d9d4e8', '#8fa0b5', '#dba444'];
const NAMES = ['Miu', 'Bông', 'Tom', 'Mun', 'Kitty', 'Lulu', 'Cốm', 'Tuna', 'Nabi', 'Mochi', 'Sushi', 'Bơ', 'Gấu', 'Xíu'];
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function shade(c, k) { const n = parseInt(c.slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255; return `rgb(${clamp(r * k | 0, 0, 255)},${clamp(g * k | 0, 0, 255)},${clamp(b * k | 0, 0, 255)})` }
const R = Math.round;

class Room {
  constructor(code, dif = 'normal') {
    this.code = code; this.dif = R_.DIFF[dif] ? dif : 'normal'; this.tickN = 0; this.t = 0; this.nextId = 1; this.dropId = 1; this.pateId = 1;
    this.players = new Map(); this.byPid = new Map(); this.bots = [];
    this.food = []; this.drops = new Map(); this.pates = new Map();
    this.ev = []; this.hist = []; this.metaDirty = true; this.pT = CFG.PATE_EVERY; this.emptySince = Date.now();
    const r = rng(777); // cùng seed với bản offline -> cùng bố cục hạt
    for (let i = 0; i < NF; i++) this.food.push({ x: 80 + r() * (W - 160), y: 80 + r() * (W - 160), v: r() < .12 ? 3 : 1, h: r() * 360, a: true, t: 0 });
    this.foodFlat = []; for (const f of this.food) this.foodFlat.push(R(f.x), R(f.y), f.v, R(f.h));
    for (let i = 0; i < CFG.BOTS; i++) this.bots.push(this.mkEnt(true));
  }
  newId() { for (;;) { const id = this.nextId; this.nextId = this.nextId % 60000 + 1; if (![...this.players.keys()].includes(id) && !this.bots.some(b => b.id === id)) return id } } // id u16 tái sử dụng an toàn
  mkEnt(bot, o = {}) {
    const bi = bot ? (Math.random() * 10 | 0) : o.bi;
    return {
      id: this.newId(), bot, name: bot ? NAMES[(Math.random() * NAMES.length) | 0] : o.name, bi,
      col: bot ? shade(BREED_COLORS[bi], rnd(.8, 1.1)) : o.col,
      x: rnd(300, W - 300), y: rnd(300, W - 300), ang: rnd(0, TAU), vx: 0, vy: 0,
      alive: true, kills: 0, ai: { t: 0, tx: 0, ty: 0, flee: false, dsh: false }, respawn: 0, rtt: 0, ...R_.newBody({}, bot ? rnd(10, 40) : R_.CFG.SPAWN_KG)
    };
  }
  humans() { return this.players.size }
  connected() { let n = 0; for (const p of this.players.values()) if (p.ws) n++; return n }
  alive() { const a = []; for (const p of this.players.values()) if (p.alive) a.push(p); for (const b of this.bots) if (b.alive) a.push(b); return a }
  safeSpot() { // chọn điểm hồi sinh xa các mèo khác
    const list = this.alive(); let best = null, bd = -1;
    for (let k = 0; k < 8; k++) {
      const x = rnd(800, W - 800), y = rnd(800, W - 800); let md = 1e9;
      for (const o of list) md = Math.min(md, Math.hypot(o.x - x, o.y - y) - rad(o.kg));
      if (md > bd) { bd = md; best = [x, y] }
    }
    return best;
  }
  spawn(p, o) {
    const [x, y] = this.safeSpot();
    Object.assign(p, { name: o.name, bi: o.bi, col: o.col, ang: rnd(0, TAU), vx: 0, vy: 0, alive: true, kills: 0 }); R_.teleport(p, x, y); R_.newBody(p, R_.CFG.SPAWN_KG); for (const h of this.hist) h.delete(p.id); // hồi sinh: xoá lịch sử vị trí cũ để bù trễ không "nhìn thấy" chỗ cũ
    p.inp = { a: p.ang, d: 0, i: 0, at: Date.now(), ct: 0 }; this.metaDirty = true;
  }
  addPlayer(pid, ws, o, spawn) {
    const p = this.mkEnt(false, o); p.pid = pid; p.ws = ws; p.disc = null; p.alive = false;
    p.inp = { a: 0, d: 0, i: 0, at: Date.now(), ct: 0 };
    p.pend = []; p.needMeta = false; p.resync = false; this.players.set(p.id, p); this.byPid.set(pid, p);
    if (spawn) this.spawn(p, o);
    this.metaDirty = true; this.ev.push(['j', p.name, p.id]); return p;
  }
  removePlayer(p) {
    this.players.delete(p.id); this.byPid.delete(p.pid); this.metaDirty = true; this.ev.push(['l', p.name, p.id]);
    if (!this.players.size) this.emptySince = Date.now();
  }
  meta() { const m = {}; for (const p of this.players.values()) m[p.id] = [p.name, p.bi, p.col, 0]; for (const b of this.bots) m[b.id] = [b.name, b.bi, b.col, 1]; return m }
  welcome(p, resumed) {
    const off = []; this.food.forEach((f, i) => { if (!f.a) off.push(i) });
    return {
      t: 'welcome', id: p.id, room: this.code, W, max: CFG.MAX_PLAYERS, resumed: !!resumed, players: this.connected(), n: this.tickN, dif: this.dif,
      v: Wire.PROTO, you: p.alive ? [R(p.x), R(p.y), R(p.kg * 10) / 10, R(p.en)] : null,
      food: this.foodFlat, off, meta: this.meta(),
      drops: [...this.drops.values()].map(d => [d.id, R(d.x), R(d.y), d.v, R(d.h)]),
      pates: [...this.pates.values()].map(q => [q.id, R(q.x), R(q.y)])
    };
  }
  dropFood(x, y, m) {
    const pl = R_.dropPlan(m), n = pl.n;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), d = rnd(5, rad(m) * 1.6);
      const f = { id: this.dropId++, x: R(clamp(x + Math.cos(a) * d, 40, W - 40)), y: R(clamp(y + Math.sin(a) * d, 40, W - 40)), v: +pl.v.toFixed(3), h: R(rnd(0, 360)), l: CFG.DROP_LIFE };
      this.drops.set(f.id, f); this.ev.push(['d+', f.id, f.x, f.y, f.v, f.h]);
    }
  }
  spawnPate(x, y) {
    const q = { id: this.pateId++, x: R(x), y: R(y), l: CFG.PATE_LIFE };
    this.pates.set(q.id, q); this.ev.push(['p+', q.id, q.x, q.y]); return q;
  }
  eat(e) {
    const r = rad(e.kg), F = this.food;
    for (let i = 0; i < F.length; i++) {
      const f = F[i];
      if (f.a && Math.abs(f.x - e.x) < r + 8 && Math.abs(f.y - e.y) < r + 8 && Math.hypot(f.x - e.x, f.y - e.y) < r + 6) {
        f.a = false; f.t = this.t + CFG.FOOD_REGROW; R_.feed(e, f.v); this.ev.push(['f-', i, e.id]);
      }
    }
    for (const [id, f] of this.drops) if (Math.hypot(f.x - e.x, f.y - e.y) < r + 8) { this.drops.delete(id); R_.feed(e, f.v); this.ev.push(['d-', id, e.id]) }
    // PATE: xoá khỏi Map ngay khi có người ăn -> không thể có 2 người cùng nhận thưởng
    for (const [id, q] of this.pates) if (Math.hypot(q.x - e.x, q.y - e.y) < r + 14) { this.pates.delete(id); R_.feed(e, CFG.PATE_V); this.ev.push(['p-', id, e.id, q.x, q.y]) }
  }
  think(b, dt, list) { R_.think(b, dt, list, [this.food, this.drops.values(), this.pates.values()], this.dif) }
  // Vị trí của b tại thời điểm (now - ms) theo lịch sử tick; dùng để bù trễ cho người chơi thật.
  rewind(b, ms) {
    const H = this.hist, k = ms / 50, i0 = Math.floor(k), fr = k - i0;
    const e0 = H[H.length - 1 - i0], e1 = H[H.length - 2 - i0];
    const p0 = e0 && e0.get(b.id); if (!p0) return b;
    const p1 = e1 && e1.get(b.id); if (!p1) return { x: p0[0], y: p0[1] };
    return { x: p0[0] + (p1[0] - p0[0]) * fr, y: p0[1] + (p1[1] - p0[1]) * fr };
  }
  lagOf(a) { return a.bot ? 0 : Math.min(R_.CFG.LAG_MAX_MS, (a.rtt || 0) + R_.CFG.INTERP_MS) }
  kill(a, b) {
    const { gain, preyKg } = R_.applySwallow(a, b);
    this.dropFood(b.x, b.y, preyKg);
    if (!b.bot && CFG.DOUBLE_DROP_HUMAN) this.dropFood(b.x, b.y, preyKg);
    if (b.bot) b.respawn = 3; else b.dashing = false;
    this.ev.push(['k', a.id, b.id, R(b.x), R(b.y), a.name, R(gain * 10) / 10, R(preyKg * 10) / 10]);
  }
  // Quỹ đạo mục tiêu trong tick, theo góc nhìn của kẻ săn: người chơi thật được bù trễ (tua lại RTT + độ trễ nội suy), bot thì dùng quỹ đạo thật.
  trackFor(a, b) {
    const L = this.lagOf(a); if (L <= 0) return null;
    const p0 = this.rewind(b, L + 50), p1 = this.rewind(b, L);
    // Chặn gian lận/sai sót: mục tiêu không thể đã ở xa chỗ hiện tại hơn quãng nó chạy được trong (L+50)ms (kể cả dịch chuyển/hồi sinh); vượt thì không bù trễ.
    const maxShift = R_.speedOf(b.kg, true) * (L + 100) / 1000 + 40;
    if (Math.hypot(p0.x - b.x, p0.y - b.y) > maxShift || Math.hypot(p1.x - b.x, p1.y - b.y) > maxShift) return null;
    return { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y };
  }
  fight() {
    const list = this.alive();
    // Một hệ thống duy nhất cho người-người, người-bot, bot-người, bot-bot; va chạm quét nên chạy nhanh cũng không xuyên qua mồi.
    for (const [a, b] of R_.findSwallows(list, (x, y) => this.trackFor(x, y))) if (a.alive && b.alive) this.kill(a, b);
  }
  step(dt, now) {
    this.t += dt;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const idle = !p.ws || p.inp.i || (now - p.inp.at > CFG.STALE_MS);
      if (idle) { p.px = p.x; p.py = p.y; p.dashing = false; p.vx = p.vy = 0; R_.restEnergy(p, dt) } else R_.stepBody(p, dt, p.inp.a, p.inp.d);
      this.eat(p);
    }
    const list = this.alive();
    for (const b of this.bots) {
      if (!b.alive) continue;
      this.think(b, dt, list);
      R_.stepBody(b, dt, R_.botHeading(b, this.dif), b.ai.dsh); this.eat(b);
    }
    this.fight();
    const snap = new Map(); for (const e of this.alive()) snap.set(e.id, [e.x, e.y]);
    this.hist.push(snap); if (this.hist.length > CFG.HIST_TICKS) this.hist.shift();
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (!b.alive) { b.respawn -= dt; if (b.respawn <= 0) { this.bots[i] = this.mkEnt(true); this.metaDirty = true } }
    }
    for (let i = 0; i < this.food.length; i++) { const f = this.food[i]; if (!f.a && this.t > f.t) { f.a = true; this.ev.push(['f+', i]) } }
    for (const [id, d] of this.drops) { d.l -= dt; if (d.l <= 0) { this.drops.delete(id); this.ev.push(['d-', id, 0]) } }
    this.pT -= dt;
    if (this.pT <= 0) { this.pT = CFG.PATE_EVERY; if (this.pates.size < CFG.PATE_MAX && Math.random() < CFG.PATE_P) this.spawnPate(rnd(200, W - 200), rnd(200, W - 200)) }
    for (const [id, q] of this.pates) { q.l -= dt; if (q.l <= 0) { this.pates.delete(id); this.ev.push(['p-', id, 0, q.x, q.y]) } }
    for (const p of [...this.players.values()]) if (p.disc && now - p.disc > CFG.GRACE_MS) this.removePlayer(p);
  }
  // ---- Gửi dữ liệu: snapshot nhị phân riêng cho từng client (vùng quan tâm + ack riêng), sự kiện JSON gộp 1 lần/tick ----
  out(ws, d) { counters.bytes += typeof d === 'string' ? Buffer.byteLength(d) : d.byteLength; counters.msgs++; try { ws.send(d) } catch (e) { } }
  tick(dt, now) {
    this.step(dt, now); this.tickN++; const n = this.tickN, ROW = Wire.ROW;
    const ents = []; for (const p of this.players.values()) if (p.alive) ents.push(p); for (const b of this.bots) if (b.alive) ents.push(b);
    const block = new Uint8Array(ents.length * ROW), dv = new DataView(block.buffer); ents.forEach((e, i) => Wire.packRow(dv, i * ROW, e.id, e.x, e.y, e.kg, e.ang, e.dashing));
    const metaStr = this.metaDirty ? JSON.stringify({ t: 'meta', ents: this.meta() }) : null; this.metaDirty = false;
    const evArr = this.ev, evBytes = evArr.length ? ENC.encode(JSON.stringify(evArr)) : null; this.ev = [];
    const A2 = CFG.AOI_R * CFG.AOI_R;
    for (const p of this.players.values()) {
      const ws = p.ws; if (!ws || ws.readyState !== 1) continue;
      const buffered = ws.bufferedAmount;
      if (buffered > CFG.KILL_BYTES) { counters.killedSlow++; ws.terminate(); continue }
      if (buffered > CFG.SLOW_BYTES) { // client mạng yếu: không đẩy thêm; snapshot bị bỏ (cái sau ghi đè), sự kiện được giữ lại
        counters.skipped++; if (metaStr) p.needMeta = true;
        if (evBytes && !p.resync) { p.pend.push(...evArr); if (p.pend.length > CFG.PEND_MAX) { p.pend = []; p.resync = true } } // đã chờ resync thì bỏ qua sự kiện: bản trạng thái mới đã bao gồm chúng
        continue;
      }
      if (p.resync) { p.resync = false; counters.resyncs++; const w = this.welcome(p, true); w.resync = true; this.out(ws, JSON.stringify(w)); continue }
      if (metaStr || p.needMeta) { p.needMeta = false; this.out(ws, metaStr || JSON.stringify({ t: 'meta', ents: this.meta() })) }
      let ev = evBytes; if (p.pend.length) { ev = ENC.encode(JSON.stringify(p.pend.concat(evArr))); p.pend = [] } // client vừa hết nghẽn: gửi bù các sự kiện đã giữ
      const idx = [];
      for (let i = 0; i < ents.length; i++) { const e = ents[i]; const dx = e.x - p.x, dy = e.y - p.y; const near = p.alive && (e === p || dx * dx + dy * dy < A2); if (near || ((n + e.id) % CFG.FAR_EVERY) === 0) idx.push(i) }
      this.out(ws, Wire.buildFrame(n, block, idx, p.alive ? { ct: p.inp.ct, age: Math.min(1000, now - p.inp.at), en: R(p.en), tired: p.tired, kills: p.kills } : null, ev));
    }
  }
}
module.exports = { Room, CFG, W, rad, counters };
