# Changelog

## 2.0.0 — Combat & Survival

**Sửa lỗi nghiêm trọng:** người chơi không thể nuốt bot / người chơi khác (xem README, mục "Nguyên nhân lỗi combat").

### Thay đổi
- **Một hệ thống chiến đấu duy nhất** (`shared/rules.js`) cho người-người, người-bot, bot-người, bot-bot, cả online lẫn offline. Server là nơi duy nhất quyết định kết quả nuốt.
- **Cân nặng (kg) thay cho điểm**: bỏ hẳn trường điểm (`sc`) khỏi dữ liệu/giao thức; xếp hạng, HUD, bảng xếp hạng, Game Over đều theo kg. Kích thước = hàm của kg, có sàn 6kg, trần 250kg.
- **Chạy nhanh tiêu hao "thức ăn dự trữ"** (thanh trên HUD), hết thì không thể chạy nhanh; chạy nhanh đốt cân nặng; ăn thức ăn hồi dự trữ.
- **Bù trễ mạng cho người chơi** (RTT do server đo) + **đối chiếu vị trí theo dấu thời gian** thay cho vùng chết 90px cũ ở client.
- **Hiệu ứng**: nuốt (mồi bị hút nhỏ dần vào miệng, kẻ nuốt "ợ" phình ra, chữ +kg bay lên), kg hiển thị mượt, nhãn tên + kg trên đầu mỗi mèo (xanh = nuốt được, đỏ = nguy hiểm), thanh dự trữ nhấp nháy đỏ khi kiệt sức.
- Bot AI dùng chung ngưỡng nuốt & luật năng lượng với người chơi.
- Giao thức **v2**: client/server cũ và mới không trộn lẫn được, nhưng sẽ báo lỗi rõ ràng thay vì chạy hỏng.
- Âm thanh mới: `gulp` (nuốt, nghe từ xa), `nope` (cố chạy khi kiệt sức).

### Không đổi
Kiến trúc Node.js + `ws`, cấu hình Render (`render.yaml`, `package.json` dependencies, biến môi trường), phòng/mã phòng/link mời, kết nối lại, Settings, PATE, 10 giống mèo, menu, bản đồ, thức ăn, minimap.

### File
Mới: `shared/rules.js`, `tools/sync-rules.js`, `test/{rules-test,combat-test,e2e-combat,offline-combat-and-compat,soak,sim,latency-chase}.js`, `test/lib/delayproxy.js`, `CHANGELOG.md`.
Sửa: `index.html`, `server/game.js`, `server/server.js`, `package.json` (chỉ version + scripts), `README.md`, test cũ.
