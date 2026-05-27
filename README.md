# Mindcraft AI Companion

A Minecraft AI companion backend. Bots connect to any Java Edition server, respond to player chat via a configurable LLM, and autonomously perform survival tasks — mining, building, combat defense, exploring.

Built for local hardware with small models (Ollama/llama3.2) or cloud (OpenAI, Anthropic).

## Quickstart

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- A running Minecraft Java Edition server (any version mineflayer supports)
- One of: Ollama (local), OpenAI API key, or Anthropic API key

### 1. Install

```bash
git clone <repo>
cd mindcraft
pnpm install
```

### 2. Configure

Copy the example env file and edit it:

```bash
cp .env.example .env
```

Minimum required — everything else has defaults:

```env
PORT=8080
```

### 3. Start

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
| `OPENAI_API_KEY` | — | Enables OpenAI provider (optional) |
| `ANTHROPIC_API_KEY` | — | Enables Anthropic provider (optional) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `LLM_TIMEOUT_MS` | `30000` | LLM request timeout in milliseconds |
| `MINDCRAFT_DATA_DIR` | `~/.mindcraft` | Persistence directory for bot state |
| `MINDCRAFT_MAX_BOTS` | `10` | Maximum concurrent bots |
| `MINDCRAFT_PERSISTENCE` | `true` | Set to `false` to disable disk persistence |

---

## LLM Provider Setup

### Ollama (local, recommended for development)

```bash
# Install Ollama: https://ollama.com
ollama pull llama3.2
ollama serve
```

Bot config:
```json
{
  "llm": {
    "provider": "ollama",
    "model": "llama3.2",
    "baseUrl": "http://localhost:11434"
  }
}
```

### OpenAI

```env
OPENAI_API_KEY=sk-...
```

Bot config:
```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini"
  }
}
```

### Anthropic

```env
ANTHROPIC_API_KEY=sk-ant-...
```

Bot config:
```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-3-haiku-20240307"
  }
}
```

---

## API Reference

Base URL: `http://localhost:8080/api`

### Create a bot

```http
POST /api/bots
Content-Type: application/json

{
  "host": "localhost",
  "port": 25565,
  "username": "MinderBot",
  "auth": "offline",
  "llm": {
    "provider": "ollama",
    "model": "llama3.2"
  },
  "behavior": {
    "humanize": true,
    "autoEat": true,
    "defendSelf": true,
    "chatCooldown": 3000
  }
}
```

### List bots

```http
GET /api/bots
```

### Get bot status

```http
GET /api/bots/:id
```

### Send a command

```http
POST /api/bots/:id/command
Content-Type: application/json

{ "command": "follow", "args": { "player": "Steve" } }
{ "command": "mine",   "args": { "resource": "wood" } }
{ "command": "build",  "args": { "structure": "oak_cabin" } }
{ "command": "stop" }
{ "command": "say",    "args": { "message": "Hello!" } }
```

### Get inventory / chat history

```http
GET /api/bots/:id/inventory
GET /api/bots/:id/chat
```

### Get / update playstyle

```http
GET  /api/bots/:id/playstyle
PATCH /api/bots/:id/playstyle
Content-Type: application/json

{ "profile": "companion" }
```

Profiles: `companion`, `worker`, `adventurer`, `safe`, `auto`

### Disconnect a bot

```http
DELETE /api/bots/:id
```

### List building templates

```http
GET /api/structures
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

---

## Architecture

```
Player chat
    ↓
SlowBrain (LLM)     ← called only on player chat, not in a loop
    ↓
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
- Humanization, zone awareness, and habit formation run as background systems

---

## Troubleshooting

**Bot connects but doesn't respond to chat**
- Make sure Ollama is running: `ollama serve`
- Check the model is downloaded: `ollama pull llama3.2`
- Address the bot by username prefix: `MinderBot hello`

**`Error: OpenAI provider requires an API key`**
- Set `OPENAI_API_KEY` in your environment or pass `apiKey` in the bot config

**Bot connects then immediately disconnects**
- The Minecraft server may require online-mode auth. Use `"auth": "microsoft"` and ensure you have a valid account configured

**`PORT environment variable is required`**
- Start the server with `PORT=8080 pnpm --filter @workspace/api-server run dev`

**Persistence not saving**
- Check write permissions on `~/.mindcraft/bots/`
- Set `MINDCRAFT_DATA_DIR` to a writable path, or set `MINDCRAFT_PERSISTENCE=false` to disable

---

## Development

```bash
pnpm run typecheck        # full typecheck across all packages
pnpm run build            # typecheck + build
pnpm --filter @workspace/api-server run dev   # run dev server
```
