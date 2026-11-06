# 🐱 KHÁNH MIU

Game mèo ăn hạt, lớn dần và săn mèo nhỏ hơn (trước đây là CAT ARENA). Bản này có **multiplayer thật**: mọi người cùng vào một phòng sẽ ở chung một thế giới do server quản lý.

## Vì sao bản cũ mỗi người một thế giới?

Bản cũ gọi `window.claude.use('room')`, một API chỉ tồn tại bên trong môi trường artifact của Claude. Trên GitHub Pages API này **không tồn tại**, nên `initNet()` tự rơi về chế độ "Chơi offline": mỗi trình duyệt chạy một bản game riêng với bot, thức ăn và bảng điểm riêng. GitHub Pages chỉ phục vụ file tĩnh nên cũng không thể làm server realtime. Vì vậy phải có **backend riêng**.

## Kiến trúc

```
index.html          Frontend (1 file, giữ nguyên engine/đồ hoạ cũ). Gửi input, nhận trạng thái.
server/game.js      Mô phỏng thế giới: di chuyển, ăn, va chạm, kill, bot AI, thức ăn, PATE.
server/server.js    HTTP + WebSocket (thư viện ws), phòng, kết nối lại, chống flood.
test/               Test giao thức, test 2 trình duyệt, test offline/cross-origin.
```

- **Server-authoritative**: client chỉ gửi `{góc, dash}`; server tính vị trí, ăn, kill, điểm, thức ăn rơi, pate. Client chỉ *dự đoán* chuyển động của chính mình cho mượt và được server sửa lại khi lệch.
- Server chạy 20 tick/giây, gửi snapshot + sự kiện (ăn hạt, rơi thức ăn, pate, kill) cho cả phòng.
- Bot do server quản lý, nên mọi người thấy cùng các bot.
- Người mới vào nhận **toàn bộ trạng thái hiện tại** (hạt đã bị ăn, thức ăn rơi, pate, mèo đang có).
- Mất kết nối: mèo được giữ **10 giây** để kết nối lại (tự động, cùng mèo cũ); quá hạn thì biến mất. Thoát chủ động thì biến mất ngay.
- Mỗi phòng tối đa **12 người** (+7 bot). Phòng trống 60 giây sẽ bị xoá.

## Chạy thử trên máy

```bash
npm install
npm start          # http://localhost:3000
```
Mở `http://localhost:3000` trên 2 trình duyệt/thiết bị cùng mạng (thay `localhost` bằng IP máy) → START → cùng vào phòng.

## Deploy (miễn phí) — khuyến nghị: Render, một nơi cho cả game + server

Server Node cũng phục vụ luôn `index.html`, nên chỉ cần deploy **một** service:

1. Đưa toàn bộ thư mục này lên GitHub (thay file `CAT_ARENA.html` cũ).
2. Vào https://render.com → **New → Blueprint** (hoặc *Web Service*) → chọn repo. File `render.yaml` đã cấu hình sẵn (Node, plan free, build `npm install`, start `npm start`, health check `/health`).
3. Đợi deploy xong, bạn có URL dạng `https://khanh-miu.onrender.com`. **Gửi URL này cho bạn bè là chơi được ngay.**

Lưu ý gói free của Render (theo tài liệu hiện hành): service ngủ sau 15 phút không có traffic (tin nhắn WebSocket từ người đang chơi cũng được tính là traffic), lần đầu thức dậy mất khoảng 1 phút, và Render có thể restart bất cứ lúc nào. Game hiển thị "Server đang thức dậy…" và tự chờ. Nếu cần luôn sẵn sàng thì nâng gói trả phí.

### Nếu vẫn muốn giữ frontend trên GitHub Pages

GitHub Pages chỉ là frontend. Sau khi backend chạy trên Render, mở `index.html`, tìm dòng:

```js
const CFG={server:''}
```
rồi điền `wss://khanh-miu.onrender.com` (URL Render của bạn, đổi `https` → `wss`), commit và push; Pages tự cập nhật sau ~1 phút. Có thể thử không cần sửa file bằng `https://<user>.github.io/<repo>/?server=wss://khanh-miu.onrender.com`.

## Cách bạn bè chơi cùng nhau

- **START GAME**: vào phòng chung `PUBLIC` (hoặc phòng trong link nếu bạn mở bằng link có `?room=`).
- **TẠO PHÒNG**: tạo mã 5 ký tự ngẫu nhiên và vào luôn. Trong lúc chơi, bấm ⚙ → **LINK MỜI BẠN** để copy/chia sẻ link `…/?room=MÃ`.
- **VÀO PHÒNG**: nhập mã phòng bạn bè gửi.
- **CHƠI OFFLINE**: chơi một mình với bot như trước (không cần server).

## Tính năng mới

- **KHÁNH MIU**: đổi tên toàn bộ (tiêu đề, logo mèo, menu, Game Over, metadata, favicon).
- **⚙ Settings trong gameplay** (nút bánh răng trên HUD hoặc phím `Esc`): bật/tắt Music/SFX, thanh âm lượng riêng cho nhạc và hiệu ứng, Resume, Return to Main Menu. Âm thanh lưu vào `localStorage`. Offline: game tạm dừng hoàn toàn. Online: **thế giới không dừng**, chỉ mèo của bạn đứng yên (vẫn có thể bị tấn công, đây là lựa chọn có chủ ý để không thể lạm dụng Settings làm "khiên").
- **🥫 PATE**: thức ăn hiếm (tối đa 3 cái cùng lúc, ~1 cái/17 giây, tự biến mất sau 75 giây), lon màu hồng–vàng có hình cá, phát sáng nhấp nháy, nhãn "PATE" khi lại gần, hiện trên minimap. Giá trị = **8** (hạt thường = 1, hạt đặc biệt = 3), SFX riêng + hiệu ứng vòng sáng. Chỉnh trong `server/game.js` (`PATE_V`, `PATE_MAX`, `PATE_EVERY`, `PATE_P`, `PATE_LIFE`) và `PATE_V` trong `index.html` cho chế độ offline.

## Biến môi trường (tuỳ chọn)

| Biến | Ý nghĩa |
|---|---|
| `PORT` | Cổng (Render tự đặt) |
| `ALLOWED_ORIGINS` | Danh sách origin được phép kết nối WebSocket, ví dụ `https://user.github.io`. Để trống = cho phép tất cả |
| `MAX_CONN_PER_IP` | Số kết nối tối đa mỗi IP (mặc định 10) |

## Kiểm thử

```bash
npm install
npm test                          # giao thức: nhiều client WebSocket độc lập
npm i --no-save playwright && npx playwright install chromium
node test/e2e.js                  # 2 trình duyệt Chromium thật chơi cùng phòng
node test/offline-and-cross-origin.js
```
