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
