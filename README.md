# Cổng quản trị Hội GDCSSKCĐ VN — bản nâng cấp 2.0

Bản nâng cấp ưu tiên giao diện quản trị hiện đại, responsive, và bổ sung backend/API + SQLite để nhiều máy có thể dùng chung dữ liệu khi cùng truy cập một máy chủ.

## Chức năng có trong bản này
- Backend Node.js/Express và cơ sở dữ liệu SQLite nằm ở phía máy chủ.
- Đăng nhập thật theo tài khoản được lưu trong DB; mật khẩu được băm bằng bcrypt; token hết hạn sau 8 giờ; giới hạn thử đăng nhập.
- Phân quyền theo vai trò: quản trị viên, người duyệt báo cáo, trưởng đơn vị, phụ trách tài chính. Trưởng đơn vị chỉ truy cập dữ liệu thuộc đơn vị mình ở các API nhân sự/báo cáo/hội phí.
- Quản lý đơn vị và hồ sơ nhân sự; nhật ký kiểm toán cho các thao tác quan trọng.
- Báo cáo: tạo bản nháp → gửi duyệt → phê duyệt/yêu cầu sửa → xuất CSV.
- Hội phí: danh sách khoản phải thu, tạo mã tham chiếu giao dịch, xác minh thủ công, cập nhật trạng thái khoản thu và xuất CSV đối soát.
- Giao diện responsive cho màn hình máy tính và điện thoại.

## Chạy thử trên máy
Yêu cầu Node.js 20 trở lên.

1. Giải nén thư mục dự án.
2. Mở Terminal/CMD tại thư mục dự án và chạy:
   ```bash
   npm install
   ```
3. Sao chép `.env.example` thành `.env`. Đổi `JWT_SECRET` thành chuỗi ngẫu nhiên dài trước khi chạy trong môi trường thật.
4. Chạy:
   ```bash
   npm start
   ```
5. Mở `http://localhost:3000`.

## Tài khoản demo lần đầu
- Quản trị viên: `admin` / `admin123`
- Người duyệt báo cáo: `reviewer` / `review123`
- Trưởng Chi hội Hà Nội: `unitlead` / `unit123`
- Phụ trách tài chính: `finance` / `finance123`

Tài khoản demo được tạo tự động khi database rỗng. Đổi mật khẩu sau khi đăng nhập. Không triển khai công khai khi vẫn dùng mật khẩu demo.

## Dùng chung giữa nhiều máy
Chạy server trên một máy chủ luôn bật hoặc VPS; các máy khác truy cập địa chỉ máy chủ, ví dụ `http://192.168.1.20:3000`. Tất cả máy khi truy cập cùng server sẽ dùng cùng một database. Nếu truy cập từ ngoài mạng nội bộ, cần triển khai HTTPS, firewall, sao lưu và cấu hình máy chủ an toàn. Không đưa file `data/portal.db` lên Git hoặc gửi qua mạng không an toàn.

**Lưu ý về SQLite:** phù hợp bản thử nghiệm nhỏ trên một máy chủ. Nếu số người dùng/giao dịch tăng, nên chuyển sang PostgreSQL/MySQL được quản trị tập trung. Không đặt file SQLite trong thư mục đồng bộ cloud hoặc chia sẻ qua NAS để nhiều tiến trình ghi trực tiếp.

## Những phần chưa phải production
1. **Thanh toán thật:** chưa tích hợp ngân hàng/QR/ví/cổng thanh toán. Chức năng hiện tạo mã giao dịch demo và cho phép nhân sự tài chính xác minh thủ công; không thu tiền và không tự chứng minh đã nhận tiền. Để kích hoạt cần chọn nhà cung cấp (ví dụ VietQR qua đối tác, VNPay, MoMo), đăng ký merchant, lưu secret ở server, xác minh chữ ký webhook, xử lý idempotency và đối soát sao kê.
2. **Bảo vệ dữ liệu nhân sự:** đã có xác thực và giới hạn quyền ở API, nhưng trước khi dùng dữ liệu thật cần HTTPS, chính sách mật khẩu/2FA, quản lý phiên an toàn hơn (cookie HttpOnly), mã hóa bản sao lưu, phân loại trường nhạy cảm, quy trình cấp/thu hồi tài khoản, kiểm thử phân quyền và quy trình xử lý sự cố. Token trình duyệt hiện lưu tạm trong localStorage để đơn giản hóa bản demo.
3. **Quản lý tài khoản:** tài khoản demo được seed; giao diện tạo/sửa tài khoản, mời người dùng, reset mật khẩu và khóa tài khoản chưa làm.
4. **Báo cáo:** hiện xuất CSV. Mẫu báo cáo PDF/Excel theo biểu mẫu chính thức và luồng ký số chưa tích hợp.
5. **Triển khai:** chưa có cấu hình domain/HTTPS, reverse proxy, backup tự động, giám sát và pipeline triển khai.

## Cấu trúc
- `server.js`: API, xác thực, phân quyền, SQLite, seed dữ liệu demo.
- `public/index.html`: giao diện.
- `public/styles.css`: thiết kế responsive.
- `public/app.js`: điều khiển giao diện và gọi API.
- `data/portal.db`: tự sinh khi chạy lần đầu.
- `.env.example`: biến môi trường mẫu.

Dữ liệu nhân sự trong database hiện là dữ liệu giả minh họa. Hãy thay bằng dữ liệu hợp lệ chỉ sau khi hệ thống được triển khai và kiểm tra bảo mật.
