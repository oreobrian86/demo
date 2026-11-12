# Changelog

## 3.0.0 — Tối ưu, độ khó, nuốt chính xác, cá

### Hiệu năng / mạng
- Snapshot nhị phân (`shared/wire.js`), sự kiện nhúng trong khung, gói riêng từng client (ack riêng, vùng quan tâm 1.500px, mèo xa 5Hz): băng thông mỗi client 10,6 → 1,23 KB/s (−88%) ở phòng 12 người.
- Chống nghẽn client yếu: bỏ snapshot, giữ sự kiện, gửi bù / resync, ngắt khi tồn đọng > 512KB (v2 chỉ ngắt ở 1MB).
- Vòng lặp tick tự bù trễ; thống kê `/metrics` và log `[stats]` định kỳ; id mèo 16-bit.
- Client: nội suy theo giờ server, sự kiện hẹn giờ, đối chiếu vị trí bằng dấu thời gian, ăn cá dự đoán, input gửi theo thay đổi (nhịp tim 100ms), hiển thị ping.

### Gameplay
- **Sửa lỗi nuốt:** tầm nuốt 0,85/0,15 → 1,0/0,3 (+0,25 khi lao), va chạm quét (swept), bù trễ có giới hạn, xoá lịch sử khi hồi sinh. Tỉ lệ nuốt khi hai thân chạm nhau: 57,6% → 72,8% (đi bộ) / 88,1% (dash).
- **3 độ khó** (Easy/Normal/Hard) khác nhau về hành vi AI; áp dụng theo phòng; phòng chung tách theo độ khó. Tầm nhìn bot giới hạn (không nhìn xuyên).
- **Cá thay hạt**: sprite cá nhiều màu/kiểu/hướng, đuôi vẫy; thức ăn rơi cũng là cá. Cơ chế, giá trị cân nặng, số lượng, tốc độ mọc lại giữ nguyên.
- Hard: hết bỏ chạy thẳng vào tường (cộng lực đẩy khỏi tường).

### Không đổi
Kiến trúc Node.js + `ws`, `render.yaml`, dependencies, biến môi trường bắt buộc (không có), phòng/mã phòng/link mời, kết nối lại, Settings, PATE, kg/năng lượng/dash, 10 giống mèo, menu, âm thanh, minimap, chế độ offline.

### Giao thức
v3 (nhị phân). Client/server khác phiên bản báo lỗi rõ ràng, không chạy hỏng.

### File
Mới: `shared/wire.js`, `test/{ai-test,slow-client-test,e2e-v3,difficulty-sim,swallow-contact-bench,perf-bench,draw-bench}.js`, `test/lib/{wsclient,probe,gcprobe}.js`.
Sửa: `index.html`, `shared/rules.js`, `server/game.js`, `server/server.js`, `tools/sync-rules.js`, `package.json` (version + scripts), `README.md`, các test cũ (giao thức mới).
