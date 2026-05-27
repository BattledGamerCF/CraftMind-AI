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

## Development

```bash
pnpm run typecheck        # full typecheck across all packages
pnpm run build            # typecheck + build
pnpm --filter @workspace/api-server run dev   # run dev server
```
