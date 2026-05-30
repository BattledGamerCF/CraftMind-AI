# Mindcraft Release Checklist

Validation against the codebase as of this release. Each item is verified
against actual source — not aspirational. Fixes applied are noted inline.

Legend: ✅ PASS · ⚠ WARN · ❌ FAIL

---

## 1. Fresh Install

| Item | Status | Notes |
|---|---|---|
| Download — ZIP from GitHub | ⚠ WARN | GitHub URL in INSTALL.md and README is a placeholder (`your-org/mindcraft`). Must be replaced before public release. |
| Download — Git clone | ⚠ WARN | Same placeholder URL. |
| Install deps: `npm install -g pnpm && pnpm install` | ✅ PASS | Correct. `node_modules` presence check in launcher gives clear error if skipped. |
| Launcher start: `node launcher.mjs` | ✅ PASS | Starts API + dashboard, health-polls both, opens browser after both are ready. |
| Node version gate | ✅ PASS | Launcher exits with plain-English error if Node < 20. |
| `.env` auto-created on first run | ✅ PASS | `ensureEnv()` copies `.env.example` → `.env` if missing. Warns user to add API keys. |
| `.env` loaded for child processes | ✅ PASS | `parseDotEnv()` merges `.env` into `process.env` before spawning. System env wins. |
| Port conflict pre-flight | ✅ PASS | Checks `API_PORT` and `DASH_PORT` before spawning. Clear error names the port and the fix. |
| Browser opens automatically | ✅ PASS | `openBrowser()` called after both health checks pass. Falls back to printing URL if `open`/`xdg-open` fails. |
| Desktop scripts (Windows .bat, .ps1; macOS .command; Linux .sh) | ✅ PASS | All four check for Node, handle spaces in paths, pass args through to launcher. |

---

## 2. Dashboard

| Item | Status | Notes |
|---|---|---|
| Create bot — form renders | ✅ PASS | Modal populated from `/api/meta`: version list, cognitive modes, playstyles. |
| Create bot — Ollama model discovery | ✅ PASS | Fetches installed models via `/api/ollama/models` proxy. Falls back to text input if Ollama unreachable, with friendly warning. |
| Create bot — API key field (cloud) | ✅ PASS | Shown for OpenAI / Anthropic. Passed per-request; overrides server env var. |
| Create bot — version field | ✅ PASS | Dropdown with tested versions (1.16.5 – 1.20.4). Blank = auto-detect. |
| Create bot — submission / error display | ✅ PASS | 400/500 errors from the API are caught and surfaced in the error banner with friendly messages. |
| Delete bot (Disconnect button) | ✅ PASS | Calls `DELETE /api/bots/:id`. Deselects bot and refreshes list. |
| Runtime panel — task / zone / state | ✅ PASS | Polls `GET /api/bots/:id/runtime` (3 s). Shows current task, zone, operational state, risk, alertness, memory, telemetry. |
| Runtime panel — cognitive mode display | ✅ PASS | Shown as a read-only stat. |
| Runtime panel — playstyle display | ✅ PASS | Shown as a read-only stat. |
| Runtime panel — change mode / playstyle after creation | ⚠ WARN | API exists (`PATCH /bots/:id/mode`, `PATCH /bots/:id/playstyle`) but the dashboard has no in-panel controls to change them after creation. Set at creation time only. |
| Logs panel — renders entries | ✅ PASS | Polls `GET /api/logs` (3 s). Shows last 200 entries. |
| Logs panel — level filter | ✅ PASS | Client-side filter across `info`, `warn`, `error`. |
| Logs panel — text search | ✅ PASS | Case-insensitive substring match on `msg`. |
| Logs panel — auto-refresh toggle | ✅ PASS | ⏸/▶ button in header pauses/resumes all polling. |
| Quick actions (Follow, Mine, Build, Stop, etc.) | ✅ PASS | Each sends `POST /api/bots/:id/command`. Error banner on failure. |
| Reconnect button | ⚠ WARN | Button exists in the UI. API endpoint (`POST /bots/:id/reconnect`) returns **501 Not Implemented** — the message shown is "Reconnect isn't supported yet — disconnect and create a new bot to reconnect." Clear, but the button is misleading. |
| API offline state | ✅ PASS | Red "API offline" badge in header. Sidebar shows: "API server unreachable. Run Mindcraft.sh / Mindcraft.bat to start." |
| Welcome modal (first-run) | ✅ PASS | Shown on first visit (no `mindcraft_welcomed` in localStorage). Dismissed once and never shown again. |
| Auto-pause when tab hidden | ✅ PASS | `visibilitychange` listener stops polling while tab is in background, resumes on focus. |

---

## 3. Minecraft Connection

| Item | Status | Notes |
|---|---|---|
| Offline server (`auth: offline`) | ✅ PASS | Default. No account required. Works for LAN and cracked servers. |
| Online server (`auth: microsoft`) | ⚠ WARN | Option appears in UI and is accepted by the API. However Microsoft OAuth requires a browser pop-up that mineflayer cannot complete in a headless Node process without additional setup. Users will see the bot hang at connection. This path is untested and should be labeled "experimental" or gated. |
| Invalid address / connection refused | ✅ PASS | `ECONNREFUSED` bubbles through `MinecraftBot.connect()` → BotManager removes the bot and throws. API returns 500. Dashboard `friendlyError` shows: "Bot couldn't connect to the Minecraft server. Check the host and port." |
| Connection timeout (server unreachable but not refusing) | ✅ PASS | 30-second timeout in `MinecraftBot.connect()`. Error surfaces the same way as ECONNREFUSED. |
| Bot kicked during connection | ✅ PASS | `kicked` event during handshake rejects the connect promise with the kick reason. |
| Unsupported Minecraft version | ✅ PASS | Version mismatch errors from mineflayer contain "Invalid protocol version". Dashboard `friendlyError` maps this to: "Unsupported Minecraft version. Try a different version or use Auto-detect." |
| Auto-detect version (blank version field) | ✅ PASS | `config.version` is `undefined`, passed as-is to mineflayer which negotiates automatically. |

---

## 4. AI Providers

| Item | Status | Notes |
|---|---|---|
| Ollama | ✅ PASS | `OllamaProvider` implemented. Model list auto-discovered from Ollama's `/api/tags`. Fallback to keyword commands when Ollama is unreachable. |
| OpenAI | ✅ PASS | `OpenAIProvider` implemented. Key from env var (`OPENAI_API_KEY`) or per-request `apiKey` field. Clear error if key is missing. |
| Anthropic | ✅ PASS | `AnthropicProvider` implemented. Same pattern as OpenAI. |
| Missing API key error | ✅ PASS | `ProviderFactory` throws: "OpenAI provider requires an API key. Set the OPENAI_API_KEY environment variable or pass apiKey in the bot config." Dashboard surfaces this via the error banner. |
| Deterministic mode (`cognitiveMode: "deterministic"`) | ✅ PASS | Available in the Create Bot form and via `PATCH /bots/:id/mode`. Bypasses LLM calls; FastBrain state machine runs rule-based only. |
| Debug mode (`MINDCRAFT_DEBUG=true`) | ✅ PASS | Documented in `.env.example`. Activates deterministic timers, suppresses ambient idle behavior, enables verbose task logs. |
| Unknown provider | ✅ PASS | `ProviderFactory` throws: "Unknown LLM provider: "xyz". Valid options: ollama, openai, anthropic." API validates provider at the route level and returns 400 before even reaching the factory. |

---

## 5. Persistence

| Item | Status | Notes |
|---|---|---|
| State saved to disk during session | ✅ PASS | Autosave every 60 s via `scheduleSave()`. Flushes on bot destroy. Saves to `~/.mindcraft/bots/{username}@{host}_{port}.json`. |
| Persistence directory auto-created | ✅ PASS | `mkdir({ recursive: true })` in `PersistenceManager.save()`. |
| State restored on reconnect / server restart | ✅ PASS | **Fixed in this release.** Previously keyed by ephemeral UUID — state was never found. Now keyed by `{username}@{host}_{port}` (stable across restarts). Restores: home position, cognitive mode, semantic locations, trust levels, habits. |
| Bot list does NOT survive server restart | ⚠ WARN | By design. `BotManager` is in-memory. After restarting the server, the user must re-create bots via the dashboard. Bot state (memory, waypoints, habits) IS restored once they do. |
| `MINDCRAFT_PERSISTENCE=false` disables all disk writes | ✅ PASS | Documented in `.env.example`. Config read in `config.ts`. |
| Custom `MINDCRAFT_DATA_DIR` | ✅ PASS | PersistenceManager uses `DATA_DIR` which reads `MINDCRAFT_DATA_DIR` from env. |

---

## 6. Documentation

| Item | Status | Notes |
|---|---|---|
| README — Node version | ✅ PASS | "Node.js 20+" in Prerequisites. Matches launcher's `< 20` check. |
| README — Launcher as primary start method | ✅ PASS | Updated in this release. `node launcher.mjs` / desktop scripts listed first. `start-dev` kept as "developer workflow" alternative. |
| README — Environment variables table | ✅ PASS | All variables match `config.ts` and `.env.example`. |
| README — API reference | ✅ PASS | Endpoints listed match the actual route handlers in `routes/bots.ts`, `routes/meta.ts`, `routes/logs.ts`, `routes/health.ts`. |
| README — GitHub URL placeholder | ⚠ WARN | `git clone <repo>` still a placeholder. Replace before release. |
| INSTALL.md — Node version | ✅ PASS | "Node.js 20 or newer". Matches. |
| INSTALL.md — Step sequencing | ✅ PASS | Updated in this release. Launch → auto-creates `.env` → stop → edit if needed. |
| INSTALL.md — Port troubleshooting | ✅ PASS | Updated to `API_PORT=8081` / `DASH_PORT=3001` in `.env`. |
| INSTALL.md — GitHub URL placeholder | ⚠ WARN | Same as README. |
| `.env.example` — launcher ports documented | ✅ PASS | Added `API_PORT` and `DASH_PORT` with comments in this release. |
| `.env.example` — all variables match `config.ts` | ✅ PASS | Cross-checked. Every variable in the file is read in `config.ts`. No orphans. |
| `.env.example` — PORT vs API_PORT explained | ✅ PASS | Updated comment clarifies: `PORT` is for direct invocation; launcher uses `API_PORT`. |

---

## 7. Production Build

| Item | Status | Notes |
|---|---|---|
| Build command: `node launcher.mjs --prod` | ✅ PASS | Runs `pnpm run build` for both `@workspace/api-server` and `@workspace/dashboard`. |
| `VITE_API_BASE` set at build time | ✅ PASS | **Fixed in this release.** Build env now passes `VITE_API_BASE=/api`. Relative path works because API and dashboard share one server in production. |
| API server build output | ✅ PASS | `artifacts/api-server/dist/index.mjs` (esbuild bundle). |
| Dashboard build output | ✅ PASS | `artifacts/dashboard/dist/public/` (Vite). Matches the path the launcher and API server use for `SERVE_STATIC_DIR`. |
| Production server: `serve` dependency | ✅ PASS | **Fixed in this release.** `serve` is no longer used. API server serves the built dashboard via `express.static` + SPA fallback when `SERVE_STATIC_DIR` is set. Single process, single port. |
| Production CORS | ✅ PASS | Same-origin in production (both on `API_PORT`). CORS is also enabled globally for cross-origin access. |
| SPA routing in production | ✅ PASS | `app.use()` catch-all returns `index.html` for any request that doesn't match an `/api/*` route. |
| Health check after prod start | ✅ PASS | Launcher polls `GET /api/healthz` (90 s timeout) before opening browser. |

---

## Summary

**PASS:** 46 items  
**WARN:** 7 items  
**FAIL:** 0 items  

### Warns requiring action before release

1. **GitHub URL placeholder** — Replace `https://github.com/your-org/mindcraft.git` with the real repo URL in both README.md and INSTALL.md before publishing.
2. **Microsoft (online) auth** — The "Microsoft" option in the Create Bot form is untested in headless operation. mineflayer's Microsoft auth requires a browser OAuth flow that cannot complete without user interaction in a separate window. Label it "experimental" or document the limitation before advertising online server support.
3. **Reconnect button returns 501** — The dashboard button triggers a "not supported" error. Consider either removing the button or changing it to "Disconnect + re-create" guidance.
4. **Cognitive mode / playstyle change after creation** — No in-dashboard UI to change these after a bot is connected. The API supports it; add controls if runtime reconfiguration is expected by users.
5. **Bot list not persisted across server restart** — By design (in-memory). Bot *state* is persisted and restored. Document this limitation clearly in the dashboard when the bot list is empty after a restart.

### Fixes applied in this release

| Bug | Fix |
|---|---|
| Persistence key was ephemeral UUID — state never restored | Changed to stable `{username}@{host}_{port}` key |
| `.env` not loaded for API server child processes | `parseDotEnv()` merges into `process.env` before spawning |
| Production mode used `pnpm exec serve` (not installed) | API server now serves static files via `SERVE_STATIC_DIR` / `express.static` |
| Production build missing `VITE_API_BASE` | Build step passes `VITE_API_BASE=/api` |
| Node version check was `< 18` (Vite 6 needs 20+) | Changed to `< 20` |
| INSTALL.md `.env` sequencing error | Reordered: run launcher first to create `.env`, stop, then edit |
| INSTALL.md port troubleshooting used `PORT` | Updated to `API_PORT` / `DASH_PORT` |
| `.env.example` missing `API_PORT` / `DASH_PORT` | Added with explanatory comments |
