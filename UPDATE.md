# 🛠 H-PORT Maintenance & Update Guide

This guide is for the developer to maintain and update the H-PORT project.

## 1. Update CLI Client
Every time you modify the source code (e.g., `index.js`):

1. **Run regression tests**:
   ```bash
   npm test
   ```
2. **Increment version**:
   - For small fixes: `npm version patch`
   - For new features: `npm version minor`
   
3. **Push to GitHub & NPM**:
   ```bash
   git add .
   git commit -m "Update features"
   git push
   npm publish
   ```

The package `prepare` lifecycle builds `dist/` automatically for source installs and publishing; a separate manual build is not required for packaging.

## 2. Update Server (Cloudflare Worker)
Every time you modify the code in `server/index.js`:

1. Navigate to server directory: `cd server`
2. Deploy to Cloudflare: `npx wrangler deploy`

---

## 💡 One-Line Fast Update (CLI):
`npm test && npm version patch && git add . && git commit -m "Update" && git push && npm publish`

## 🔄 For Users to Upgrade:
Tell your users to run:
`npm install -g hport-tunnel@latest`
