'use strict';
// Proxy TCP chèn độ trễ một chiều cố định (giữ nguyên thứ tự byte) giữa trình duyệt và server -> mô phỏng RTT thật.
const net = require('net');
function delayProxy(targetPort, oneWayMs) {
  const srv = net.createServer(c => {
    const u = net.connect(targetPort, '127.0.0.1');
    const fwd = (from, to) => from.on('data', d => setTimeout(() => { if (!to.destroyed) to.write(d) }, oneWayMs));
    fwd(c, u); fwd(u, c);
    c.on('close', () => u.destroy()); u.on('close', () => c.destroy()); c.on('error', () => { }); u.on('error', () => { });
    c.setNoDelay(true); u.setNoDelay(true);
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, close: () => srv.close() })));
}
module.exports = { delayProxy };
