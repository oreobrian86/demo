'use strict';
// Nạp cùng --expose-gc: khi nhận SIGUSR1 thì ép GC đầy đủ rồi ghi heap còn lại (rò rỉ thật = heap sau GC tăng dần).
const fs = require('fs'); process.on('SIGUSR1', () => { global.gc(); global.gc(); const m = process.memoryUsage(); fs.writeFileSync(process.env.GC_OUT || '/tmp/gc.json', JSON.stringify({ heapUsedMB: +(m.heapUsed / 1048576).toFixed(2), externalMB: +(m.external / 1048576).toFixed(2), arrayBuffersMB: +(m.arrayBuffers / 1048576).toFixed(2), rssMB: +(m.rss / 1048576).toFixed(1) })) });
