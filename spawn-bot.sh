#!/usr/bin/env bash
# spawn-bot.sh — quick helper to connect a bot to a local Minecraft server.
# Usage: ./spawn-bot.sh [host] [port] [username] [mc-port]
#
# Examples:
#   ./spawn-bot.sh                          # all defaults
#   ./spawn-bot.sh localhost 8080 Steve     # custom API port + username
#   ./spawn-bot.sh localhost 8080 Steve 25566   # bot connects to non-default MC port

API_HOST="${1:-localhost}"
API_PORT="${PORT:-${2:-8080}}"
BOT_NAME="${3:-MindBot}"
MC_PORT="${4:-25565}"

BASE_URL="http://${API_HOST}:${API_PORT}/api"

echo "Spawning bot '${BOT_NAME}' → Minecraft ${API_HOST}:${MC_PORT} via API ${BASE_URL}"
echo ""

curl -sS -X POST "${BASE_URL}/bots" \
  -H "Content-Type: application/json" \
  -d "{
    \"host\": \"${API_HOST}\",
    \"port\": ${MC_PORT},
    \"username\": \"${BOT_NAME}\",
    \"auth\": \"offline\",
    \"llm\": { \"provider\": \"ollama\", \"model\": \"llama3.2\" },
    \"behavior\": {
      \"humanize\": true,
      \"autoEat\": true,
      \"defendSelf\": false,
      \"chatCooldown\": 3000
    },
    \"cognitiveMode\": \"balanced\",
    \"playstyle\": \"companion\"
  }" | (command -v jq &>/dev/null && jq '.' || cat)

echo ""
echo "Bot spawned. Check status with:"
echo "  curl -s ${BASE_URL}/bots | jq '.'"
