# 🐱 KHÁNH MIU — v3.0

Game mèo ăn cá, lớn dần và nuốt mèo nhỏ hơn. Multiplayer thật: server Node.js + WebSocket giữ một thế giới chung cho cả phòng. Chi tiết thay đổi: `CHANGELOG.md`.

**v3 gồm:** tối ưu băng thông/độ mượt, sửa lỗi nuốt mèo, 3 độ khó (Easy/Normal/Hard), cá thay hạt thức ăn, giám sát `/metrics`.

## Cấu trúc

```
index.html           Frontend 1 file (chạy được trên GitHub Pages). Gửi input, nhận trạng thái, vẽ.
shared/rules.js      LUẬT CHƠI + AI bot 3 độ khó (server require; index.html chứa bản sao).
shared/wire.js       Giao thức nhị phân cho snapshot (server + client + test dùng chung).
server/game.js       Thế giới phía server: người chơi, bot, cá, PATE, bù trễ, gửi dữ liệu theo từng client.
server/server.js     HTTP + WebSocket (ws), phòng, đo RTT, vòng lặp tick, /health, /metrics.
tools/sync-rules.js  Chép shared/rules.js + shared/wire.js vào index.html (BẮT BUỘC chạy sau khi sửa 2 file đó).
test/                Bộ test + benchmark. render.yaml: cấu hình Render (KHÔNG đổi so với v1/v2).
```

## 1. Lag sau bản update: nguyên nhân (đã xác minh / chưa xác minh)

**Chưa xác minh được trên Render** (tôi không truy cập được dịch vụ của bạn; môi trường làm việc không có mạng ra ngoài). Dưới đây là những gì **đã đo được tại máy phát triển** và những khuyết điểm **có thật trong code v2**:

| # | Khuyết điểm trong v2 | Bằng chứng |
|---|---|---|
| 1 | Snapshot là JSON, gửi 20 lần/giây cho **mọi** người, kèm ack của **tất cả** người chơi cho từng người | đo: 10,6 KB/giây mỗi client (12 người + 7 bot) |
| 2 | Chặn client chậm quá muộn: chỉ bỏ gửi khi `bufferedAmount` > 1MB (≈ 90 giây dữ liệu cũ dồn lại) → client mạng yếu nhận dữ liệu trễ hàng chục giây | đọc code v2; v3 có test mô phỏng |
| 3 | Client làm mượt "đuổi theo snapshot mới nhất": gói đến dồn cục/chậm thì mèo khác đứng hình rồi giật; input gửi mỗi ~66ms | đọc code v2 |
| 4 | Ngân sách CPU: Render Free chỉ có **0,1 CPU** (10% một core). Server v2 dùng 3–4% một core (tôi đo, máy nhanh hơn Render) → chỉ còn ~2–3× dư địa | đo + trang thông số Render |
| 5 | Độ trễ mạng (RTT) tới vùng đặt server: **không sửa được bằng code**; bạn đã yêu cầu không đổi hosting | chỉ đo được trên Render: xem `/metrics` → `pingMs` |

Phân bổ CPU (profile): 98% thời gian server rảnh; phần bận chủ yếu là gọi hệ thống gửi dữ liệu và phân tích JSON input, **logic game gần như không đáng kể** → muốn giảm CPU phải giảm số gói/dung lượng, không phải tối ưu thuật toán.

> ⚠️ **Chi phí băng thông Render:** một nguồn bên thứ ba (blog, chưa phải trang chính thức) nói từ 1/8/2026 gói Hobby chỉ gồm **5GB outbound/tháng**, vượt thì tính $0.15/GB. Tôi **chưa xác minh được trên trang chính thức**; hãy xem Render → Billing/Usage của bạn. Nếu đúng: v2 ≈ 38 MB/giờ/người chơi (≈ 130 giờ-người/tháng), v3 ≈ 4,4 MB/giờ/người (≈ 1.100 giờ-người/tháng).

## 2. Tối ưu server & mạng đã làm

- **Snapshot nhị phân** (`shared/wire.js`): 10 byte/mèo thay vì ~40 byte JSON; sự kiện nhúng chung khung → **1 gói/tick/client**.
- **Gói riêng từng client:** chỉ ack của chính họ; **vùng quan tâm**: mèo trong 1.500px gửi 20 lần/giây, mèo xa chỉ 5 lần/giây (đủ cho minimap).
- **Chống nghẽn:** client có > 24KB chưa gửi xong thì **bỏ snapshot** (cái sau ghi đè), **giữ sự kiện** gửi bù khi hết nghẽn; tồn đọng > 400 sự kiện thì gửi lại toàn bộ trạng thái (`resync`); > 512KB thì ngắt kết nối. Client yếu không kéo cả phòng.
- **Vòng lặp tick tự bù trễ** (giữ đúng 20 tick/giây khi CPU bị bóp), đo thời gian mỗi tick.
- **Id mèo 16-bit tái sử dụng an toàn**, lịch sử vị trí (1 giây) cho bù trễ, xoá lịch sử khi hồi sinh, chặn bù trễ quá giới hạn (chống nuốt "ma" sau dịch chuyển/hồi sinh).
- **Client:** nội suy theo **giờ server** (bộ đệm ~100ms + bù jitter, ngoại suy tối đa 200ms), sự kiện của người khác được hẹn giờ cho khớp vị trí đang hiển thị, đối chiếu vị trí bằng dấu thời gian input, **ăn cá dự đoán** (cá biến mất ngay lúc chạm, kể cả ping cao), input chỉ gửi khi đổi hướng/dash (nhịp tim 100ms), hiển thị ping.

### Số liệu trước/sau (cùng benchmark, cùng máy, chạy server như tiến trình riêng, 40 giây)

Đây là máy phát triển (nhanh hơn vCPU Render); dùng để **so sánh tương đối**, không phải số trên Render.

| 12 người + 7 bot, 1 phòng | v2 | v3 |
|---|---|---|
| Băng thông mỗi client | 10,6 KB/s | **1,23 KB/s (−88%)** |
| CPU server (% một core) | 3,2% | 3,9% (trong mức nhiễu giữa các lần đo: v2 2,9–4,0%, v3 3,7–4,6%) |
| Tick trung bình / p95 | 0,49 / 1,45 ms | 0,55 / 1,46 ms |
| Độ trễ event loop p99 | 6,1 ms | 6,3 ms |
| RAM (RSS) | 68 MB | 70 MB |

24 người, 3 phòng: băng thông 8,3 → **1,15 KB/s** mỗi client; CPU 4,2% → 3,9%. Chi phí vẽ client: cá thay hạt tốn thêm khoảng **0,3–0,5 ms/khung** (đo trong Chromium headless, nhiễu lớn).

**Nói thẳng:** CPU server **không giảm** (ngang nhau) — v3 giảm *băng thông* và làm *chuyển động mượt hơn*; không có bằng chứng v2 từng nghẽn CPU ở tải này. Việc lag thực sự trên Render phải đối chiếu bằng `/metrics`.

## 3. Giám sát

- `GET /health` → `{ok, rooms, players}` (không đổi).
- `GET /metrics` → JSON: `players`, `rooms` (+ độ khó từng phòng), `window` (cửa sổ ~5 giây): `tickHz`, `tickMsAvg/P95/Max`, `eventLoopLagMs{mean,p99,max}`, `cpuPctOfOneCore`, `outKBps`, `pingMs{avg,max}` (RTT do server đo), `rssMB`, `heapUsedMB`; `totals`: `bytesOut`, `snapshotsSkippedSlowClient`, `resyncs`, `slowClientsDisconnected`.
- **Log Render** mỗi 60 giây khi có người chơi: `[stats] players=… tick=…Hz …ms(avg/p95/max) loopLag p99=… cpu=…% rss=…MB out=…KB/s ping avg=…ms skipped=… resync=…`. Đổi chu kỳ bằng biến môi trường tuỳ chọn `LOG_STATS_EVERY_S` (0 = tắt). Biến mới tuỳ chọn khác: `MAX_ROOMS`. Không bắt buộc đặt biến nào.
- Cách đọc trên Render Free: `cpuPctOfOneCore` nên **thấp hơn nhiều 10%**; `tickMsP95` nên < 25ms; `eventLoopLagMs.p99` nên < 50ms; `pingMs` cao ⇒ lag do mạng/khoảng cách, không phải code. HUD trong game cũng hiện ping (📶).
- `/metrics` không chứa dữ liệu nhạy cảm; nếu không muốn công khai, đặt Render sau auth hoặc báo tôi thêm token.

## 4. Lỗi nuốt mèo (phải đứng lại, di chuyển tới lui)

**Nguyên nhân (đo được):**
1. **Tầm nuốt quá sát:** `0,85·bán kính kẻ săn + 0,15·bán kính mồi` (≈ 35px với mèo 60kg vs 12kg) trong khi hai thân mèo đã chạm nhau từ ≈ 60px. Mồi phải gần như trùng tâm mới bị nuốt.
2. **Kiểm tra rời rạc** mỗi 50ms: chạy nhanh có thể "nhảy qua" vùng nuốt giữa hai lần kiểm tra.
3. Người chơi đứng lại/chuyển hướng chính là để đưa tâm mồi vào đúng chỗ.

**Số đo (`node test/swallow-contact-bench.js`):** kẻ săn 60kg lướt qua mồi 12kg với độ lệch ngang ngẫu nhiên trong vùng hai thân chạm nhau: **v2 chỉ nuốt 57,6%** (cả đi bộ lẫn dash); **v3 nuốt 72,8% khi đi bộ, 88,1% khi dash**. Phần còn lại là cú sượt mép (mồi bị phủ < ~1/3) cố ý chưa tính; muốn "chạm mép là nuốt" tăng `REACH_PREY` trong `shared/rules.js`.

**Cách sửa:** tầm nuốt = `1,0·ra (+25% khi lao) + 0,3·rb`; **va chạm quét (swept)** — khoảng cách nhỏ nhất giữa hai quỹ đạo trong cả tick; server là nơi duy nhất quyết định; một mồi chỉ một kẻ săn (kẻ ăn sâu nhất); bù trễ (RTT + 100ms, tối đa 300ms) kèm giới hạn quãng dịch chuyển; **giữ nguyên** quy tắc chênh lệch cân nặng (1,6×; 1,4× khi lao). Không có cooldown/animation chặn nuốt (kiểm tra lại: không có).

**Kết quả thực (trình duyệt thật, `test/e2e-v3.js`):** nuốt ngay ở lượt đầu, mèo đi ≤ khoảng cách đầu + đoạn mồi chạy thêm (không quay lại): đi bộ vào mèo đứng yên, dash vào mèo đứng yên, dash đuổi mèo đang chạy — ở RTT 0 và RTT 300ms. Từ lúc màn hình thấy chạm đến lúc xác nhận: ~20–30ms (RTT 0); ~270–390ms (RTT 300ms) — là **giới hạn vật lý của mạng** (một vòng RTT), không nuốt "tức thì" được ở ping cao. Đuổi bot 90 giây bằng trình duyệt thật qua proxy làm trễ (`test/latency-chase.js`): **v2 0 kill ở mọi mức trễ; v3 1 kill ở RTT 0 và 1 kill ở RTT 300ms**, mỗi lần chạm thấy trên màn hình đều thành kill (mẫu nhỏ: 1/1 mỗi mức). Đã chặn: nuốt từ xa 1.500px; nuốt "ma" sau dịch chuyển; 2 người cùng nuốt một mục tiêu.

## 5. Ba độ khó (khác nhau về hành vi, dùng chung luật dash/năng lượng/ngưỡng nuốt với người chơi)

| | EASY | NORMAL | HARD |
|---|---|---|---|
| Tầm nhìn (công bằng: nhỏ hơn khung nhìn người chơi) | 420px | 520px | 650px |
| Nhịp suy nghĩ | 0,6–1,0s | 0,25–0,5s | 0,12–0,22s |
| Săn người chơi / bot nhỏ | ~12% / ~35% (hay bỏ qua, ưu tiên kiếm cá) | 100% | 100% |
| Bỏ chạy | chỉ khi kẻ địch < 230px, **không dash** | < 520px, dash khi gần | < 560px, dash sớm, **tránh bị dồn vào tường** (cộng lực đẩy khỏi tường) |
| Chọn mục tiêu | gần nhất | gần nhất | chấm điểm: giá trị/khoảng cách, **bỏ mồi đang ở cạnh mèo lớn**, ưu tiên mồi sát tường, giữ mục tiêu ~3s |
| Nhắm | thẳng | trước 0,3s | **chặn đầu** theo vận tốc ước lượng |
| Tấn công | không dash | dash khi < 4 bán kính | áp sát bằng tốc độ thường, chỉ **lao khi đủ gần**, **rút lui ~3s** khi hết sức |

- **Không gian lận:** bot chỉ xét mèo trong tầm nhìn của mình; không biết vị trí ngoài tầm (đã test: ở 700–900px không bot nào phản ứng).
- **Thống nhất trong phòng:** độ khó do người tạo phòng quyết định; người vào sau thấy độ khó của phòng (HUD + thông báo). Phòng chung `PUBLIC` tách theo độ khó (EASY/NORMAL/HARD riêng). Chọn độ khó ở menu, được nhớ; offline dùng độ khó đã chọn.
- **Số đo mô phỏng** (60 lượt × 3 phút; `node test/difficulty-sim.js 3 60`), bot giết **người chơi/phút** — thụ động: Easy 0,39 · Normal 1,39 · Hard 2,12; "trung bình" (phản ứng 0,4s, thấy 500px): Easy 0,02 · Normal 0,37 · Hard 0,52. Bot giết bot/phút: Easy 0,05–0,11 · Normal 0,47 · Hard 0,94–0,97. % thời gian bot dash: 0 · ~1 · ~3. Chi phí bước mô phỏng 7 bot: 0,039 / 0,043 / 0,056 ms mỗi tick; một lần suy nghĩ ~5–8µs.
- **⚠️ Bot nguy hiểm hơn v2 (thay đổi hành vi bạn cần biết).** Đo bằng mô phỏng 3 phút × 80 lượt, người chơi "trung bình" (biết ăn cá, né mèo lớn): **v2 0,01 lần chết/phút** (bot gần như vô hại) → **v3 Normal 0,29/phút (~3,5 phút một lần)**; Easy ≈ 0,02 (gần v2), Hard ≈ 0,5. Nguyên nhân: bot nay dùng đúng luật nuốt chung + va chạm quét + AI kiểm tra đồng nhất, và bot đang săn **không còn bị kéo về giữa bản đồ khi gần tường** (v2 làm bot bỏ dở cuộc săn). Với người chơi *thụ động* trôi thẳng vào tường rồi đứng im, tỉ lệ tăng mạnh (v2 0,21 → v3 1,73/phút) vì bot dồn được mồi vào tường. Tầm nuốt **không** phải nguyên nhân (đưa về tầm v2 vẫn ~1,55). Nếu thấy Normal khó: chọn Easy, hoặc chỉnh `huntHuman`/`react`/`sight` của `normal` trong `DIFF` (`shared/rules.js`).
- Ghi chú cân bằng có sẵn từ v2 (không đổi): bot lớn rất nhanh (trung bình ~120kg sau 3 phút, ở cả v2).

## 6. Cá thay hạt thức ăn

- Mọi thức ăn (kể cả thức ăn rơi khi mèo bị nuốt) vẽ thành **cá nhỏ**: 12 màu × 3 kiểu (trơn/sọc/đốm) × 8 hướng, đuôi vẫy, bơi nhấp nhô; cá lớn (giá trị 3) to hơn; cá rơi có quầng sáng. Sprite dựng sẵn một lần (`drawImage`), **không còn code vẽ hạt tròn**.
- **Cơ chế giữ nguyên:** tự ăn khi chạm; biến mất khi ăn; cộng cân theo công thức cũ (`v·1,5/(1+kg/110)`, đã test khớp 3,808 kg); 650 cá, bố cục/tốc độ mọc lại (25s) không đổi → **không thêm đối tượng, không thêm dữ liệu mạng**. Không gửi thêm gì qua WebSocket so với hạt.
- Hai người chạm cùng một cá: chỉ một người ăn (server); đồng bộ biến mất ở mọi client.
- Hiệu năng: xem mục 2 (+0,3–0,5 ms/khung).

## 7. Giao thức v3 & tương thích

Client gửi `join` kèm `v:3` và `dif`. Frontend cũ + backend mới ⇒ "Phiên bản game đã cũ, tải lại trang (Ctrl+F5)". Frontend mới + backend cũ ⇒ "Server đang chạy phiên bản cũ, hãy deploy lại". Đã test cả hai chiều. **Hãy deploy backend và frontend cùng lúc.**

## 8. Cập nhật lên Render + phương án rollback

1. Giải nén `khanh-miu-v3.zip` đè lên repo (giữ `.git`). **Đẩy cả `shared/` và `server/`**. `render.yaml`, dependencies, biến môi trường: **không đổi**.
2. `git add -A && git commit -m "KHÁNH MIU v3" && git push` → Render tự deploy (hoặc Manual Deploy → Deploy latest commit).
3. Kiểm tra: `https://<tên>.onrender.com/health` → `{"ok":true,...}`; `/metrics` → có `"version":"v3"`; mở game ở hai thiết bị cùng mã phòng; xem **Logs** có dòng `[stats]`.
4. GitHub Pages: `index.html` mới ghi đè file cũ — điền lại `const CFG={server:'wss://…'}` nếu bạn đã sửa dòng này; Ctrl+F5.
5. **Rollback:** giải nén `backups/khanh-miu-v2-sau-nang-cap.zip` (bản chạy ổn trước v3; checksum `backups/v2-sha256.txt`) rồi push lại, hoặc `git revert`. Bản v1 vẫn ở `backups/khanh-miu-v1-truoc-nang-cap.zip`.

## 9. Kiểm thử

```bash
npm install
npm test                    # luật + AI + giao thức + chiến đấu + client chậm + soak 20s (không cần trình duyệt)
npm i --no-save playwright && npx playwright install chromium
npm run test:browser        # 2 trình duyệt: multiplayer, combat, độ khó, cá, nuốt khi có ping cao, /metrics, offline
node test/perf-bench.js . 3 local 40 12 1      # benchmark tải (băng thông, CPU, tick, event loop)
GC=1 node test/soak.js 120  # soak + ép GC: kiểm tra rò rỉ bộ nhớ (heap sau GC phải phẳng)
node test/difficulty-sim.js 3 40               # so sánh 3 độ khó bằng mô phỏng
node test/swallow-contact-bench.js             # tỉ lệ nuốt khi chạm: luật cũ so với mới
node test/draw-bench.js                        # chi phí vẽ client
node test/latency-chase.js 150 90              # trình duyệt thật + proxy làm trễ 150ms mỗi chiều, đuổi bot
```
`test/offline-combat-and-compat.js` cần bản v1 giải nén ở `/tmp/v1/khanh-miu` (để thử backend cũ).

## 10. Giới hạn / chưa kiểm chứng

- **Chưa chạy trên Render thật** (không deploy được, không có mạng ngoài): chưa có số CPU/RAM/ping thật, chưa test hai thiết bị ở hai mạng khác nhau, chưa xem log Render.
- Mọi số liệu hiệu năng ở trên đo ở máy phát triển với client giả lập (ws) và trình duyệt headless.
- Nuốt ở ping cao vẫn trễ ~1 RTT khi nhìn thấy kết quả (giới hạn của mạng).
- Bot vẫn lớn rất nhanh như v2 (không đổi vì bạn yêu cầu giữ cân bằng tăng trưởng).
