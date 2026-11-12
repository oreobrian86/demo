'use strict';
// Benchmark tải: node test/perf-bench.js <thư mục project> <proto> <nhãn> [giây] [số người] [số phòng]
// Chạy server như tiến trình riêng (giống Render) + client WebSocket điều khiển ngẫu nhiên như người chơi thật.
const { spawn } = require('child_process'), fs = require('fs'), path = require('path'), WebSocket = require('ws');
const [dir, proto, label, secs = 40, perRoom = 12, nRooms = 1] = process.argv.slice(2); const SECS = +secs, sleep = ms => new Promise(r => setTimeout(r, ms));
const hex = () => Array.from({ length: 24 }, () => '0123456789abcdef'[Math.random() * 16 | 0]).join(''); const out = '/tmp/probe_' + label + '.json';
const srv = spawn('node', [...(process.env.NODE_ARGS ? process.env.NODE_ARGS.split(' ') : []), '-r', path.join(__dirname, 'lib/probe.js'), 'server/server.js'], { cwd: dir, env: Object.assign({}, process.env, { PORT: '0', MAX_CONN_PER_IP: '999', PROBE_OUT: out }) });
let err = ''; srv.stderr.on('data', d => err += d);
(async () => {
  const port = await new Promise(res => srv.stdout.on('data', d => { const m = /cổng (\d+)/.exec(String(d)); if (m) res(+m[1]) })); const cl = [];
  for (let r = 0; r < nRooms; r++) for (let i = 0; i < +perRoom; i++) { const w = new WebSocket('ws://127.0.0.1:' + port); const c = { w, rx: 0, n: 0 }; cl.push(c);
    w.on('open', () => w.send(JSON.stringify({ t: 'join', v: +proto, room: 'B' + r, pid: hex(), name: 'P' + i, bi: i % 10, col: '#aa5500', dif: 'normal' })));
    w.on('message', (d, isBin) => { c.rx += d.length; c.n++ }); w.on('error', () => { });
    let a = Math.random() * 6.28, dash = 0; c.iv = setInterval(() => { if (w.readyState !== 1) return; if (Math.random() < .08) a += (Math.random() - .5) * 2; if (Math.random() < .03) dash = dash ? 0 : 1; w.send(JSON.stringify({ t: 'in', a, d: dash, i: 0, c: Date.now() % 1e9 })) }, 50) }
  await sleep(4000); cl.forEach(c => { c.rx = 0; c.n = 0 }); const pid = srv.pid; const rd = () => { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' '); return (+s[13] + +s[14]) / 100 };
  const cpuA = rd(), tA = Date.now(); srv.kill('SIGUSR2'); await sleep(300); await sleep(SECS * 1000); const cpuB = rd(), tB = Date.now(); const rxKB = cl.reduce((a, c) => a + c.rx, 0) / cl.length / ((tB - tA) / 1000) / 1024, mps = cl.reduce((a, c) => a + c.n, 0) / cl.length / ((tB - tA) / 1000);
  srv.kill('SIGUSR2'); await sleep(500); const p = JSON.parse(fs.readFileSync(out, 'utf8')); cl.forEach(c => { clearInterval(c.iv); c.w.terminate() }); srv.kill();
  console.log(JSON.stringify({ label, players: cl.length, rooms: +nRooms, secs: SECS, serverCpuPctOfOneCore_external: +(((cpuB - cpuA) / ((tB - tA) / 1000)) * 100).toFixed(2), kbPerSecPerClient: +rxKB.toFixed(2), msgsPerSecPerClient: +mps.toFixed(1), tickMsAvg: p.tickMsAvg, tickMsP95: p.tickMsP95, tickMsMax: p.tickMsMax, eventLoopLagMsP99: p.eventLoopLagMsP99, eventLoopLagMsMax: p.eventLoopLagMsMax, rssMB: p.rssMB, heapUsedMB: p.heapUsedMB, stderr: err.trim() || '(trống)' })); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); srv.kill(); process.exit(1) });
setTimeout(() => { srv.kill(); process.exit(2) }, 200000).unref();
