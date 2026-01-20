#!/bin/bash

# ==============================================================================
# HPORT INTERACTIVE LAUNCHER (Ubuntu)
# ==============================================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HPORT_EXEC="$DIR/dist/index.js"

green() { echo -e "\033[32m$1\033[0m"; }
red() { echo -e "\033[31m$1\033[0m"; }
yellow() { echo -e "\033[33m$1\033[0m"; }
bold() { echo -e "\033[1m$1\033[0m"; }

trap "echo -e '\n\n🛑 Đã dừng script.'; exit 0" SIGINT

clear
echo "╭────────────────────────────────────────────────────────╮"
echo "│         H - P O R T   L A U N C H E R  🚀              │"
echo "╰────────────────────────────────────────────────────────╯"
echo ""

# 1. Nhập IP và Port
bold "👉 Nhập mục tiêu (Format: IP:PORT hoặc PORT)"
echo "   - Ví dụ: 192.168.1.10:8080"
echo "   - Ví dụ: 53217 (Mặc định là 127.0.0.1:53217)"
echo "   - Enter để dùng mặc định: 127.0.0.1:8080"
read -p "🎯 Target: " INPUT_RAW

TARGET="127.0.0.1:8080"
if [ ! -z "$INPUT_RAW" ]; then
    TARGET="$INPUT_RAW"
fi

# 2. Nhập Subdomain
echo ""
bold "👉 Nhập Subdomain (Enter để tạo ngẫu nhiên)"
read -p "📝 Subdomain: " INPUT_SUBDOMAIN

# 3. Thực thi
echo ""
if [ ! -z "$INPUT_SUBDOMAIN" ]; then
    node "$HPORT_EXEC" "$TARGET" -s "$INPUT_SUBDOMAIN"
else
    node "$HPORT_EXEC" "$TARGET"
fi
