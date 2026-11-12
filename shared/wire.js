/* KHÁNH MIU — GIAO THỨC NHỊ PHÂN CHO SNAPSHOT (server + client + test dùng chung).
 * Snapshot (gửi 20 lần/giây, chiếm gần hết băng thông) được nén từ ~780 byte JSON xuống ~190 byte. Sự kiện/meta/welcome vẫn là JSON văn bản.
 * Khung: u8 type=1 | u16 tick | u8 số dòng | dòng*10 | u8 hasAck | [ack 10 byte]
 * Dòng (10 byte): u16 id | u16 x | u16 y | u16 kg*10 | u8 góc(0..255 = 0..2π) | u8 cờ (bit0 = đang dash)
 * Ack riêng từng người (10 byte): u32 mốc thời gian input của client | u16 tuổi input (ms) | u8 dự trữ | u8 cờ (bit0 = kiệt sức) | u16 số lần nuốt
 * Cuối khung: u16 độ dài | JSON mảng sự kiện (UTF-8, dùng chung cho cả phòng) => mỗi client chỉ nhận 1 gói/tick (ít lời gọi hệ thống hơn hẳn)
 * Sau khi sửa file này chạy:  node tools/sync-rules.js */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.KMWire = factory() })(this, function () {
  'use strict';
  const PROTO = 3, ROW = 10, TAU = Math.PI * 2, HEAD = 4;
  const u16 = v => v < 0 ? 0 : v > 65535 ? 65535 : Math.round(v);
  function packRow(v, o, id, x, y, kg, ang, dash) {
    v.setUint16(o, id & 65535, true); v.setUint16(o + 2, u16(x), true); v.setUint16(o + 4, u16(y), true); v.setUint16(o + 6, u16(kg * 10), true);
    v.setUint8(o + 8, Math.round((((ang % TAU) + TAU) % TAU) / TAU * 256) & 255); v.setUint8(o + 9, dash ? 1 : 0);
  }
  // block: Uint8Array chứa các dòng đã đóng gói sẵn (1 lần/tick, dùng chung cho mọi client); idx: danh sách dòng gửi cho client này.
  function buildFrame(n, block, idx, ack, ev) {
    const evLen = ev ? ev.length : 0, buf = new ArrayBuffer(HEAD + idx.length * ROW + 1 + (ack ? 10 : 0) + 2 + evLen), v = new DataView(buf), u = new Uint8Array(buf);
    v.setUint8(0, 1); v.setUint16(1, n & 65535, true); v.setUint8(3, idx.length); let o = HEAD;
    for (let i = 0; i < idx.length; i++) { const b = idx[i] * ROW; for (let j = 0; j < ROW; j++) u[o + j] = block[b + j]; o += ROW } // vòng thủ công: tránh tạo subarray cho từng dòng/từng client
    if (ack) { v.setUint8(o++, 1); v.setUint32(o, ack.ct >>> 0, true); v.setUint16(o + 4, Math.min(65535, ack.age | 0), true); v.setUint8(o + 6, ack.en & 255); v.setUint8(o + 7, ack.tired ? 1 : 0); v.setUint16(o + 8, Math.min(65535, ack.kills | 0), true); o += 10 } else v.setUint8(o++, 0);
    v.setUint16(o, evLen, true); if (evLen) u.set(ev, o + 2);
    return buf;
  }
  function decodeSnap(buf) {
    const v = new DataView(buf); if (v.byteLength < 5 || v.getUint8(0) !== 1) return null;
    const n = v.getUint16(1, true), c = v.getUint8(3), rows = []; let o = HEAD;
    if (v.byteLength < HEAD + c * ROW + 1) return null;
    for (let i = 0; i < c; i++, o += ROW) rows.push([v.getUint16(o, true), v.getUint16(o + 2, true), v.getUint16(o + 4, true), v.getUint16(o + 6, true) / 10, v.getUint8(o + 8) * TAU / 256, v.getUint8(o + 9) & 1]);
    let ack = null; const has = v.getUint8(o) === 1; o += 1;
    if (has) { if (v.byteLength < o + 12) return null; ack = { ct: v.getUint32(o, true), age: v.getUint16(o + 4, true), en: v.getUint8(o + 6), tired: v.getUint8(o + 7) & 1, kills: v.getUint16(o + 8, true) }; o += 10 }
    let ev = null; if (v.byteLength >= o + 2) { const len = v.getUint16(o, true); if (len && v.byteLength >= o + 2 + len) { try { ev = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o + 2, len))) } catch (e) { ev = null } } }
    return { n, rows, ack, ev };
  }
  return { PROTO, ROW, packRow, buildFrame, decodeSnap };
});
