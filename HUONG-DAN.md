# Hỏa Tuyến: bản nhẹ, chỉ chơi online

Thư mục này gồm cả trang game lẫn máy chủ online, chạy chung **một cổng: 8787**
(không dùng 3000 hay 8069).

## Vì sao bản cũ không tạo phòng được

Bản cũ kết nối tới máy chủ online `wss://hoatuyen.simplecray.com/play` của tác giả gốc, mà
máy chủ đó không còn nhận kết nối. Gói game cũng không có code máy chủ. Bản này:

- có máy chủ riêng `server.mjs` (sảnh, phòng, trận đấu chạy ngay trên VPS của bạn);
- game tự kết nối về chính địa chỉ đang mở trang (`ws://<địa chỉ>:8787/play`);
- bỏ khoá tên miền (bản cũ chỉ chạy ở hoatuyen.vercel.app/localhost, mở bằng IP VPS sẽ bị đá đi).

## Bản nhẹ đã bỏ / đổi gì

- Mở trang là vào thẳng ô nhập tên (không còn ô mã vào chơi), rồi tới sảnh phòng. Bỏ Offline (đấu bot một mình) và Luyện tập.
- Menu không vẽ cảnh 3D và không chạy trận bot ngầm nữa (trước đây menu còn nặng hơn lúc chơi).
- Mặc định tắt bóng đổ và khử răng cưa, độ nét giới hạn 1×. Máy khỏe có thể bật lại trong Cài đặt → Hình ảnh.
- Bỏ viền mực quanh nhân vật/đồ vật: số lệnh vẽ giảm một nửa.
- Tạo phòng không cần chọn số người: phòng chứa tối đa 10 người, ai cũng tự đổi bên được, hai bên lệch người vẫn chơi được. Chủ phòng thêm/bớt bot cho từng bên (0–8 bot mỗi bên).
- Bản đồ nhỏ hiện cả đối thủ (màu đội họ), không chỉ đồng đội. Người ở gần là chấm; người ở ngoài vòng tròn là mũi tên ở mép, chỉ về phía họ.
- Đã bổ sung các file gói gốc còn thiếu (lấy từ hoatuyen.vercel.app): âm thanh súng/dao (`public/cf/sounds`), biểu tượng hạ gục (`public/cf/killmarks`), tiếng tàu (`public/sounds/train`) và ảnh bản đồ (`public/maps`).

## Thử trên máy mình

Cần Node.js 18 trở lên.

```
node server.mjs
```

Mở http://localhost:8787, nhập tên → **Vào sảnh**.

## Đưa lên VPS 103.249.116.187 (Ubuntu/Debian)

1. Chép thư mục lên VPS (chạy trên máy Windows của bạn):
   ```
   scp -r hoatuyen-online root@103.249.116.187:/opt/
   ```
2. Trên VPS, nếu chưa có Node.js:
   ```
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt install -y nodejs
   ```
3. Chạy thử: `cd /opt/hoatuyen-online && node server.mjs`, mở http://103.249.116.187:8787
4. Cho chạy luôn, tự bật lại khi khởi động VPS:
   ```
   cp /opt/hoatuyen-online/hoatuyen.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now hoatuyen
   ```
   Xem log: `journalctl -u hoatuyen -f`
5. Mở cổng tường lửa nếu có: `ufw allow 8787/tcp` (và trong trang quản lý của nhà cung cấp VPS nếu họ có tường lửa riêng).

## Chơi 4 người

Mọi người mở http://103.249.116.187:8787 → nhập tên → **Vào sảnh**.
Một người **Tạo phòng**, những người khác chọn phòng rồi **Vào phòng** (hoặc **Vào nhanh**).
Chọn đội, người khác bấm **Sẵn sàng**, chủ phòng bấm **Bắt đầu**. Mỗi phòng tối đa 10 người.

- Bấm tên đội (**Sang đội này**) để đổi bên, lúc nào cũng được (trừ khi đang trong trận).
- Chủ phòng bấm **−** / **+** ở dòng bot của mỗi bên để bớt/thêm bot (0–8 bot mỗi bên). Số bot giữ nguyên dù có người vào/ra giữa trận.
- Hai bên lệch người vẫn bắt đầu được, chỉ cần mỗi bên có ít nhất 1 người hoặc 1 bot.
- Giữa trận, nếu một bên không còn ai (người đã thoát hết và bên đó không có bot) thì trận kết thúc sớm, bên còn lại thắng.
- 4 người cùng đội đánh bot: dồn cả 4 vào một bên, thêm bot cho bên kia.

## Tuỳ chỉnh (biến môi trường, sửa trong `hoatuyen.service`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | 8787 | Cổng web + online |
| `MAX_ROOMS` | 16 | Số phòng tối đa |
| `MAX_PLAYERS` | 64 | Số người online tối đa |

Đổi cổng thì sửa `Environment=PORT=...`, rồi `systemctl daemon-reload && systemctl restart hoatuyen`.

## Ghi chú

- Cấu trúc: `public/` là game (đã sửa trong `public/js/index-lite-*.js` và `public/css/index-lite-*.css`),
  `server/core.mjs` là phần luật chơi lấy từ chính game để máy chủ tự chạy trận, `server.mjs` là sảnh/phòng.
- Code của Offline/Luyện tập vẫn nằm trong file JS (chỉ ẩn nút, không còn đường vào); nó không chạy nên không làm nặng máy.
