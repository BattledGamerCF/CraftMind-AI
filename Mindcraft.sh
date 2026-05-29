#!/usr/bin/env bash
# Mindcraft — Linux launcher
# Double-click or run: bash Mindcraft.sh

set -euo pipefail
cd "$(dirname "$0")"

# Check Node is installed
if ! command -v node &>/dev/null; then
  echo ""
  echo "  ✗ Node.js is not installed."
  echo ""
  echo "  Install it from https://nodejs.org (choose the LTS version)"
  echo "  Then run this script again."
  echo ""
  read -rp "Press Enter to exit…"
  exit 1
fi

node launcher.mjs "$@"
