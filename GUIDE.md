
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



# 🚀 H-PORT Tunnel - Management Guide

Welcome to the **H-PORT** project. This tool allows you to expose localhost to the internet using a personal domain via Cloudflare's infrastructure. The project consists of two parts: **Server** (Cloudflare Worker) and **Client** (CLI tool).

---

## 🛠 1. Server Management (Backend)
This part runs on Cloudflare Workers to coordinate tunnel and DNS lifecycle.

### Initial Setup:
1. Navigate to the server directory: `cd server`
2. Install dependencies: `npm install`
3. Log in to Cloudflare: `npx wrangler login`

### Configuration:
Open `wrangler.toml` and fill in:
- `CF_ACCOUNT_ID`: Found in your Cloudflare Account Home.
- `CF_ZONE_ID`: Found in the Overview page of your domain `hcu-lab.me`.

### Security Setup (Secrets):
Do not put your API Token in plain text. Run the following command:
```bash
npx wrangler secret put CF_API_TOKEN
```
Then paste your API Token (with DNS:Edit and Cloudflare Tunnel:Edit permissions).

### Deployment:
Every time you modify the code in `server/index.js`, run:
```bash
npm run deploy
```

---

## 💻 2. Client Management (CLI Tool)
This is the tool users install to run tunnels.

### Building the Tool:
To bundle all dependencies into a single file (Zero Dependencies):
1. Return to the root directory: `cd ..`
2. Run the build command: `npm run build`
=> The result will be located in `dist/index.js`.

### Running in Different Environments:
- **Windows**: Run `hport.bat`.
- **Linux/Ubuntu**: Run `hport.sh`.

### Global Installation via NPM:
```bash
npm install -g hport-tunnel
```

---

## 🌐 3. Operational Workflow
1. **Client** sends a `POST /create-tunnel` request to the **Server**.
2. **Server** calls the Cloudflare API to create a new Tunnel and a DNS record (e.g., `lab-xyz.hcu-lab.me`).
3. **Server** returns the `Tunnel Token` and `URL` to the Client.
4. **Client** uses the token to initiate the connection via `cloudflared`.
5. Upon **Ctrl+C**: The Client sends a `DELETE /cleanup` request to the Server to remove the DNS record and the Tunnel.

---

## 🔐 4. Security Notes
- **Never share your `.env` or API Tokens** on GitHub.
- The project uses `@vercel/ncc` to protect CLI source code and simplify deployment.
- Your domain `hcu-lab.me` remains fully under your control via the Server.

---
**Happy Tunneling with H-PORT!**
