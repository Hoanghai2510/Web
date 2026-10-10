# Hội GDCSSKCĐ VN — Website hợp nhất v3.0

Dự án gồm website công khai và cổng quản trị dùng chung Backend Node.js/Express + SQLite.

## Chạy trên macOS

Yêu cầu Node.js 20+ (khuyến nghị LTS). Trong thư mục dự án:

```bash
npm install
cp .env.example .env
npm start
```

Mở:
- Website công khai: http://localhost:3000/
- Cổng quản trị: http://localhost:3000/admin
- Kiểm tra API: http://localhost:3000/api/health

Nếu đã có file `data/portal.db`, giữ nguyên file này để không mất dữ liệu. Để dùng chung nhiều máy, triển khai ứng dụng trên một máy chủ trong mạng nội bộ/VPS rồi cho các máy khác truy cập IP/tên miền máy chủ; không chạy một database riêng trên từng máy.

## Kiểm thử tự động

Kiểm thử chạy trên database tạm riêng (`data/test-portal.db`, tự xóa sau khi chạy), không tác động dữ liệu thật:

```bash
npm test
```

Suite bao phủ: public API + SEO (robots/sitemap), vòng đời bài viết/văn bản/đơn vị, phân quyền RBAC theo vai trò (admin/reviewer/unit_lead/finance), khóa tài khoản demo ở production, tải lên tệp (whitelist), chặn path traversal khi tải văn bản, ngăn XSS và quản lý tài khoản. Bắt đầu ở chế độ `NODE_ENV=production`.

## Triển khai production

1. `cp .env.example .env`, đặt `NODE_ENV=production`, tạo `JWT_SECRET` ngẫu nhiên (không dùng giá trị mẫu). Ứng dụng sẽ **từ chối khởi động** nếu production thiếu `JWT_SECRET`.
2. Cài PM2 hoặc systemd để chạy `npm start` bền bỉ, đặt **HTTPS qua reverse proxy** (Caddy/Nginx) trước cổng 3000.
3. Tạo tài khoản quản trị thật, đổi mật khẩu demo rồi **khóa tài khoản demo**: ở production, login bằng tài khoản demo (`admin`/`reviewer`/`unitlead`/`finance`) trả về 403 trừ khi set `ALLOW_DEMO=1`.
4. Sao lưu định kỳ: dừng ứng dụng rồi copy cả `data/portal.db`, `-wal`, `-shm` (hoặc dùng `VACUUM INTO`), kiểm tra khôi phục thử.
5. Kiểm tra lại phân quyền sau khi có dữ liệu thật. Với quy mô lớn/nhiều giao dịch nhạy cảm, nên chuyển sang PostgreSQL.

## Tài khoản demo (chế độ phát triển)

- Quản trị viên: `admin` / `admin123`
- Người duyệt báo cáo: `reviewer` / `review123`
- Trưởng đơn vị: `unitlead` / `unit123`
- Phụ trách tài chính: `finance` / `finance123`

Các tài khoản này bị khóa tự động khi `NODE_ENV=production` (trừ khi bật `ALLOW_DEMO=1`). Không dùng tài khoản mẫu hoặc dữ liệu nhân sự giả lập trong môi trường thật.

## Đối chiếu tài liệu Word yêu cầu

Website công khai có các nhóm nội dung: (I) giới thiệu Hội, ban lãnh đạo và văn bản quan trọng; (II) chính sách, sự kiện Hội, hoạt động đơn vị và tin liên quan; (III) hệ thống tổ chức gồm Liên chi hội, Chi hội, Văn phòng/Ban chuyên môn, Viện/Trung tâm, Văn phòng đại diện và doanh nghiệp hội viên; (IV) quản trị nhân sự, lãnh đạo đơn vị, kết nạp hội viên cá nhân/tập thể, bầu cử và bổ nhiệm; (V) hội phí, phí thành lập và đóng góp từ thiện.

Cổng quản trị hiện có: dashboard, CRUD tổ chức, hồ sơ nhân sự/hội viên theo phạm vi quyền, báo cáo nháp/gửi duyệt/yêu cầu sửa/phê duyệt/xuất CSV, quản lý khoản hội phí, tạo bản ghi giao dịch, xác minh thủ công và xuất CSV đối soát, nhật ký hệ thống, CMS tin tức/văn bản công khai, quản lý tài khoản và cấu hình hiển thị.

## Phạm vi chưa được giả mạo là đã hoàn tất

- Website công khai đang dùng nội dung mẫu và danh mục tài liệu mẫu; cần Hội cung cấp thông tin chính thức, ảnh, văn bản PDF, tin bài và đầu mối liên hệ.
- Phần thu hội phí hiện là quy trình ghi nhận/xác minh thủ công; chưa tích hợp cổng thanh toán hoặc xác nhận giao dịch tự động từ ngân hàng. Không coi mã giao dịch demo là thanh toán thật.
- Hồ sơ đính kèm trong báo cáo và chức năng quyên góp có chứng từ chưa được hoàn thiện.
- SQLite phù hợp cho demo/triển khai nhỏ trên một máy chủ. Với nhiều người dùng đồng thời và dữ liệu nhạy cảm quy mô lớn, nên chuyển PostgreSQL về lâu dài. Đã bổ sung: JWT bắt buộc ở production, khóa tài khoản demo, index hiệu năng, sitemap/robots, giới hạn đăng nhập và test tự động.

## Các trường dữ liệu hiện có

- `units`: id, name, code, parent_id, unit_type, slug, description, address, phone, email, head_name, founded_at, status, is_public, search_key.
- `personnel`: id, slug, full_name, title, position, group_role, term, bio, email, phone, unit_id, status, is_public, sort_order, search_key.
- `users`: id, username, password_hash, full_name, role, unit_id, active, is_demo, created_at.
- `reports`: id, title, period, content, unit_id, created_by, status, reviewer_id, review_note, submitted_at, reviewed_at, created_at.
- `dues`: id, unit_id, period, amount, status, created_at.
- `payments`: id, dues_id, transaction_ref, amount, method, status, provider_ref, note, created_by, verified_by, created_at, verified_at.
- `audit_logs`: id, user_id, action, entity, entity_id, detail, created_at.
- `posts`: id, slug, title, type, category, excerpt, content, cover_image, author, event_date, event_location, attachment, status, is_featured, view_count, published_at, created_by, search_key.
- `documents`: id, slug, title, doc_number, doc_type, category, issuer, issued_at, summary, file_url, status, download_count, created_by, search_key.
- `settings`: key, value, updated_at.
