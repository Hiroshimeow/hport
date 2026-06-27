# H-PORT Tunnel

`hport` exposes a local HTTP service through your Cloudflare-managed domain.
For this repo, a typical flow is publishing `http://127.0.0.1:8101/mcp` to a hostname such as `https://mcp-thinkbook.hcu-lab.me/mcp`.

## Features
- Secure token handling in CLI logs.
- Managed DNS + tunnel creation through a Cloudflare Worker.
- Scoped cleanup: `Ctrl+C` only removes the current H-PORT-managed session.
- Background mode with `--bg`.
- Cron cleanup for managed orphan resources.
- Protected subdomains and unmanaged DNS overwrite protection.
- Default transport is `http2`, which is safer on networks where QUIC/UDP is blocked.

## Installation

### 1. Prerequisite
Install `cloudflared` first:
- [Download & Install cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/setup/)

### 2. Install the CLI globally
```bash
npm install -g hport-tunnel
```

After that, you can run `hport` directly from any terminal:

```bash
hport 8101 -s mcp-thinkbook --bg
```

You do not need to run `npm install -g` again every time you open a terminal.

You only need to reinstall globally when one of these is true:
- A newer npm package version was published and you want that new version.
- You uninstalled Node.js or the global npm package.
- You are moving to another machine.

To update to the newest published package:

```bash
npm install -g hport-tunnel@latest
```

If you are working from this repo before publishing, run the local CLI with:

```bash
node .\bin.js 8101 -s mcp-thinkbook --bg
```

## Usage

If you deploy your own Worker, point the CLI to it:
```bash
# PowerShell
$env:HPORT_BACKEND_URL="https://your-worker.example.workers.dev"

# bash/zsh
export HPORT_BACKEND_URL=https://your-worker.example.workers.dev
```

Expose local port `8080`:
```bash
hport 8080
```

Expose with a fixed subdomain:
```bash
hport 3000 -s my-app
```

Replace an existing H-PORT-managed subdomain without interactive confirmation:
```bash
hport 9993 -s abc -y
```

Expose a specific host and port:
```bash
hport 192.168.1.10:5000
```

Publish MCP on port `8101` in background mode:
```bash
hport 8101 -s mcp-thinkbook --bg
```

By default, the CLI starts `cloudflared` with `--protocol http2`. This avoids failures on networks where QUIC over UDP is blocked. If you really need a different transport:

```bash
# PowerShell
$env:HPORT_CLOUDFLARED_PROTOCOL="quic"
```

## Expected Result

When the tunnel is healthy, the public URL should answer exactly like the local origin.

Example:
- Local `http://127.0.0.1:8101/mcp` returns `401 Missing Authorization header`
- Public `https://mcp-thinkbook.hcu-lab.me/mcp` should return the same `401`

That means the publish path is working and the remaining behavior is from your app, not from H-PORT.

## Worker Setup

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

## Operations

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

## Release Notes

- `1.1.1`
- Default `cloudflared` transport changed to `http2` for better compatibility on networks where QUIC fails.
- README now documents when `npm install -g` is required and when it is not.

## License
ISC
