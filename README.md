# Mindcraft AI Companion

A Minecraft AI companion backend. Bots connect to any Java Edition server, respond to player chat via a configurable LLM, and autonomously perform survival tasks — mining, building, combat defense, exploring.

Built for local hardware with small models (Ollama/llama3.2) or cloud (OpenAI, Anthropic).

---

## First Run

Minimum steps to get a working bot:

```bash
# 1. Install
git clone <repo> && cd mindcraft
pnpm install

# 2. Start Ollama (local model, no API key needed)
ollama pull llama3.2
ollama serve

# 3. Start the server
PORT=8080 pnpm --filter @workspace/api-server run dev

# 4. Connect a bot
curl -X POST http://localhost:8080/api/bots \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 25565,
    "username": "MindBot",
    "auth": "offline",
    "llm": { "provider": "ollama", "model": "llama3.2" }
  }'
```

The bot connects, joins your world, and responds to chat within seconds. LLM is optional — the bot handles `follow`, `stop`, `mine`, and `build` commands even when Ollama is offline (keyword fallback).

---

## Preset Profiles

Four ready-to-use behavioral profiles. Import and spread into your bot config:

```typescript
import { presets } from "./src/bot/presets.js";

const body = {
  ...presets.minimal_companion,
  host: "localhost",
  port: 25565,
  username: "MindBot",
};
```

| Preset | Playstyle | Autonomy | Combat | Use case |
|---|---|---|---|---|
| `minimal_companion` | companion | low | no | Safe co-op companion, follows player |
| `stable_worker` | worker | medium | yes | Mining/building server assistant |
| `safe_observer` | safe | low | no | Non-combat server monitor or tour guide |
| `explorer_light` | adventurer | medium | yes | Exploration and resource gathering |

Or pass the preset fields directly in the REST body:

```json
POST /api/bots
{
  "host": "localhost",
  "port": 25565,
  "username": "MindBot",
  "auth": "offline",
  "llm": { "provider": "ollama", "model": "llama3.2" },
  "behavior": { "humanize": true, "autoEat": true, "defendSelf": false, "chatCooldown": 3000 },
  "cognitiveMode": "lightweight",
  "playstyle": "companion"
}
```

---

## Quickstart (full)

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- A running Minecraft Java Edition server
- One of: Ollama (local), OpenAI API key, or Anthropic API key

### Install

```bash
git clone <repo>
cd mindcraft
pnpm install
```

### Configure

Minimum required — everything else has defaults:

```env
PORT=8080
```

### Start

```bash
# Linux / macOS — one-liner launch (loads .env automatically)
./start-dev

# Windows
start-dev.bat

# Or directly with pnpm
pnpm --filter @workspace/api-server run dev
```

The server starts on port 8080. Persistence data is saved to `~/.mindcraft/bots/` automatically.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | *(required)* | HTTP port for the API server |
| `NODE_ENV` | `development` | Runtime environment |
| `LOG_LEVEL` | `info` | Pino log level (`trace`, `debug`, `info`, `warn`, `error`) |
| `OPENAI_API_KEY` | — | Enables OpenAI provider |
| `ANTHROPIC_API_KEY` | — | Enables Anthropic provider |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `LLM_TIMEOUT_MS` | `30000` | LLM request timeout (ms) |
| `LLM_MAX_CALLS_PER_MINUTE` | `20` | LLM calls per bot per minute ceiling |
| `MINDCRAFT_DATA_DIR` | `~/.mindcraft` | Persistence directory |
| `MINDCRAFT_MAX_BOTS` | `10` | Maximum concurrent bots |
| `MINDCRAFT_MAX_TASKS` | `10` | Maximum tasks per bot queue |
| `MINDCRAFT_PERSISTENCE` | `true` | Set `false` to disable disk persistence |
| `MINDCRAFT_DEBUG` | `false` | Set `true` for deterministic timers and verbose task logs |

---

## LLM Provider Setup

### Ollama (local, no API key)

```bash
# Install: https://ollama.com
ollama pull llama3.2
ollama serve
```

```json
{ "llm": { "provider": "ollama", "model": "llama3.2" } }
```

Recommended models by hardware:

| VRAM | Model |
|---|---|
| 4 GB | `phi3:mini` |
| 8 GB | `llama3.2` (default) |
| 16 GB+ | `llama3.1:8b`, `mistral` |

### OpenAI

```env
OPENAI_API_KEY=sk-...
```

```json
{ "llm": { "provider": "openai", "model": "gpt-4o-mini" } }
```

### Anthropic

```env
ANTHROPIC_API_KEY=sk-ant-...
```

```json
{ "llm": { "provider": "anthropic", "model": "claude-3-haiku-20240307" } }
```

---

## Debug Mode

Set `MINDCRAFT_DEBUG=true` for reproducible behavior:

```bash
MINDCRAFT_DEBUG=true PORT=8080 pnpm --filter @workspace/api-server run dev
```

What changes in debug mode:
- Humanization timers become fixed (no random variance)
- All ambient idle behaviors are suppressed
- Task transition decisions are logged verbosely

Use this to reproduce a specific bot decision sequence or bisect a behavior regression.

---

## API Reference

Base URL: `http://localhost:8080/api`

### Create a bot

```http
POST /api/bots
Content-Type: application/json
```

Body fields: `host` (required), `port`, `username` (required), `auth` (`offline`/`microsoft`), `llm` (required), `behavior`, `cognitiveMode`, `playstyle`.

### Core endpoints

```http
GET    /api/bots                      # list all bots
POST   /api/bots                      # create & connect
GET    /api/bots/:id                  # status
DELETE /api/bots/:id                  # disconnect

POST   /api/bots/:id/command          # send command
GET    /api/bots/:id/inventory        # inventory
GET    /api/bots/:id/chat             # chat history

GET    /api/bots/:id/runtime          # compact live snapshot (recommended)
GET    /api/bots/:id/tasks            # task queue
GET    /api/bots/:id/memory           # memory stores
GET    /api/bots/:id/telemetry        # task telemetry
GET    /api/bots/:id/perception       # perception snapshot
GET    /api/bots/:id/trust            # trust scores

GET    /api/bots/:id/playstyle        # playstyle profile
PATCH  /api/bots/:id/playstyle        # change profile
GET    /api/bots/:id/mode             # cognitive mode
PATCH  /api/bots/:id/mode             # change mode

GET    /api/structures                # available building templates
```

### Commands

```json
{ "command": "follow", "args": { "player": "Steve" } }
{ "command": "mine",   "args": { "resource": "wood" } }
{ "command": "build",  "args": { "structure": "oak_cabin" } }
{ "command": "stop" }
{ "command": "say",    "args": { "message": "Hello!" } }
```

### /runtime response shape

```json
{
  "task": { "current": { "type": "follow_player", ... }, "queueLength": 0 },
  "zone": "wilderness",
  "operationalState": "relaxed",
  "cognitiveMode": "balanced",
  "playstyle": { "profile": "companion" },
  "riskScore": 0.12,
  "alertness": 0.31,
  "memory": {
    "goal": "follow Steve",
    "threatCount": 0,
    "episodicEventCount": 4,
    "recentEvents": [{ "kind": "combat", "description": "...", "minsAgo": 3 }],
    "waypointCount": 2
  },
  "telemetry": { "totalTasks": 12, "successRate": 0.92, ... }
}
```

---

## In-Game Commands

Once a bot is connected, talk to it in chat:

```
MinderBot follow me
MinderBot mine some wood
MinderBot build a shelter
MinderBot stop
! build a cabin         ← ! prefix addresses any bot
. what are you doing    ← . prefix also works
```

Commands work even when the LLM is offline — `follow`, `stop`, `mine`, and `build` are matched by keyword as a fallback.

---

## Architecture

```
Player chat
    ↓
SlowBrain (LLM)     ← called only on player chat, not in a loop
    ↓ (keyword fallback if LLM unavailable)
CanonicalIntent      ← structured { intent, target, chat, params }
    ↓
FastBrain            ← deterministic state machine, runs 24/7
    ↓
Arbitrator           ← priority queue: CRITICAL > HIGH > NORMAL > LOW
    ↓
Planner → Executors  ← movement, mining, building, combat, idle…
```

**Key properties:**
- LLM is called only on player chat, never polled in a loop — inference cost is low
- All behavior is interruptible; CRITICAL tasks (combat, danger) preempt everything
- Keyword fallback keeps the bot responsive when the LLM is offline
- Task queue is capped (`MINDCRAFT_MAX_TASKS=10`) to prevent runaway queues

---

## Dashboard

A local web UI for creating and controlling bots without using curl.

### Start

```bash
# Terminal 1 — API server
./start-dev

# Terminal 2 — dashboard (Linux/macOS)
PORT=3001 BASE_PATH=/dashboard/ pnpm --filter @workspace/dashboard run dev

# Windows Terminal 2
set PORT=3001 && set BASE_PATH=/dashboard/ && pnpm --filter @workspace/dashboard run dev
```

Open **http://localhost:3001/dashboard/** in your browser.

### Features

- **Bot list** — see all connected bots with connection state (online, offline, connecting, failed), current task, and zone
- **New Bot form** — provider, model, cognitive mode, and playstyle dropdowns with descriptive labels
  - **Ollama** — auto-detects installed models from `localhost:11434` (or a custom URL)
  - **OpenAI / Anthropic** — secure API key field in the form; also works via server env var
  - **Minecraft Version** — auto-selects the latest tested version; supports any reachable server
- **Runtime panel** — current task, goal, state, risk score, queue length, alertness; telemetry is collapsible
- **Quick actions** — Follow, Stop, Mine Wood, Build Shelter, Return Home, Report Status, Reconnect, Disconnect
- **Auto-polling** — bot list refreshes every 3 s; runtime refreshes every 2 s; pauses when the tab is hidden

---

### Provider Setup

**Ollama (local, free, private)**

1. Start Ollama: `ollama serve`
2. Pull a model: `ollama pull llama3.2`
3. In the dashboard, the **Model** dropdown will auto-populate with installed models.

If Ollama runs on a different machine, enter the full URL in the **Ollama URL** field.

---

**OpenAI (cloud, billed)**

Set the key as an environment variable **before** starting the server:

```bash
export OPENAI_API_KEY=sk-...
./start-dev
```

Or paste it directly into the **API Key** field in the dashboard — it will be sent securely in the create request.

---

**Anthropic (cloud, billed)**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
./start-dev
```

Or use the **API Key** field in the dashboard.

---

### Connecting to External Servers

The dashboard can connect to any reachable Minecraft server: LAN, VPS, or public host.

Enter the server's IP or hostname in the **Host** field. Use **Microsoft** auth mode for online-mode servers.

---

### Troubleshooting

**Dashboard shows "API offline"**

The API server isn't running. Start it:

```bash
./start-dev
```

Wait a few seconds, then the dashboard will reconnect automatically.

---

**Bot won't connect / "couldn't connect to Minecraft server"**

- Confirm the server is running and reachable from the machine running the API server.
- Check the **Host** and **Port** (default: `25565`).
- For online-mode servers, use **Auth Mode → Microsoft** with a valid Microsoft account.

---

**"Unsupported Minecraft version"**

1. Select the exact server version from the **Minecraft Version** dropdown.
2. Or select **Auto-detect** — mineflayer will read the version from the server handshake.
3. Untested versions (e.g. 1.21.x) may still work on Auto-detect.

---

**Ollama model list doesn't load / "Cannot reach Ollama"**

- Ollama is not running: `ollama serve`
- If Ollama is on a different machine, set the correct **Ollama URL**.
- The dashboard contacts Ollama through the API server, so both must be on the same machine (or Ollama must be reachable from the API server).

---

**"Reconnect isn't supported yet"**

Full hot-reconnect is not implemented. To reconnect a disconnected bot:

1. Click **Disconnect** to remove it.
2. Click **+ New Bot** and fill in the same settings.

---

## Minecraft Version Support

Tested against mineflayer's supported range. Versions confirmed working:

| Version | Status |
|---|---|
| 1.20.4 | ✓ Tested (recommended) |
| 1.20.1 | ✓ Tested |
| 1.19.4 | ✓ Tested |
| 1.18.2 | ✓ Tested |
| 1.16.5 | ✓ Tested |
| 1.21.x | Not tested — may work |
| Bedrock | Not supported (mineflayer limitation) |

Pass the version explicitly when connecting:

```json
{ "version": "1.20.4" }
```

Leave the `version` field blank to let mineflayer auto-detect from the server handshake. Auto-detect works on most vanilla servers.

---

## Local Minecraft Testing

A minimal end-to-end test from a clean clone.

### 1 — Start a Minecraft server

Use the official server JAR or a Docker image. Offline mode is easiest for local testing (no account needed):

```bash
# PaperMC example — download from https://papermc.io/downloads
java -Xmx2G -jar paper.jar --nogui

# docker-compose alternative (itzg image)
docker run -it -e EULA=TRUE -e ONLINE_MODE=FALSE \
  -p 25565:25565 itzg/minecraft-server
```

The server is ready when you see `Done (X.Xs)! For help, type "help"`.

### 2 — Start the Mindcraft runtime

```bash
# First time: copy env file and set your port
cp .env.example .env

# Launch
./start-dev       # Linux/macOS
start-dev.bat     # Windows
```

Expected output:

```
[Mindcraft] API listening on port 8080
[Mindcraft] Persistence: /home/you/.mindcraft/bots
```

### 3 — Connect a bot

```bash
# Using the included helper script
./spawn-bot.sh

# Or raw curl
curl -X POST http://localhost:8080/api/bots \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 25565,
    "username": "MindBot",
    "auth": "offline",
    "llm": { "provider": "ollama", "model": "llama3.2" }
  }'
```

### 4 — Expected first-run behaviour

| Time | What happens |
|---|---|
| 0–2 s | Bot appears in the Minecraft world |
| 2–5 s | Bot logs `connected` and enters idle state |
| First chat | Bot responds in-game; LLM is called once |
| LLM offline | Keyword fallback handles `follow`, `stop`, `mine`, `build` |

**Check bot status at any time:**

```bash
curl -s http://localhost:8080/api/bots | jq '.[].id'
curl -s http://localhost:8080/api/bots/<id>/runtime | jq '.task,.zone'
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Bot connects but doesn't respond to chat | Ollama not running | `ollama serve && ollama pull llama3.2` |
| Bot only handles follow/stop/mine | LLM offline, keyword fallback active | Start Ollama or set an API key |
| `Error: OpenAI provider requires an API key` | Missing env var | Set `OPENAI_API_KEY` |
| `PORT environment variable is required` | Server started without PORT | `PORT=8080 pnpm ... run dev` |
| Bot disconnects immediately | Online-mode server | Use `"auth": "microsoft"` with a valid account |
| Persistence not saving | Write permissions | Check `~/.mindcraft/bots/` or set `MINDCRAFT_DATA_DIR` |
| Bot ignores commands in chat | Wrong prefix format | Use `BotName <command>` or prefix with `!` or `.` |
| Log spam during LLM outage | Expected behavior | Warn appears at most once per 60s; normal after recovery |
| Want to reproduce a bug | Random timing variance | Set `MINDCRAFT_DEBUG=true` |
| Bot task queue never clears | Queue full | Reduce `MINDCRAFT_MAX_TASKS` or send `stop` command |

---

## Performance Tuning

| Goal | Setting |
|---|---|
| Reduce LLM API costs | Lower `LLM_MAX_CALLS_PER_MINUTE` (default: 20) |
| Limit task complexity | Lower `MINDCRAFT_MAX_TASKS` (default: 10) |
| Disable humanization noise | Set `MINDCRAFT_DEBUG=true` or `humanize: false` |
| Faster LLM responses | Use a smaller model (`phi3:mini`) or `cognitiveMode: "lightweight"` |
| Run many bots | Raise `MINDCRAFT_MAX_BOTS`, ensure adequate RAM and model VRAM |

---

## Known Limitations

**Minecraft compatibility**
- Java Edition only. Bedrock Edition is not supported (mineflayer limitation).
- Tested against vanilla servers. Modded servers may have pathfinding or inventory edge cases.
- Server must allow offline-mode auth, or the bot must use `"auth": "microsoft"` with a valid account.

**Bot behavior**
- Combat is melee-only. No ranged weapons, no bow usage.
- Building is limited to built-in templates (`oak_cabin`, `simple_shelter`). Custom structures require code additions.
- Pathfinding may stall in complex terrain (deep ravines, large water bodies). The bot retries automatically but may time out and return to idle.
- The bot does not persist inventory knowledge across restarts.

**LLM / language**
- LLM output must produce valid JSON intent objects. Models smaller than ~3B parameters often produce malformed JSON; `llama3.2` (3B) is the tested minimum.
- Keyword fallback covers only four commands (`follow`, `stop`, `mine`, `build`). Other commands are silently ignored when the LLM is offline.
- The bot only responds when directly addressed (`BotName ...`, `! ...`, or `. ...`). Global chat is ignored.

**Scaling**
- Default cap is 10 concurrent bots per server process. Raising `MINDCRAFT_MAX_BOTS` works but increases RAM usage roughly linearly.
- Each Ollama-backed bot shares the same model inference — concurrent bots will queue LLM requests.
- No multi-server routing. Each bot connects to one server for its lifetime.

**Persistence**
- Local disk only (`~/.mindcraft/bots/`). No cloud sync or database backend.
- Habit and episodic memory are lost if the data directory is deleted.

**API**
- No authentication on the REST API. Do not expose port 8080 to untrusted networks without a reverse proxy and auth layer.
- No WebSocket or event streaming. Callers must poll `/runtime` or `/chat` for state changes.

---

## Development

```bash
pnpm run typecheck        # full typecheck across all packages
pnpm run build            # typecheck + build all packages

# Dev server (picks up changes after rebuild)
pnpm --filter @workspace/api-server run dev

# Production build only (outputs to artifacts/api-server/dist/)
pnpm --filter @workspace/api-server run build

# Run from built output
node --enable-source-maps artifacts/api-server/dist/index.mjs
```

Or use the convenience scripts:

```bash
./start-dev     # dev mode — rebuilds then starts
./start-prod    # production mode — builds then starts from dist/
./spawn-bot.sh  # spawn a test bot against a local server
```
