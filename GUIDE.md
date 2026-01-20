# 🚀 H-PORT Tunnel - Toàn tập hướng dẫn quản lý

Chào mừng bạn đến với dự án **H-PORT**. Đây là công cụ giúp public localhost ra internet sử dụng tên miền cá nhân thông qua hạ tầng Cloudflare. Dự án gồm 2 phần: **Server** (Cloudflare Worker) và **Client** (CLI tool).

---

## 🛠 1. Quản lý Server (Backend)
Phần này chạy trên Cloudflare Workers để điều phối việc tạo/xóa tunnel.

### Cài đặt lần đầu:
1. Truy cập thư mục server: `cd server`
2. Cài đặt Wrangler: `npm install`
3. Đăng nhập Cloudflare: `npx wrangler login`

### Cấu hình thông số:
Mở file `wrangler.toml` và điền:
- `CF_ACCOUNT_ID`: Lấy từ Account Home của Cloudflare.
- `CF_ZONE_ID`: Lấy từ trang Overview của tên miền `hcu-lab.me`.

### Thiết lập Secret (Bảo mật):
Tuyệt đối không điền API Token vào file text. Hãy chạy lệnh sau:
```bash
npx wrangler secret put CF_API_TOKEN
```
Sau đó dán mã API Token (quyền DNS:Edit, Tunnel:Edit) vào.

### Deploy (Cập nhật Server):
Mỗi khi bạn sửa code trong `server/index.js`, hãy chạy:
```bash
npm run deploy
```

---

## 💻 2. Quản lý Client (CLI Tool)
Phần này là công cụ người dùng cài đặt để chạy tunnel.

### Xây dựng (Build) công cụ:
Để đóng gói tất cả thư viện vào 1 file duy nhất (Zero Dependencies):
1. Quay lại thư mục gốc: `cd ..`
2. Chạy lệnh build: `npm run build`
=> Kết quả sẽ nằm ở thư mục `dist/index.js`.

### Chạy trên các môi trường:
- **Windows**: Chạy file `hport.bat`.
- **Ubuntu/Linux**: Chạy file `hport.sh`.

### Cài đặt toàn cầu (NPM):
```bash
npm install -g hport-tunnel
```

---

## 🌐 3. Cách vận hành từ A-Z

### Quy trình khi người dùng gõ `hport 8080`:
1. **Client** gửi yêu cầu `POST /create-tunnel` lên **Server**.
2. **Server** gọi Cloudflare API để tạo Tunnel mới và tạo bản ghi DNS (ví dụ: `lab-xyz.hcu-lab.me`).
3. **Server** trả về `Tunnel Token` và `URL`.
4. **Client** sử dụng `cloudflared` (nếu có sẵn trên máy) để khởi chạy kết nối bằng Token đó.
5. Khi người dùng nhấn **Ctrl+C**: Client gửi lệnh `DELETE /cleanup` lên Server để xóa sạch DNS và Tunnel trên Cloudflare.

---

## 🔐 4. Lưu ý bảo mật
- **Không chia sẻ file `.env` hoặc API Token** lên GitHub.
- Dự án đã sử dụng `@vercel/ncc` để bảo vệ mã nguồn CLI và giúp việc triển khai không cần thư mục `node_modules`.
- Tên miền `hcu-lab.me` hoàn toàn nằm dưới sự kiểm soát của bạn thông qua Server.

---
**Chúc bạn vận hành H-PORT thành công!**
