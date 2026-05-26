# Mindcraft AI Companion Backend

A Minecraft AI companion backend with a dual-brain architecture — a fast deterministic "gameplay brain" and a slow LLM "planning brain." Bots behave like believable synthetic players: they fight back, follow players, mine resources, build structures, eat food, and have natural conversations driven by a configurable LLM.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000 in dev, 8080 in Replit)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `DATABASE_URL` — Postgres connection string (optional for bot-only use)
- Optional env: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (bots can also use Ollama locally)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Bot: mineflayer + mineflayer-pathfinder
- LLM: OpenAI, Anthropic, Ollama (configurable per-bot)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/bot/` — all bot logic
  - `MinecraftBot.ts` — lifecycle, connect/disconnect, event handler
  - `BotManager.ts` — singleton manager for multiple bot instances
  - `FastBrain.ts` — deterministic state machine (idle/following/mining/building/combat/fleeing/exploring)
  - `SlowBrain.ts` — LLM planning layer; processes player chat and returns structured intents
  - `systems/` — gameplay systems (movement, combat, mining, building, hunger, social, humanization, inventory)
  - `structures/` — procedural building templates (OakCabin, SimpleShelter)
  - `llm/` — LLM provider adapters (Ollama, OpenAI, Anthropic)
- `artifacts/api-server/src/routes/bots.ts` — REST API for bot control
- `lib/api-spec/openapi.yaml` — API contract source of truth

## REST API

All routes under `/api`:

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/bots` | List all active bots |
| `POST` | `/api/bots` | Create & connect a bot |
| `GET` | `/api/bots/:id` | Get bot status |
| `DELETE` | `/api/bots/:id` | Disconnect & remove bot |
| `POST` | `/api/bots/:id/command` | Send a command to a bot |
| `GET` | `/api/bots/:id/inventory` | Get bot inventory |
| `GET` | `/api/bots/:id/chat` | Get bot's chat history |
| `GET` | `/api/structures` | List available building templates |

### Create bot example

```json
POST /api/bots
{
  "host": "localhost",
  "port": 25565,
  "username": "MinderBot",
  "auth": "offline",
  "llm": {
    "provider": "ollama",
    "model": "llama3.2",
    "baseUrl": "http://localhost:11434"
  },
  "behavior": {
    "humanize": true,
    "autoEat": true,
    "defendSelf": true,
    "chatCooldown": 3000
  }
}
```

### Command examples

```json
POST /api/bots/:id/command
{ "command": "follow", "args": { "player": "Steve" } }
{ "command": "mine",   "args": { "resource": "wood" } }
{ "command": "build",  "args": { "structure": "oak_cabin" } }
{ "command": "stop" }
{ "command": "say",    "args": { "message": "Hello!" } }
```

## Architecture decisions

- **Dual-brain design**: FastBrain runs a state machine 24/7 using deterministic code. SlowBrain is called only on player chat events — not in a loop — keeping inference cost low.
- **LLM returns structured intents**: The LLM outputs `{ intent, target, chat, params }` JSON, not free-form commands. This eliminates command parsing failures.
- **Humanization is a separate system**: Random camera drift, imprecise aim, idle behavior, and variable delays are handled by HumanizationSystem, decoupled from gameplay logic.
- **mineflayer/pathfinder are externalized from esbuild**: These packages have native deps and dynamic requires that can't be bundled. They load from node_modules at runtime.
- **Multi-provider LLM**: Each bot independently configures its LLM provider (Ollama/OpenAI/Anthropic). API keys come from env vars or per-bot config.

## In-game usage

Once a bot is connected and in your Minecraft world, address it by username prefix or `!`:
- `MinderBot follow me` → bot follows you
- `MinderBot mine some wood` → bot gathers wood
- `! build a shelter` → bot builds a simple shelter
- `MinderBot stop` → bot stops current task

## Product

A Minecraft AI companion system — bots connect to any Java Edition server, respond to player chat via an LLM, and autonomously perform survival tasks (mining, building, combat defense, exploring). Designed for local consumer hardware with small models (5–7B parameters via Ollama) or cloud models (OpenAI/Anthropic).

## User preferences

- Supports all three LLM providers: Ollama (local), OpenAI, Anthropic
- Bot backend first — web dashboard is a future task

## Gotchas

- Mineflayer and pathfinder are marked external in esbuild — they must exist in node_modules
- Bot connection is async — `POST /api/bots` will wait up to 30s for the bot to spawn
- The bot only responds in chat when its username is mentioned or message starts with `!` or `.`
- Always run `pnpm run typecheck` before verifying builds — the build script doesn't type-check

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
