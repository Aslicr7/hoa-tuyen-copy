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
- Phòng mới mặc định 2 đấu 2 (vẫn chỉnh được tới 8 đấu 8).
- Bản đồ nhỏ hiện cả đối thủ (màu đội họ), không chỉ đồng đội. Người ở gần là chấm; người ở ngoài vòng tròn là mũi tên ở mép, chỉ về phía họ.
- Không tải ảnh/âm thanh bị thiếu trong gói gốc.

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
Chọn đội, người khác bấm **Sẵn sàng**, chủ phòng bấm **Bắt đầu**. Phòng mới mặc định 2 đấu 2.

- 2 đấu 2: mỗi bên 2 người. Để "Thêm bot" = Có thì bot lấp các chỗ trống cho đủ cỡ đội.
- 4 người cùng đội đánh bot: dồn cả 4 vào một bên, bật "Thêm bot".
- Tắt bot thì hai đội phải đông bằng nhau mới bắt đầu được.

## Tuỳ chỉnh (biến môi trường, sửa trong `hoatuyen.service`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | 8787 | Cổng web + online |
| `ACCESS_CODE` | (trống) | Bản nhẹ đã ẩn ô nhập mã, nên đừng đặt biến này (đặt vào thì không ai vào được) |
| `MAX_ROOMS` | 16 | Số phòng tối đa |
| `MAX_PLAYERS` | 64 | Số người online tối đa |

Đổi cổng thì sửa `Environment=PORT=...`, rồi `systemctl daemon-reload && systemctl restart hoatuyen`.

## Ghi chú

- Cấu trúc: `public/` là game (đã sửa trong `public/js/index-lite-*.js` và `public/css/index-lite-*.css`),
  `server/core.mjs` là phần luật chơi lấy từ chính game để máy chủ tự chạy trận, `server.mjs` là sảnh/phòng.
- Code của Offline/Luyện tập vẫn nằm trong file JS (chỉ ẩn nút, không còn đường vào); nó không chạy nên không làm nặng máy.
