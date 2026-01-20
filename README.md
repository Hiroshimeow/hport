# 🚀 H-PORT Tunnel

**H-PORT** is a lightweight tunneling tool that securely exposes your localhost to the internet via `hcu-lab.me`. It uses Cloudflare's edge network to provide instant, secure public URLs for your local development.

## ✨ Features
- 🛡️ **Secure**: Built-in protection against token leakage in logs.
- 🔗 **Instant URL**: Get a `*.hcu-lab.me` address in seconds.
- 🧹 **Auto-Cleanup**: Automatically releases DNS records when you stop the tool.
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

Expose your local port 8080:
```bash
hport 8080
```

Expose with a custom subdomain:
```bash
hport 3000 -s my-app
```

Expose a specific local IP and port:
```bash
hport 192.168.1.10:5000
```

## ⚠️ Security Notice
If you are using version `1.0.0`, please update to `1.0.1` immediately to ensure your connection tokens are not leaked in terminal error logs.

## 📄 License
ISC
