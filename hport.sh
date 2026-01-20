#!/bin/bash
# ==============================================================================
# HPORT INTERACTIVE LAUNCHER (Linux/Ubuntu)
# ==============================================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HPORT_EXEC="$DIR/dist/index.js"

green() { echo -e "\033[32m$1\033[0m"; }
red() { echo -e "\033[31m$1\033[0m"; }
yellow() { echo -e "\033[33m$1\033[0m"; }
bold() { echo -e "\033[1m$1\033[0m"; }

# Handle Ctrl+C gracefully
trap "echo -e '\n\n🛑 Script stopped.'; exit 0" SIGINT

clear
echo "╭────────────────────────────────────────────────────────╮"
echo "│         H - P O R T   L A U N C H E R  🚀              │"
echo "╰────────────────────────────────────────────────────────╯"
echo ""

# 1. Input Target (IP and Port)
bold "👉 Enter Target (Format: IP:PORT or PORT)"
echo "   - Example: 192.168.1.10:8080"
echo "   - Example: 53217 (Default: 127.0.0.1:53217)"
echo "   - Press Enter for default: 127.0.0.1:8080"
read -p "🎯 Target: " INPUT_RAW

TARGET="127.0.0.1:8080"
if [ ! -z "$INPUT_RAW" ]; then
    TARGET="$INPUT_RAW"
fi

# 2. Input Subdomain
echo ""
bold "👉 Enter Subdomain (Press Enter for random)"
read -p "📝 Subdomain: " INPUT_SUBDOMAIN

# 3. Execute
echo ""
if [ ! -z "$INPUT_SUBDOMAIN" ]; then
    node "$HPORT_EXEC" "$TARGET" -s "$INPUT_SUBDOMAIN"
else
    node "$HPORT_EXEC" "$TARGET"
fi
