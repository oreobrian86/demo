/* KHÁNH MIU — LUẬT CHƠI DÙNG CHUNG (server + chế độ offline trong index.html).
 * Mọi thực thể (người chơi, bot) đi qua CÙNG các hàm này: không có nhánh riêng cho "người" hay "AI".
 * Sau khi sửa file này chạy:  node tools/sync-rules.js   (chép bản sao vào index.html; test sẽ kiểm tra khớp).
 * Đơn vị: kg (cân nặng). Cân nặng quyết định bán kính: rad(kg). */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.KMRules = factory() })(this, function () {
  'use strict';
  const CFG = {
    W: 4200,
    // ----- cân nặng (kg) -----
    SPAWN_KG: 10, MIN_KG: 6, MAX_KG: 250,   // xuất hiện / sàn không thể giảm thấp hơn / trần tăng trưởng
    FOOD_GAIN_K: 1.5, FOOD_GAIN_SOFT: 110,  // tăng = v*K/(1+kg/SOFT): càng nặng ăn càng tăng chậm
    DECAY_ABOVE: 30, DECAY_PER_SEC: .0015,  // trên 30kg hao dần 0.15%/s (chống tăng trưởng vô hạn)
    // ----- nuốt -----
    SWALLOW_WEIGHT_RATIO: 1.6,  // nặng hơn mục tiêu >= 1.6 lần mới nuốt được
    DASH_SWALLOW_RATIO: 1.4,    // khi đang lao (dash) ngưỡng hạ xuống 1.4 lần
    REACH_BODY: .85, REACH_PREY: .15, LUNGE_REACH: .6, // tầm với = ra*(0.85 + 0.6 nếu đang lao) + rb*0.15
    SWALLOW_GAIN: .25,          // nuốt mồi tăng thêm 25% cân nặng mồi (qua công thức ăn)
    SWALLOW_DROP: .55,          // mồi để lại thức ăn tổng trị giá 55% cân nặng
    // ----- tốc độ / chạy nhanh -----
    BASE_SPEED: 215, SPEED_EXP: .1, DASH_MULT: 1.75,
    ENERGY_MAX: 100,            // thanh "thức ăn dự trữ" 0..100
    DASH_DRAIN: 18,             // tiêu hao/giây khi chạy nhanh (cho mèo 10kg; mèo nặng hơn hao chậm hơn)
    DRAIN_KG_EXP: .25,          // drain *= (10/kg)^0.25
    DASH_MIN_START: 12,         // cạn kiệt thì phải hồi lại >= 12 mới chạy nhanh tiếp
    ENERGY_REGEN: 2.5,          // hồi/giây khi KHÔNG chạy nhanh
    ENERGY_PER_V: 2,            // mỗi 1 giá trị thức ăn hồi 2 năng lượng (đủ để kéo dài, không đủ để chạy nhanh vô hạn)
    DASH_BURN_FRAC: .012, DASH_BURN_MIN: .12, // chạy nhanh đốt cân: max(0.12, 1.2%*kg) kg/giây
    // ----- bù độ trễ mạng (server) -----
    LAG_MAX_MS: 300, INTERP_MS: 70
  };
  const TAU = Math.PI * 2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rad = kg => 12 + 3.2 * Math.sqrt(kg);
  const speedOf = (kg, dash) => CFG.BASE_SPEED * Math.pow(rad(kg) / 14, -CFG.SPEED_EXP) * (dash ? CFG.DASH_MULT : 1);
  const newBody = (e, kg) => { e.kg = kg; e.en = CFG.ENERGY_MAX; e.tired = false; e.dashing = false; return e };
  // Chuyển động + chạy nhanh + hao cân + hồi năng lượng cho MỌI thực thể.
  function stepBody(e, dt, ta, wantDash) {
    let da = ta - e.ang; da = Math.atan2(Math.sin(da), Math.cos(da)); e.ang += clamp(da, -6 * dt, 6 * dt);
    const can = wantDash && !e.tired && e.en > 0 && e.kg > CFG.MIN_KG + .5;
    if (can) {
      e.en -= CFG.DASH_DRAIN * Math.pow(CFG.SPAWN_KG / Math.max(e.kg, CFG.SPAWN_KG), CFG.DRAIN_KG_EXP) * dt;
      if (e.en <= 0) { e.en = 0; e.tired = true }
      e.kg = Math.max(CFG.MIN_KG, e.kg - Math.max(CFG.DASH_BURN_MIN, CFG.DASH_BURN_FRAC * e.kg) * dt); e.dashing = true;
    } else { e.dashing = false; restEnergy(e, dt) }
    const sp = speedOf(e.kg, e.dashing);
    e.vx = Math.cos(e.ang) * sp; e.vy = Math.sin(e.ang) * sp; e.x += e.vx * dt; e.y += e.vy * dt;
    const r = rad(e.kg); e.x = clamp(e.x, r, CFG.W - r); e.y = clamp(e.y, r, CFG.W - r);
    if (e.ph !== undefined) e.ph += dt * sp / 22;
    if (e.kg > CFG.DECAY_ABOVE) e.kg -= e.kg * CFG.DECAY_PER_SEC * dt;
  }
  function restEnergy(e, dt) { e.en = Math.min(CFG.ENERGY_MAX, e.en + CFG.ENERGY_REGEN * dt); if (e.tired && e.en >= CFG.DASH_MIN_START) e.tired = false }
  // Ăn thức ăn giá trị v: tăng cân (có trần) + hồi năng lượng. Trả về số kg tăng thực tế.
  function feed(e, v) {
    const old = e.kg; e.kg = Math.min(CFG.MAX_KG, e.kg + v * CFG.FOOD_GAIN_K / (1 + e.kg / CFG.FOOD_GAIN_SOFT));
    e.en = Math.min(CFG.ENERGY_MAX, e.en + v * CFG.ENERGY_PER_V); if (e.tired && e.en >= CFG.DASH_MIN_START) e.tired = false; return e.kg - old;
  }
  const canSwallow = (a, b) => a.kg >= b.kg * (a.dashing ? CFG.DASH_SWALLOW_RATIO : CFG.SWALLOW_WEIGHT_RATIO);
  const reachOf = (a, bKg) => rad(a.kg) * (CFG.REACH_BODY + (a.dashing ? CFG.LUNGE_REACH : 0)) + rad(bKg) * CFG.REACH_PREY;
  // Tìm các vụ nuốt hợp lệ trong 1 tick. posOf(a,b) cho phép server "tua lại" vị trí mục tiêu (bù trễ); mặc định vị trí hiện tại.
  // Mỗi mồi chỉ có tối đa 1 kẻ săn (kẻ ăn sâu nhất, hoà thì nặng hơn) => không thể 2 kẻ cùng nuốt 1 mục tiêu.
  function findSwallows(list, posOf) {
    const best = new Map();
    for (const a of list) {
      if (!a.alive) continue;
      for (const b of list) {
        if (a === b || !b.alive || !canSwallow(a, b)) continue;
        const p = posOf ? posOf(a, b) : b, rc = reachOf(a, b.kg), d = Math.hypot(a.x - p.x, a.y - p.y);
        if (d > rc) continue;
        const depth = d / rc, cur = best.get(b);
        if (!cur || depth < cur.depth || (depth === cur.depth && a.kg > cur.a.kg)) best.set(b, { a, b, depth });
      }
    }
    return [...best.values()].sort((x, y) => y.a.kg - x.a.kg || x.depth - y.depth).map(x => [x.a, x.b]);
  }
  // Thực hiện vụ nuốt (mutate). Trả về {gain, preyKg}. Người gọi lo hiệu ứng/thức ăn rơi.
  function applySwallow(a, b) { const preyKg = b.kg; b.alive = false; const gain = feed(a, preyKg * CFG.SWALLOW_GAIN); a.kills = (a.kills || 0) + 1; return { gain, preyKg } }
  const dropPlan = kg => { const n = Math.min(45, Math.max(4, kg / 2.2 | 0)); return { n, v: kg * CFG.SWALLOW_DROP / n + .4 } };
  // AI bot (dùng chung server + offline). lists = [danh sách thức ăn, thức ăn rơi, pate]; mục nào có a===false thì bỏ qua.
  // Bot dùng CÙNG ngưỡng nuốt với luật chiến đấu; chỉ chạy nhanh khi còn năng lượng (cùng luật với người chơi).
  function think(b, dt, list, lists) {
    const a = b.ai; a.t -= dt; if (a.t > 0) return; a.t = .25 + Math.random() * .25;
    const r = rad(b.kg), W = CFG.W; let thr = null, prey = null, td = 520, pd = 420;
    for (const o of list) {
      if (o === b) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y);
      if (o.kg >= b.kg * CFG.SWALLOW_WEIGHT_RATIO * .85 && d < td) { thr = o; td = d } else if (canSwallow({ kg: b.kg, dashing: false }, o) && d < pd) { prey = o; pd = d }
    }
    a.dsh = false;
    if (thr) { a.flee = true; a.tx = b.x - (thr.x - b.x); a.ty = b.y - (thr.y - b.y); a.dsh = td < r * 3.5 && !b.tired && b.en > 25; return }
    a.flee = false;
    if (prey) { a.tx = prey.x + (prey.vx || 0) * .3; a.ty = prey.y + (prey.vy || 0) * .3; a.dsh = pd < r * 4 && !b.tired && b.en > 40; return }
    let bd = 700, bf = null;
    for (const L of lists) for (const f of L) { if (f.a === false) continue; const d = Math.abs(f.x - b.x) + Math.abs(f.y - b.y); if (d < bd) { bd = d; bf = f } }
    if (bf) { a.tx = bf.x; a.ty = bf.y } else if (Math.hypot(a.tx - b.x, a.ty - b.y) < 80 || !a.tx) { a.tx = 200 + Math.random() * (W - 400); a.ty = 200 + Math.random() * (W - 400) }
  }
  return { CFG, think, TAU, clamp, rad, speedOf, newBody, stepBody, restEnergy, feed, canSwallow, reachOf, findSwallows, applySwallow, dropPlan };
});
