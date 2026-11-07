# 🐱 KHÁNH MIU — v2.0 (Combat & Survival)

Game mèo ăn hạt, lớn dần và nuốt mèo nhỏ hơn. Multiplayer thật: server Node.js + WebSocket giữ một thế giới chung cho cả phòng. Xem `CHANGELOG.md` để biết v2 đổi gì.

## Cấu trúc

```
index.html           Frontend 1 file (chạy được trên GitHub Pages). Gửi input, nhận trạng thái, vẽ.
shared/rules.js      LUẬT CHƠI DÙNG CHUNG: cân nặng, nuốt, chạy nhanh, AI bot. Server require; index.html chứa bản sao.
server/game.js       Thế giới phía server: người chơi, bot, thức ăn, PATE, bù trễ, lịch sử vị trí.
server/server.js     HTTP + WebSocket (ws), phòng, kết nối lại, đo RTT, chống flood.
tools/sync-rules.js  Chép shared/rules.js vào index.html (bắt buộc chạy sau khi sửa luật).
test/                Bộ test (xem cuối file).
render.yaml          Cấu hình Render (không đổi so với v1).
```

## Nguyên nhân lỗi combat (v1) — đã đo, không đoán

Với code v1, một người chơi 60kg "hoàn hảo" (thấy hết bản đồ, không lag, luôn đuổi mồi gần nhất) chạm **0 con bot** trong 50 phút mô phỏng, trong khi bot giết người chơi 5 lần và giết bot khác 7 lần. Qua trình duyệt thật + proxy làm trễ (RTT 0 / 120 / 300ms) cũng 0 kill ở cả ba mức. Nên nguyên nhân chính là **luật chơi và AI**, không phải mạng:

1. Mèo nhỏ chạy nhanh hơn mèo to (`speed ∝ rad^-0.22`).
2. Bot chạy trốn bằng dash không bị giới hạn bởi thức ăn.
3. Tầm nuốt rất sát (tâm mồi phải nằm gần như trong miệng).

Hai yếu tố góp thêm khi chơi qua mạng (suy ra từ code, chưa đo riêng): client lệch tới 90px so với server, và server không bù độ trễ. Còn tàn dư `fight()` của multiplayer cũ (`b.peer`, `emitK`) trong client đã được dọn.

## Cơ chế nuốt (một hệ thống cho mọi đối tượng)

`shared/rules.js → findSwallows / applySwallow`. Không có nhánh riêng cho người hay bot.

- **Điều kiện:** kẻ săn nặng ≥ **1.6×** mồi (**1.4×** khi đang lao/dash). Hai mèo gần bằng nhau không nuốt được nhau; mèo nhỏ không bao giờ nuốt được mèo lớn (đã quét 5–250kg, không có cặp nào nuốt nhau được cả hai chiều).
- **Tầm với:** `rad_săn × (0.85 + 0.6 nếu đang lao) + rad_mồi × 0.15`.
- **Chỉ một kẻ săn mỗi mồi:** khi nhiều kẻ cùng chạm, kẻ ăn sâu nhất thắng (hoà thì nặng hơn). Xử lý theo thứ tự cân nặng giảm dần nên mồi đã bị nuốt không đi nuốt tiếp.
- **Phần thưởng:** `ăn(mồi_kg × 0.25)` (qua công thức ăn bên dưới) và mồi để lại thức ăn tổng trị giá 55% cân nặng (tối đa 45 hạt). Người chơi chết vẫn rơi thức ăn **hai lần** như v1 (`DOUBLE_DROP_HUMAN` trong `server/game.js`, đặt `false` nếu muốn bỏ).
- **Server là nguồn sự thật:** client chỉ gửi `{góc, dash, đang tạm dừng}`. Cân nặng, năng lượng, nuốt đều do server tính; thông điệp lạ (`kill`, `swallow`, `set kg`, NaN, JSON hỏng, khung quá lớn) bị bỏ qua hoặc ngắt kết nối. Client ép `dash=1` khi đã hết dự trữ vẫn chỉ đi tốc độ thường.
- **Bù trễ (chỉ người chơi thật):** khi kiểm tra kẻ săn là người, server nhìn vị trí mồi tại thời điểm `RTT + 70ms` trước (tối đa 300ms) từ lịch sử 1 giây. RTT do **server đo bằng ping/pong** nên client không khai man được. Bot không bù.
- **Client đối chiếu vị trí** bằng dấu thời gian của input (`c`) và tuổi input server trả về, nên không còn lệch do độ trễ; chỉ sửa khi sai lệch > 12px, giật về khi > 250px.

## Công thức

| Thứ | Công thức |
|---|---|
| Bán kính (kích thước) | `rad = 12 + 3.2·√kg` (px) |
| Xuất hiện / sàn / trần | 10kg / 6kg / 250kg |
| Tốc độ | `215 · (rad/14)^-0.10` px/s; dash × 1.75 |
| Tăng khi ăn giá trị `v` | `Δkg = v·1.5 / (1 + kg/110)` (càng nặng càng chậm); hạt thường v=1, đặc biệt 3, PATE 8 |
| Hao tự nhiên | trên 30kg: −0.15%/giây |
| Dự trữ (thanh HUD) | 0–100 |
| Dash tiêu hao dự trữ | `18 · (10/kg)^0.25` mỗi giây (10kg: ~5.6s; 120kg: ~10.2s) |
| Dash đốt cân | `max(0.12, 1.2%·kg)` kg/giây, không xuống dưới 6kg |
| Hết dự trữ | không dash được cho tới khi hồi ≥ 12 |
| Hồi dự trữ | +2.5/giây khi không dash; ăn +2 mỗi giá trị `v` |

Phân biệt: **dự trữ** là tài nguyên tiêu hao; **cân nặng** là kích thước và sức mạnh. Mọi hằng số nằm trong `CFG` đầu `shared/rules.js`. **Sau khi sửa phải chạy `npm run sync-rules`** (test sẽ báo nếu `index.html` lệch).

### Cân bằng và tần suất nuốt

Mô phỏng 3 × 60 lượt × 3 phút, người săn hoàn hảo 60kg: 33 / 48 / 34 lần nuốt bot trên 180 phút mô phỏng (≈ 1 con mỗi 4–5 phút; v1: 0). Người chơi thật chậm hơn người săn hoàn hảo, nên đây là mức *có thể nhưng không dễ*. Muốn dễ hơn: giảm `SWALLOW_WEIGHT_RATIO`, tăng `LUNGE_REACH`, giảm `SPEED_EXP`. Kiểm tra bằng `node test/sim.js 3 60 '{"LUNGE_REACH":0.8}'`.

## Hiển thị & hiệu ứng

HUD: cân nặng, số lần nuốt, hạng, thanh dự trữ (đỏ nhấp nháy khi kiệt sức). Nhãn tên + kg trên đầu mọi mèo (cỡ chữ cố định ~14px trên màn hình, tự thu gọn khi đông/nhỏ; xanh = nuốt được, đỏ = có thể nuốt bạn). Kích thước đổi mượt theo cân nặng. Nuốt: mồi bị hút nhỏ dần vào miệng, kẻ nuốt phình ra, chữ `+x kg`, SFX `kill`/`gulp`. Game Over: cân nặng cao nhất, kỷ lục kg (lưu `localStorage`), số lần nuốt, hạng.

## Giao thức v2 và tương thích

Client gửi `join` kèm `v:2`; snapshot gửi `[id,x,y,kg,góc,dash,kills]` + danh sách ack riêng từng người `[id, ct, tuổi, dự trữ, kiệt sức]`. Frontend cũ + backend mới → báo "Phiên bản game đã cũ, tải lại trang". Frontend mới + backend cũ → báo "Server đang chạy phiên bản cũ, hãy deploy lại". Đã test cả hai chiều.

## Cập nhật lên Render / GitHub Pages

1. Giải nén bản v2 đè lên repo (giữ `.git`). **Phải đẩy cả `shared/` và `server/`** vì server `require('../shared/rules.js')`. `render.yaml`, `package.json` (dependencies) không đổi.
2. `git add -A && git commit -m "KHÁNH MIU v2" && git push`. Render tự build và deploy (nếu đã bật auto-deploy); nếu không, vào dịch vụ → **Manual Deploy → Deploy latest commit**. Không cần đổi biến môi trường.
3. Nếu bạn dùng frontend ở GitHub Pages: `index.html` mới đã nằm trong commit; đợi Pages cập nhật (~1 phút) rồi **Ctrl+F5**. Nhớ giữ nguyên dòng `const CFG={server:'wss://…'}` nếu bạn đã điền địa chỉ Render vào `index.html` (v2 sẽ ghi đè file này bằng bản mới, hãy điền lại nếu cần).
4. Kiểm tra: mở `https://<tên>.onrender.com/health` phải trả `{"ok":true,...}`; mở game ở hai thiết bị cùng mã phòng.
5. Quay lại v1 nếu cần: giải nén `backups/khanh-miu-v1-truoc-nang-cap.zip` rồi push lại (checksum trong `backups/v1-sha256.txt`).

## Kiểm thử

```bash
npm install
npm test                     # luật + giao thức + chiến đấu/chống gian lận + soak 20s (không cần trình duyệt)
npm i --no-save playwright && npx playwright install chromium
npm run test:browser         # 2 trình duyệt multiplayer + combat + offline/khác origin
node test/offline-combat-and-compat.js   # offline dùng luật mới + tương thích phiên bản (cần backup v1 giải nén ở /tmp/v1)
node test/latency-chase.js 60 90          # trình duyệt thật + proxy trễ 60ms mỗi chiều, đuổi bot 90s
node test/sim.js 3 60                     # mô phỏng cân bằng nhanh
```

Giới hạn của bộ test: chỉ sắp đặt tiền điều kiện (vị trí/cân nặng) qua API phòng; mọi quyết định nuốt/cộng cân/rơi thức ăn do server tự xử lý. Chưa test được trên Render thật và trên hai thiết bị ở hai mạng khác nhau.

## Giữ nguyên từ v1

Phòng/mã phòng/link mời (≤12 người), kết nối lại (giữ mèo 10s), PATE, Settings trong game (offline tạm dừng hẳn; online chỉ mèo của bạn đứng yên, vẫn có thể bị tấn công), 10 giống mèo + tuỳ chỉnh màu, menu, âm thanh, minimap, bot AI. Biến môi trường tuỳ chọn: `PORT`, `ALLOWED_ORIGINS`, `MAX_CONN_PER_IP`.
