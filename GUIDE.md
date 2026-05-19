# H-PORT Management Guide

## 1. Server

`hport` uses a Cloudflare Worker as the control plane.

Main config in `server/wrangler.toml`:
- `CF_ACCOUNT_ID`
- `CF_ZONE_ID`
- `PUBLIC_BASE_DOMAIN`
- `PROTECTED_SUBDOMAINS`

Secret required:
```bash
npx wrangler secret put CF_API_TOKEN
```

Deploy Worker:
```bash
cd server
npm install
npm run deploy
```

## 2. Client

Build CLI bundle:
```bash
npm run build
```

Install globally:
```bash
npm install -g hport-tunnel
```

Or relink locally while developing:
```bash
npm link
```

## 3. Runtime Model

Create flow:
1. CLI calls `POST /create-tunnel`
2. Worker validates subdomain and ownership rules
3. Worker creates managed tunnel + managed DNS
4. CLI starts `cloudflared tunnel run`

Foreground mode:
- `hport 8101 -s mcp`
- `Ctrl+C` triggers session cleanup through `DELETE /cleanup`

Background mode:
- `hport 8101 -s mcp --bg`
- Starts `cloudflared` detached and returns shell immediately
- Detached mode does not auto-clean on terminal close

## 4. Cleanup Model

Manual endpoints:
- `GET /audit`
- `POST /cleanup-preview`
- `POST /cleanup-confirm`

Scheduled behavior:
- Worker runs every 2 days
- Managed orphan or inactive resources older than 1 day are auto-deleted
- Unmanaged resources are never auto-deleted
- Protected subdomains are never auto-deleted

## 5. Notes

- `PROTECTED_SUBDOMAINS` should include all critical names on your domain.
- Recommended examples: `api,api2,mcp,www,admin,auth,mail,smtp,imap,pop,ftp,ssh`
- Do not commit `CF_API_TOKEN`.
