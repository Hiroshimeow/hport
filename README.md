# 🚀 H-PORT Tunnel

**H-PORT** is a lightweight tunneling tool that securely exposes your localhost to the internet through your own Cloudflare-managed domain. It uses Cloudflare's edge network to provide instant, secure public URLs for local development.

## ✨ Features
- 🛡️ **Secure**: Built-in protection against token leakage in logs.
- 🔗 **Instant URL**: Get a `*.your-domain.tld` address in seconds.
- 🧹 **Scoped Cleanup**: `Ctrl+C` only cleans up the current H-PORT-managed session resources.
- 🗑️ **Scheduled Orphan Cleanup**: Managed orphan or inactive resources older than 1 day are auto-deleted by the Worker cron.
- 🔒 **Protected Names**: Reserved subdomains can be blocked from create, audit, and cleanup flows.
- ♻️ **Managed Reuse Only**: Existing unmanaged DNS records are never overwritten by normal tunnel creation.
- 📋 **Audit + Preview Cleanup**: The Worker can report managed orphans and `test*` / `*test` review candidates before any deletion.
- ⏱️ **Background Mode**: Launch `cloudflared` detached with `--bg` when you want the tunnel to stay up after the terminal closes.
- 🚀 **Zero Config**: No complex setup required.

## 💻 Installation

### 1. Prerequisites
This tool requires **cloudflared** to be installed on your system.
- [Download & Install cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/setup/)

### 2. Install via NPM
```bash
npm install -g hport-tunnel
```

## 🚀 Usage

Set the backend your CLI should talk to if you deploy your own Worker:
```bash
# PowerShell
$env:HPORT_BACKEND_URL="https://your-worker.example.workers.dev"

# bash/zsh
export HPORT_BACKEND_URL=https://your-worker.example.workers.dev
```

Expose your local port 8080:
```bash
hport 8080
```

Expose with a custom subdomain:
```bash
hport 3000 -s my-app
```

Reuse the same H-PORT-managed subdomain and auto-confirm replacement:
```bash
hport 9993 -s abc -y
```

Expose a specific local IP and port:
```bash
hport 192.168.1.10:5000
```

Run in background mode:
```bash
hport 8101 -s mcp --bg
```

## 🛠 Worker Setup

Main Worker config lives in `server/wrangler.toml`:
- `CF_ACCOUNT_ID`
- `CF_ZONE_ID`
- `PUBLIC_BASE_DOMAIN`
- `PROTECTED_SUBDOMAINS`

Required secret:
```bash
cd server
npx wrangler secret put CF_API_TOKEN
```

Deploy:
```bash
cd server
npm install
npm run deploy
```

## 🧭 Operations

Foreground:
- `hport 8101 -s demo`
- Tunnel stays attached to the terminal.
- `Ctrl+C` triggers scoped cleanup for the current session only.

Background:
- `hport 8101 -s demo --bg`
- CLI returns immediately after the tunnel becomes live.
- Detached mode does not auto-clean when you later kill `cloudflared` outside the CLI.

Worker cleanup behavior:
- Cron runs every 2 days.
- Only H-PORT-managed orphan or inactive resources older than 1 day are auto-deleted.
- Unmanaged DNS or tunnels are never auto-deleted.
- Protected subdomains are never auto-deleted.

Manual management endpoints:
- `GET /audit`
- `POST /cleanup-preview`
- `POST /cleanup-confirm`

## ⚠️ Security Notice
If you are using version `1.0.0`, please update to `1.0.1` immediately to ensure your connection tokens are not leaked in terminal error logs.

## 📄 License
ISC
