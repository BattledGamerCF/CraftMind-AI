# Mindcraft Security Audit Report

**Date:** 2026-05-31  
**Scope:** Self-hosted Mindcraft deployment (API server + dashboard)  
**Method:** Manual source review of all HTTP endpoints, file operations, logging, and dependencies  
**Assumption:** Normal self-hosted use — user runs on their own machine, no public exposure intended

---

## Attack Surface Inventory (Phase 1)

### HTTP Endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/bots` | Lists all bot statuses |
| POST | `/api/bots` | Creates a bot; accepts host, username, LLM config, behavior |
| GET | `/api/bots/:id` | Single bot status |
| DELETE | `/api/bots/:id` | Removes a bot |
| POST | `/api/bots/:id/command` | Sends a command to a bot |
| GET | `/api/bots/:id/inventory` | Bot inventory |
| GET | `/api/bots/:id/chat` | Chat history |
| GET | `/api/bots/:id/tasks` | Task queue |
| POST | `/api/bots/:id/tasks/cancel-all` | Cancels all bot tasks |
| GET | `/api/bots/:id/perception` | World perception snapshot |
| GET | `/api/bots/:id/memory` | Bot memory snapshot |
| GET | `/api/bots/:id/telemetry` | Failure telemetry; accepts `?windowMs` |
| GET | `/api/bots/:id/cognition` | Cognitive mode and stats |
| GET | `/api/bots/:id/mode` | Current cognitive mode |
| PATCH | `/api/bots/:id/mode` | Changes cognitive mode |
| GET | `/api/bots/:id/trust` | Trust model snapshot |
| GET | `/api/bots/:id/playstyle` | Playstyle snapshot |
| PATCH | `/api/bots/:id/playstyle` | Changes playstyle |
| GET | `/api/bots/:id/runtime` | Compact combined state snapshot |
| POST | `/api/bots/:id/reconnect` | Returns 501 (not implemented) |
| GET | `/api/swarm` | All bots in shared world model |
| GET | `/api/structures` | Available structure templates |
| GET | `/api/meta` | Server metadata (versions, providers) |
| GET | `/api/ollama/models` | Proxies Ollama model list; accepts `?baseUrl` |
| GET | `/api/logs` | In-memory log ring buffer; accepts `?level`, `?search`, `?limit` |
| GET | `/api/healthz` | Health check |

### File Read/Write Locations

| Location | Operation | Who Controls Path |
|----------|-----------|-------------------|
| `~/.mindcraft/bots/<key>.json` | Read + Write | Bot username + host + port (sanitized) |
| `SERVE_STATIC_DIR` (production only) | Read (static files) | Operator env var |
| `.env` (launcher) | Read | Operator |

### Environment Variables

| Variable | Purpose | Sensitive? |
|----------|---------|-----------|
| `OPENAI_API_KEY` | OpenAI authentication | Yes |
| `ANTHROPIC_API_KEY` | Anthropic authentication | Yes |
| `OLLAMA_BASE_URL` | Ollama server address | No |
| `MINDCRAFT_MAX_BOTS` | Concurrent bot cap | No |
| `MINDCRAFT_MAX_TASKS` | Task queue cap | No |
| `LLM_MAX_CALLS_PER_MINUTE` | LLM rate cap | No |
| `LOG_LEVEL` | Logging verbosity | No |
| `MINDCRAFT_PERSISTENCE` | Enable/disable persistence | No |
| `MINDCRAFT_DATA_DIR` | Override data directory | No |
| `NODE_ENV` | Runtime mode | No |
| `PORT` / `API_PORT` / `DASH_PORT` | Bind ports | No |
| `SESSION_SECRET` | Express session (if used) | Yes |

### Launcher Entry Points

- `Mindcraft.sh` / `Mindcraft.bat` — shells `node launcher.mjs`
- `launcher.mjs` — reads `.env`, starts API server + Vite dashboard processes

### Dashboard API Calls

All via `fetch()` to `BASE_URL + "/api/..."`. All data rendered as text via React (no `dangerouslySetInnerHTML`).

---

## Findings and Fixes Applied

---

### HIGH

#### H1 — Bot Creation Cap Not Enforced
**File:** `artifacts/api-server/src/routes/bots.ts`  
**Impact:** `MINDCRAFT_MAX_BOTS` is read from the environment and stored in `config.bots.maxConcurrent`, but `POST /api/bots` never checked it before calling `botManager.createBot()`. Rapid requests could create unlimited bots, each opening a Minecraft connection, exhausting file descriptors and memory.  
**Fix applied:** Added cap check before `createBot()`; returns `429` with a clear message if the limit is reached.

---

### MEDIUM

#### M1 — No JSON Body Size Limit
**File:** `artifacts/api-server/src/app.ts`  
**Impact:** `express.json()` with no `limit` option accepts arbitrarily large request bodies. A large payload (e.g. a 50 MB `behavior` object) would be parsed entirely into memory before any validation runs.  
**Fix applied:** Added `{ limit: "100kb" }` to both `express.json()` and `express.urlencoded()`.

#### M2 — SSRF via Ollama `baseUrl` Query Parameter
**File:** `artifacts/api-server/src/routes/meta.ts`  
**Impact:** `GET /api/ollama/models?baseUrl=http://192.168.1.1/...` caused the API server process to `fetch()` any URL the browser supplied. Because this is a server-side request, it bypasses browser same-origin restrictions and can probe internal addresses the browser cannot reach (e.g. a router admin panel on the LAN).  
**Fix applied:** Added `isAllowedOllamaUrl()` validator that only permits `localhost`, `127.0.0.1`, and `::1`; other values return `400`.

#### M3 — Behavior Fields Not Validated or Clamped
**File:** `artifacts/api-server/src/routes/bots.ts`  
**Impact:** The `behavior` object from `POST /api/bots` was passed directly to `BotManager` without range checks. `chatCooldown: 0` removes the bot's chat throttle causing it to flood chat; `viewDistance: 999999` tells mineflayer to track a massive world region, exhausting memory. `port: 0` or `port: 99999` pass an out-of-range TCP port.  
**Fix applied:** Added `clampInt()` helper; clamped `chatCooldown` to [500–30000 ms], `viewDistance` to [4–64 chunks], `followDistance` to [1–20 blocks], and `port` to [1–65535]. Unknown behavior keys are ignored.

---

### LOW

#### L1 — `windowMs` Telemetry Parameter Unbounded
**File:** `artifacts/api-server/src/routes/bots.ts`  
**Impact:** `GET /api/bots/:id/telemetry?windowMs=` passed the raw `Number()` result to `summarizeFailures()` with no bounds. A negative value or `0` could produce undefined behavior in the failure aggregator.  
**Fix applied:** Clamped `windowMs` to [1 second, 24 hours].

#### L2 — Bot Role Not Validated Against Enum
**File:** `artifacts/api-server/src/routes/bots.ts`  
**Impact:** An arbitrary string `role` value was cast to `BotRole` without checking it was a valid role. Passing `"admin"` or `""` would store an invalid role in the shared world model's bot registry.  
**Fix applied:** Added `VALID_ROLES` set; unknown values default to `"generalist"`.

#### L3 — Logger Redaction Missing API Key Fields
**File:** `artifacts/api-server/src/lib/logger.ts`  
**Impact:** Pino's `redact` list only covered HTTP headers (`authorization`, `cookie`, `set-cookie`). A future `logger.info({ apiKey })` call or an LLM SDK error object that serialises its `apiKey` property would write the key to the in-memory ring buffer and expose it via `GET /api/logs`.  
**Fix applied:** Added `"*.apiKey"` and `"*.api_key"` to the pino `redact` paths.

#### L4 — Log Search String Uncapped
**File:** `artifacts/api-server/src/routes/logs.ts`  
**Impact:** `GET /api/logs?search=<very long string>` forced a case-insensitive substring match against up to 500 serialised log entries (each up to several KB via `JSON.stringify`). A megabyte-long search string would cause a burst of CPU work per request.  
**Fix applied:** Capped `?search=` input to 200 characters before the filter runs.

---

### Informational (No Fix Required)

#### I1 — CORS Wide Open
**File:** `artifacts/api-server/src/app.ts`  
`app.use(cors())` permits any origin. For a self-hosted tool with no authentication layer this is the correct default — the only clients that reach the API are the local dashboard and `localhost` tools. Locking CORS to a specific origin would break the development Vite proxy and production static serving without material security gain.

#### I2 — `GET /api/logs` Unauthenticated
The log endpoint requires no credential. On a single-user localhost deployment this is acceptable. If Mindcraft is ever exposed on a network interface other than loopback, logs should be protected. No fix applied; noted for future auth work.

#### I3 — `cookie-parser` Dependency Unused
**File:** `artifacts/api-server/package.json`  
`cookie-parser` is declared as a dependency but never referenced in source. Not a vulnerability, but dead weight. Not removed here because it may be intended for future session work.

#### I4 — API Keys Not Exposed via Any Endpoint
Verified: `GET /api/meta`, `GET /api/bots`, `GET /api/bots/:id`, and all runtime/cognition endpoints return only operational data. `config.llm.openaiApiKey` and `config.llm.anthropicApiKey` are read once at startup, stored in the config object, and never serialised to any response. `BotStatus` does not include `LLMConfig`.

#### I5 — Persistence Path Traversal Not Possible
**File:** `artifacts/api-server/src/bot/PersistenceManager.ts`  
The persistence key is sanitised with `replace(/[^a-zA-Z0-9@._-]/g, "_")` before `path.join()`. Because `/` and `\` are replaced with `_`, a crafted username like `../../etc/passwd` becomes `..___..___etc_passwd`, which resolves entirely within `~/.mindcraft/bots/`. No path traversal is possible.

---

## Summary

| Severity | Count | Fixed |
|----------|-------|-------|
| HIGH | 1 | 1 |
| MEDIUM | 3 | 3 |
| LOW | 4 | 4 |
| Informational | 5 | N/A |

All HIGH and MEDIUM issues fixed. All LOW issues fixed. No informational items require code changes.
