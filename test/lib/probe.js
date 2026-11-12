'use strict';
// Nạp vào tiến trình server bằng `node -r test/lib/probe.js server/server.js` để ĐO mà không sửa code: thời gian tick, độ trễ event loop, byte gửi ra.
const path = require('path'), fs = require('fs'), { monitorEventLoopDelay } = require('perf_hooks');
const root = process.cwd(); let Room; try { Room = require(path.join(root, 'server/game.js')).Room } catch (e) { }
const ws = require(path.join(root, 'node_modules/ws')); const tick = [], H = monitorEventLoopDelay({ resolution: 5 }); H.enable();
let bytes = 0, msgs = 0, bin = 0, txt = 0; const t0 = Date.now(), cpu0 = process.cpuUsage();
if (Room) { const _t = Room.prototype.tick; Room.prototype.tick = function (...a) { const s = process.hrtime.bigint(); const r = _t.apply(this, a); tick.push(Number(process.hrtime.bigint() - s) / 1e6); return r } }
const _s = ws.prototype.send; ws.prototype.send = function (d, ...r) { const n = typeof d === 'string' ? Buffer.byteLength(d) : d.byteLength; bytes += n; msgs++; typeof d === 'string' ? txt += n : bin += n; return _s.call(this, d, ...r) };
const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] };
function dump() { const c = process.cpuUsage(cpu0), wall = (Date.now() - t0) / 1000; const m = process.memoryUsage();
  fs.writeFileSync(process.env.PROBE_OUT || '/tmp/probe.json', JSON.stringify({ wallS: +wall.toFixed(1), cpuPctOfOneCore: +((c.user + c.system) / 1e6 / wall * 100).toFixed(2), ticks: tick.length, tickHz: +(tick.length / wall).toFixed(1),
    tickMsAvg: +(tick.reduce((a, b) => a + b, 0) / Math.max(1, tick.length)).toFixed(3), tickMsP95: +q(tick, .95).toFixed(3), tickMsMax: +Math.max(0, ...tick).toFixed(2),
    eventLoopLagMsMean: +(H.mean / 1e6).toFixed(2), eventLoopLagMsP99: +(H.percentile(99) / 1e6).toFixed(2), eventLoopLagMsMax: +(H.max / 1e6).toFixed(2),
    bytesOut: bytes, msgsOut: msgs, textBytes: txt, binaryBytes: bin, rssMB: +(m.rss / 1048576).toFixed(1), heapUsedMB: +(m.heapUsed / 1048576).toFixed(1) })) }
process.on('SIGUSR2', dump); process.on('exit', dump);
process.on('SIGTERM', () => process.exit(0));
