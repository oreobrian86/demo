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
    // Tầm nuốt = bán kính thân kẻ săn (+25% khi đang lao) + 30% bán kính mồi: chạm thân là nuốt, mồi bị phủ ~1/3 là đủ. (v2: 0.85/0.15 => phải gần như trùng tâm mới nuốt)
    REACH_BODY: 1.0, REACH_PREY: .3, LUNGE_REACH: .25,
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
    LAG_MAX_MS: 300, INTERP_MS: 100
  };
  const TAU = Math.PI * 2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rad = kg => 12 + 3.2 * Math.sqrt(kg);
  const speedOf = (kg, dash) => CFG.BASE_SPEED * Math.pow(rad(kg) / 14, -CFG.SPEED_EXP) * (dash ? CFG.DASH_MULT : 1);
  const newBody = (e, kg) => { e.kg = kg; e.en = CFG.ENERGY_MAX; e.tired = false; e.dashing = false; return e };
  // Chuyển động + chạy nhanh + hao cân + hồi năng lượng cho MỌI thực thể.
  function stepBody(e, dt, ta, wantDash) {
    e.px = e.x; e.py = e.y; // vị trí đầu bước: dùng cho va chạm quét (swept) để chạy nhanh không xuyên qua mồi
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
  const teleport = (e, x, y) => { e.x = e.px = x; e.y = e.py = y };
  // Khoảng cách NHỎ NHẤT giữa kẻ săn a và mồi t trong suốt 1 tick (cả hai di chuyển thẳng đều từ vị trí đầu tick tới cuối tick).
  // Nhờ vậy chạy nhanh / chênh lệch vận tốc lớn vẫn không "xuyên qua" mồi giữa hai lần kiểm tra.
  function sweptDist(a, t) {
    const rx0 = t.x0 - (a.px === undefined ? a.x : a.px), ry0 = t.y0 - (a.py === undefined ? a.y : a.py), dx = (t.x1 - a.x) - rx0, dy = (t.y1 - a.y) - ry0, dd = dx * dx + dy * dy;
    const s = dd > 1e-9 ? clamp(-(rx0 * dx + ry0 * dy) / dd, 0, 1) : 0; return Math.hypot(rx0 + dx * s, ry0 + dy * s);
  }
  const trackOf = b => ({ x0: b.px === undefined ? b.x : b.px, y0: b.py === undefined ? b.y : b.py, x1: b.x, y1: b.y });
  // Tìm các vụ nuốt hợp lệ trong 1 tick. track(a,b) cho phép server "tua lại" quỹ đạo mục tiêu (bù trễ); mặc định quỹ đạo thật trong tick.
  // Mỗi mồi chỉ có tối đa 1 kẻ săn (kẻ ăn sâu nhất, hoà thì nặng hơn) => không thể 2 kẻ cùng nuốt 1 mục tiêu.
  function findSwallows(list, track) {
    const best = new Map();
    for (const a of list) {
      if (!a.alive) continue;
      for (const b of list) {
        if (a === b || !b.alive || !canSwallow(a, b)) continue;
        const rc = reachOf(a, b.kg);
        if (Math.abs(a.x - b.x) > rc + 600 && Math.abs(a.y - b.y) > rc + 600) continue; // loại nhanh các cặp ở rất xa
        const d = sweptDist(a, (track && track(a, b)) || trackOf(b));
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
  // ===== AI bot: 3 cấp độ khác nhau về HÀNH VI (không chỉ tăng tốc độ/cân nặng). Dùng chung server + offline. =====
  // Công bằng: bot chỉ "thấy" mèo trong bán kính `sight` (nhỏ hơn khung nhìn của người chơi) và dùng đúng luật dash/năng lượng như người chơi.
  const DIFF = {
    easy:   { react: [.6, 1.0],  sight: 420, fleeDist: 230, fleeDash: false, huntBot: .35, huntHuman: .12, lead: 0,  dash: 'never', score: false, retreat: false, foodR: 600 },
    normal: { react: [.25, .5],  sight: 520, fleeDist: 520, fleeDash: true,  huntBot: 1,   huntHuman: 1,   lead: .3, dash: 'near',  score: false, retreat: false, foodR: 700 },
    hard:   { react: [.12, .22], sight: 650, fleeDist: 560, fleeDash: true,  huntBot: 1,   huntHuman: 1,   lead: -1, dash: 'lunge', score: true,  retreat: true,  foodR: 900 }
  };
  const DIF_NAMES = ['easy', 'normal', 'hard'];
  // lists = [danh sách thức ăn, thức ăn rơi, pate]; mục nào có a===false thì bỏ qua. Trạng thái nhớ trong b.ai (mode, commit, ignore, retreat).
  function think(b, dt, list, lists, dif) {
    const D = DIFF[dif] || DIFF.normal, a = b.ai; a.clock = (a.clock || 0) + dt; a.t -= dt; if (a.t > 0) return;
    a.t = D.react[0] + Math.random() * (D.react[1] - D.react[0]);
    const r = rad(b.kg), W = CFG.W, hard = dif === 'hard', mySp = speedOf(b.kg, false), threatKg = b.kg * CFG.SWALLOW_WEIGHT_RATIO * (hard ? .8 : .85);
    // 1) Quan sát trong tầm nhìn
    let nT = null, nd = D.fleeDist, fx = 0, fy = 0; const threats = [], cands = [];
    for (const o of list) {
      if (o === b) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y); if (d > D.sight) continue;
      if (o.kg >= threatKg) { threats.push(o); if (d < D.fleeDist) { const w = (D.fleeDist - d + 50) / Math.max(d, 20); fx += (b.x - o.x) * w; fy += (b.y - o.y) * w; if (d < nd) { nd = d; nT = o } } }
      else if (canSwallow({ kg: b.kg, dashing: false }, o)) cands.push({ o, d });
    }
    // 2) Bỏ chạy
    if (nT) {
      a.mode = 'flee';
      if (hard) { const m = 260; if (b.x < m) fx += (m - b.x) * 2; if (b.x > W - m) fx -= (b.x - (W - m)) * 2; if (b.y < m) fy += (m - b.y) * 2; if (b.y > W - m) fy -= (b.y - (W - m)) * 2 } // tránh bị dồn vào tường
      const L = Math.hypot(fx, fy) || 1; a.tx = b.x + fx / L * 400; a.ty = b.y + fy / L * 400;
      a.dsh = D.fleeDash && nd < r * (hard ? 5 : 3.5) && !b.tired && b.en > (hard ? 20 : 25); return;
    }
    // 3) Săn mồi
    if (a.known === undefined) { a.known = {}; a.ignore = {}; a.n = 0 }
    if (D.retreat && (b.tired || b.en < 18) && a.retreat === undefined) a.retreat = a.clock + 3;  // hard: hết sức thì rút lui, không đuổi tiếp
    const retreating = D.retreat && a.retreat !== undefined && a.retreat > a.clock; if (a.retreat !== undefined && a.retreat <= a.clock) a.retreat = undefined;
    let pick = null;
    if (!retreating && cands.length) {
      const ok = [];
      for (const c of cands) {
        const id = c.o.id; if (a.known[id] === undefined) { if (++a.n > 60) { a.known = {}; a.ignore = {}; a.n = 0 } a.known[id] = 1; if (Math.random() >= (c.o.bot ? D.huntBot : D.huntHuman)) a.ignore[id] = a.clock + 10 } // easy: thường lờ đi, nhất là người chơi
        if ((a.ignore[id] || 0) > a.clock) continue; if ((b.tired || b.en < 25) && c.d > r * 3) continue; ok.push(c);
      }
      if (D.score) {  // hard: chọn mục tiêu theo giá trị, tránh mồi đang ở gần mèo lớn, ưu tiên mồi bị dồn sát tường, giữ mục tiêu một lúc
        let bs = -1, cur = null;
        for (const c of ok) {
          const o = c.o; let danger = false; for (const t of threats) if (Math.hypot(t.x - o.x, t.y - o.y) < 320) { danger = true; break }
          const cornered = o.x < 220 || o.x > W - 220 || o.y < 220 || o.y > W - 220;
          const sc = o.kg * (o.bot ? 1 : 1.15) / (1 + c.d / 300) * (danger ? .15 : 1) * (cornered ? 1.5 : 1) * (mySp > speedOf(o.kg, false) * .97 ? 1.2 : 1);
          if (o.id === a.commit) cur = { c, sc }; if (sc > bs) { bs = sc; pick = c }
        }
        if (cur && a.clock < a.commitUntil && cur.sc * 1.6 >= bs) pick = cur.c;
        if (pick && pick.o.id !== a.commit) { a.commit = pick.o.id; a.commitUntil = a.clock + 3 }
      } else { let bd = 1e9; for (const c of ok) if (c.d < bd) { bd = c.d; pick = c } }
    }
    if (pick) {
      const o = pick.o, d = pick.d; a.mode = 'hunt';
      const lead = D.lead >= 0 ? D.lead : Math.min(.8, d / Math.max(120, mySp * 1.75 - speedOf(o.kg, false) * .5)); // hard: ước lượng điểm chặn đầu
      a.tx = o.x + (o.vx || 0) * lead; a.ty = o.y + (o.vy || 0) * lead;
      a.dsh = D.dash === 'never' ? false : D.dash === 'near' ? (d < r * 4 && !b.tired && b.en > 40) : (d < r * 4.4 && !b.tired && b.en > 35); // hard: áp sát bằng tốc độ thường, chỉ lao khi đủ gần
      return;
    }
    // 4) Tìm thức ăn / lang thang
    a.mode = 'food'; a.dsh = false; let bd = D.foodR, bf = null;
    for (const L of lists) for (const f of L) { if (f.a === false) continue; const d = Math.abs(f.x - b.x) + Math.abs(f.y - b.y); if (d < bd) { bd = d; bf = f } }
    if (bf) { a.tx = bf.x; a.ty = bf.y } else if (Math.hypot(a.tx - b.x, a.ty - b.y) < 80 || !a.tx) { a.tx = 200 + Math.random() * (W - 400); a.ty = 200 + Math.random() * (W - 400) }
  }
  // Hướng đi của bot: tới mục tiêu, trừ khi đang kiếm ăn/lang thang sát tường (khi đó quay về giữa bản đồ). Đang săn thì KHÔNG bị kéo đi => dồn được mồi vào tường.
  function botHeading(b, dif) {
    const a = b.ai, r = rad(b.kg), W = CFG.W; let ta = Math.atan2(a.ty - b.y, a.tx - b.x);
    const nearWall = b.x < r + 120 || b.x > W - r - 120 || b.y < r + 120 || b.y > W - r - 120;
    if (nearWall && a.mode !== 'hunt' && !(a.mode === 'flee' && dif === 'hard')) ta = Math.atan2(W / 2 - b.y, W / 2 - b.x);
    return ta;
  }
  return { CFG, DIFF, DIF_NAMES, think, botHeading, teleport, sweptDist, TAU, clamp, rad, speedOf, newBody, stepBody, restEnergy, feed, canSwallow, reachOf, findSwallows, applySwallow, dropPlan };
});
