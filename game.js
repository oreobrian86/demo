'use strict';
// KHÁNH MIU — mô phỏng thế giới phía server (server-authoritative).
// Logic cổng từ client gốc (move / think / eat / fight / dropFood) để cảm giác chơi giữ nguyên.
const W = 4200, NF = 650, TAU = Math.PI * 2;
const CFG = {
  BOTS: 7,
  MAX_PLAYERS: 12,          // giới hạn người chơi mỗi phòng
  FOOD_REGROW: 25,          // giây hạt thức ăn mọc lại
  DROP_LIFE: 60,            // giây thức ăn rơi ra tồn tại
  GRACE_MS: 10000,          // giữ mèo của người mất kết nối bao lâu trước khi xoá
  STALE_MS: 2000,           // quá lâu không có input -> mèo đứng yên
  PATE_V: 8,                // giá trị dinh dưỡng của PATE (hạt thường = 1, hạt đặc biệt = 3)
  PATE_MAX: 3,              // số pate tối đa cùng lúc trên bản đồ
  PATE_EVERY: 6,            // cứ mỗi N giây thử sinh 1 pate
  PATE_P: 0.35,             // xác suất sinh mỗi lần thử  (~1 pate / 17s, rất hiếm so với 650 hạt)
  PATE_LIFE: 75,            // giây pate tồn tại nếu không ai ăn
  DOUBLE_DROP_HUMAN: true   // giữ đúng hành vi bản gốc: người chơi chết rơi thức ăn 2 lần (xem README)
};
const rnd = (a, b) => a + Math.random() * (b - a), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BREED_COLORS = ['#b98a5a', '#f29a3c', '#2e2e38', '#f6f3f0', '#f6f3f0', '#26262e', '#eadcc2', '#d9d4e8', '#8fa0b5', '#dba444'];
const NAMES = ['Miu', 'Bông', 'Tom', 'Mun', 'Kitty', 'Lulu', 'Cốm', 'Tuna', 'Nabi', 'Mochi', 'Sushi', 'Bơ', 'Gấu', 'Xíu'];
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function shade(c, k) { const n = parseInt(c.slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255; return `rgb(${clamp(r * k | 0, 0, 255)},${clamp(g * k | 0, 0, 255)},${clamp(b * k | 0, 0, 255)})` }
const rad = m => 12 + 3.2 * Math.sqrt(m);
const R = Math.round;

function move(e, dt, ta, dash) {
  let da = ta - e.ang; da = Math.atan2(Math.sin(da), Math.cos(da)); e.ang += clamp(da, -6 * dt, 6 * dt);
  let sp = 215 * Math.pow(rad(e.m) / 14, -.22);
  if (dash && e.m > 12) { sp *= 1.75; e.m -= dt * (1.2 + e.m * .012); e.dashing = true } else e.dashing = false;
  e.vx = Math.cos(e.ang) * sp; e.vy = Math.sin(e.ang) * sp; e.x += e.vx * dt; e.y += e.vy * dt;
  const r = rad(e.m); e.x = clamp(e.x, r, W - r); e.y = clamp(e.y, r, W - r);
  if (e.m > 30) e.m -= e.m * .0015 * dt;
}

class Room {
  constructor(code) {
    this.code = code; this.t = 0; this.nextId = 1; this.dropId = 1; this.pateId = 1;
    this.players = new Map(); this.byPid = new Map(); this.bots = [];
    this.food = []; this.drops = new Map(); this.pates = new Map();
    this.ev = []; this.metaDirty = true; this.pT = CFG.PATE_EVERY; this.emptySince = Date.now();
    const r = rng(777); // cùng seed với bản offline -> cùng bố cục hạt
    for (let i = 0; i < NF; i++) this.food.push({ x: 80 + r() * (W - 160), y: 80 + r() * (W - 160), v: r() < .12 ? 3 : 1, h: r() * 360, a: true, t: 0 });
    this.foodFlat = []; for (const f of this.food) this.foodFlat.push(R(f.x), R(f.y), f.v, R(f.h));
    for (let i = 0; i < CFG.BOTS; i++) this.bots.push(this.mkEnt(true));
  }
  mkEnt(bot, o = {}) {
    const bi = bot ? (Math.random() * 10 | 0) : o.bi;
    return {
      id: this.nextId++, bot, name: bot ? NAMES[(Math.random() * NAMES.length) | 0] : o.name, bi,
      col: bot ? shade(BREED_COLORS[bi], rnd(.8, 1.1)) : o.col,
      x: rnd(300, W - 300), y: rnd(300, W - 300), m: bot ? rnd(10, 40) : 10, ang: rnd(0, TAU), vx: 0, vy: 0,
      dashing: false, alive: true, kills: 0, sc: 0, ai: { t: 0, tx: 0, ty: 0, flee: false, dsh: false }, respawn: 0
    };
  }
  humans() { return this.players.size }
  connected() { let n = 0; for (const p of this.players.values()) if (p.ws) n++; return n }
  alive() { const a = []; for (const p of this.players.values()) if (p.alive) a.push(p); for (const b of this.bots) if (b.alive) a.push(b); return a }
  safeSpot() { // chọn điểm hồi sinh xa các mèo khác
    const list = this.alive(); let best = null, bd = -1;
    for (let k = 0; k < 8; k++) {
      const x = rnd(800, W - 800), y = rnd(800, W - 800); let md = 1e9;
      for (const o of list) md = Math.min(md, Math.hypot(o.x - x, o.y - y) - rad(o.m));
      if (md > bd) { bd = md; best = [x, y] }
    }
    return best;
  }
  spawn(p, o) {
    const [x, y] = this.safeSpot();
    Object.assign(p, { name: o.name, bi: o.bi, col: o.col, x, y, m: 10, ang: rnd(0, TAU), vx: 0, vy: 0, dashing: false, alive: true, kills: 0, sc: 0 });
    p.inp = { a: p.ang, d: 0, i: 0, at: Date.now() }; this.metaDirty = true;
  }
  addPlayer(pid, ws, o, spawn) {
    const p = this.mkEnt(false, o); p.pid = pid; p.ws = ws; p.disc = null; p.alive = false;
    p.inp = { a: 0, d: 0, i: 0, at: Date.now() };
    this.players.set(p.id, p); this.byPid.set(pid, p);
    if (spawn) this.spawn(p, o);
    this.metaDirty = true; this.ev.push(['j', p.name, p.id]); return p;
  }
  removePlayer(p) {
    this.players.delete(p.id); this.byPid.delete(p.pid); this.metaDirty = true; this.ev.push(['l', p.name]);
    if (!this.players.size) this.emptySince = Date.now();
  }
  meta() { const m = {}; for (const p of this.players.values()) m[p.id] = [p.name, p.bi, p.col, 0]; for (const b of this.bots) m[b.id] = [b.name, b.bi, b.col, 1]; return m }
  welcome(p, resumed) {
    const off = []; this.food.forEach((f, i) => { if (!f.a) off.push(i) });
    return {
      t: 'welcome', id: p.id, room: this.code, W, max: CFG.MAX_PLAYERS, resumed: !!resumed, n: this.connected(),
      you: p.alive ? [R(p.x), R(p.y), R(p.m * 10) / 10] : null,
      food: this.foodFlat, off, meta: this.meta(),
      drops: [...this.drops.values()].map(d => [d.id, R(d.x), R(d.y), d.v, R(d.h)]),
      pates: [...this.pates.values()].map(q => [q.id, R(q.x), R(q.y)])
    };
  }
  addMass(e, v) { e.m += v * 1.5 / (1 + e.m / 110); e.sc += v * 8 }
  dropFood(x, y, m) {
    const n = Math.min(45, Math.max(4, m / 2.2 | 0));
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), d = rnd(5, rad(m) * 1.6);
      const f = { id: this.dropId++, x: R(clamp(x + Math.cos(a) * d, 40, W - 40)), y: R(clamp(y + Math.sin(a) * d, 40, W - 40)), v: +(m * .55 / n + .4).toFixed(3), h: R(rnd(0, 360)), l: CFG.DROP_LIFE };
      this.drops.set(f.id, f); this.ev.push(['d+', f.id, f.x, f.y, f.v, f.h]);
    }
  }
  spawnPate(x, y) {
    const q = { id: this.pateId++, x: R(x), y: R(y), l: CFG.PATE_LIFE };
    this.pates.set(q.id, q); this.ev.push(['p+', q.id, q.x, q.y]); return q;
  }
  eat(e) {
    const r = rad(e.m), F = this.food;
    for (let i = 0; i < F.length; i++) {
      const f = F[i];
      if (f.a && Math.abs(f.x - e.x) < r + 8 && Math.abs(f.y - e.y) < r + 8 && Math.hypot(f.x - e.x, f.y - e.y) < r + 6) {
        f.a = false; f.t = this.t + CFG.FOOD_REGROW; this.addMass(e, f.v); this.ev.push(['f-', i, e.id]);
      }
    }
    for (const [id, f] of this.drops) if (Math.hypot(f.x - e.x, f.y - e.y) < r + 8) { this.drops.delete(id); this.addMass(e, f.v); this.ev.push(['d-', id, e.id]) }
    // PATE: xoá khỏi Map ngay khi có người ăn -> không thể có 2 người cùng nhận thưởng
    for (const [id, q] of this.pates) if (Math.hypot(q.x - e.x, q.y - e.y) < r + 14) { this.pates.delete(id); this.addMass(e, CFG.PATE_V); this.ev.push(['p-', id, e.id, q.x, q.y]) }
  }
  think(b, dt, list) {
    const a = b.ai; a.t -= dt; if (a.t > 0) return; a.t = rnd(.25, .5);
    const r = rad(b.m); let thr = null, prey = null, td = 520, pd = 420;
    for (const o of list) {
      if (o === b) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y), ro = rad(o.m);
      if (ro > r * 1.15 && d < td) { thr = o; td = d } else if (r > ro * 1.25 && d < pd) { prey = o; pd = d }
    }
    a.dsh = false;
    if (thr) { a.flee = true; a.tx = b.x - (thr.x - b.x); a.ty = b.y - (thr.y - b.y); a.dsh = td < r * 3.5 && b.m > 14; return }
    a.flee = false;
    if (prey) { a.tx = prey.x + (prey.vx || 0) * .3; a.ty = prey.y + (prey.vy || 0) * .3; a.dsh = pd < r * 4 && b.m > 16; return }
    let bd = 700, bf = null;
    for (const f of this.food) { if (!f.a) continue; const d = Math.abs(f.x - b.x) + Math.abs(f.y - b.y); if (d < bd) { bd = d; bf = f } }
    for (const f of this.drops.values()) { const d = Math.abs(f.x - b.x) + Math.abs(f.y - b.y); if (d < bd) { bd = d; bf = f } }
    for (const f of this.pates.values()) { const d = Math.abs(f.x - b.x) + Math.abs(f.y - b.y); if (d < bd) { bd = d; bf = f } }
    if (bf) { a.tx = bf.x; a.ty = bf.y } else if (Math.hypot(a.tx - b.x, a.ty - b.y) < 80 || !a.tx) { a.tx = rnd(200, W - 200); a.ty = rnd(200, W - 200) }
  }
  kill(a, b) {
    const bm = b.m; b.alive = false; this.addMass(a, bm * .25); a.kills++; a.sc += bm * 6;
    this.dropFood(b.x, b.y, bm);
    if (!b.bot && CFG.DOUBLE_DROP_HUMAN) this.dropFood(b.x, b.y, bm);
    if (b.bot) b.respawn = 3; else b.dashing = false;
    this.ev.push(['k', a.id, b.id, R(b.x), R(b.y), a.name]);
  }
  fight() {
    const list = this.alive();
    for (const a of list) {
      if (!a.alive) continue;
      for (const b of list) {
        if (a === b || !a.alive || !b.alive) continue;
        const ra = rad(a.m), rb = rad(b.m), d = Math.hypot(a.x - b.x, a.y - b.y), need = a.dashing ? 1.1 : 1.22;
        if (ra >= rb * need && d < ra * .85 + rb * .15) this.kill(a, b);
      }
    }
  }
  step(dt, now) {
    this.t += dt;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const idle = !p.ws || p.inp.i || (now - p.inp.at > CFG.STALE_MS);
      if (idle) { p.dashing = false; p.vx = p.vy = 0 } else move(p, dt, p.inp.a, p.inp.d);
      this.eat(p);
    }
    const list = this.alive();
    for (const b of this.bots) {
      if (!b.alive) continue;
      this.think(b, dt, list);
      let ta = Math.atan2(b.ai.ty - b.y, b.ai.tx - b.x); const r = rad(b.m);
      if (b.x < r + 120 || b.x > W - r - 120 || b.y < r + 120 || b.y > W - r - 120) ta = Math.atan2(W / 2 - b.y, W / 2 - b.x);
      move(b, dt, ta, b.ai.dsh); this.eat(b);
    }
    this.fight();
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
  snapshot() {
    const p = [], push = e => { if (e.alive) p.push([e.id, R(e.x), R(e.y), R(e.m * 10) / 10, R(e.ang * 100) / 100, e.dashing ? 1 : 0, R(e.sc), e.kills]) };
    for (const q of this.players.values()) push(q); for (const b of this.bots) push(b); return p;
  }
  broadcast(str) { for (const p of this.players.values()) if (p.ws && p.ws.readyState === 1 && p.ws.bufferedAmount < 1e6) p.ws.send(str) }
  tick(dt, now) {
    this.step(dt, now);
    if (this.metaDirty) { this.metaDirty = false; this.broadcast(JSON.stringify({ t: 'meta', ents: this.meta() })) }
    this.broadcast(JSON.stringify({ t: 's', p: this.snapshot(), e: this.ev })); this.ev = [];
  }
}
module.exports = { Room, CFG, W, rad };
