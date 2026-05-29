#!/usr/bin/env bash
# Mindcraft — macOS double-click launcher
# This file can be double-clicked in Finder to start Mindcraft.

set -euo pipefail
cd "$(dirname "$0")"

# Check Node is installed
if ! command -v node &>/dev/null; then
  osascript -e 'display alert "Node.js is not installed" message "Download and install Node.js from https://nodejs.org (choose the LTS version), then try again." buttons {"OK"} default button "OK" as critical'
  exit 1
fi

node launcher.mjs "$@"
