# 🚀 H-PORT Tunnel

**H-PORT** is a powerful, lightweight localhost tunneling tool that creates secure HTTP/HTTPS connections from your local machine to the public internet using a custom domain (`hcu-lab.me`). 

Perfect for sharing local development, testing webhooks, or mobile debugging without the hassle of server configuration.

---

## ✨ Features
- 🛡️ **Secure Connections**: Automatic HTTPS via Cloudflare Edge.
- 🔗 **Custom Subdomains**: Choose your own subdomain or get a random one.
- 🧹 **Auto-Cleanup**: Automatically releases DNS records and tunnels on exit.
- 🚀 **Zero Config**: No complex setup required on the client side.
- 📦 **Standalone Binary**: Packaged for high performance and portability.

## 💻 Installation

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) installed on your system.

### Install via NPM
```bash
npm install -g hport-tunnel
```

## 🚀 Quick Start

Expose your local port 8080:
```bash
hport 8080
```

Expose with a custom subdomain:
```bash
hport 3000 -s myapp
```

Expose a specific local IP:
```bash
hport 192.168.1.10:5000
```

## 🛠️ Project Structure
- `/dist`: Optimized standalone build.
- `/server`: Backend logic running on Cloudflare Workers.
- `hport.sh / hport.bat`: Convenient interactive launchers for Linux and Windows.

## 📄 License
This project is licensed under the **H-PORT Personal Use License**. 
- ✅ Free for personal and educational use.
- ❌ **NOT** allowed for commercial use or resale.

---
Created with ❤️ by H-Lab | Powered by Cloudflare
