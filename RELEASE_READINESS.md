# Mindcraft — Release Readiness Report

**Date:** 2026-05-31  
**Scope:** Full pre-testing pass — startup validation, dashboard usability, Minecraft compatibility, error recovery, test readiness, dead-code cleanup  
**Status:** ✅ Ready for Minecraft Testing

Legend: ✅ PASS · ⚠ WARN · ❌ FAIL

---

## Phase 1 — Startup Validation

| Item | Status | Notes |
|---|---|---|
| Node ≥ 20 check | ✅ PASS | `checkNodeVersion()` — exits with clear message if too old |
| `node_modules` presence check | ✅ PASS | `checkDeps()` — exits with `pnpm install` instructions |
| `.env` auto-created from `.env.example` | ✅ PASS | `ensureEnv()` — copies on first run, warns user |
| Port availability pre-flight | ✅ PASS | `checkPorts()` — checks both API and dashboard ports before spawning |
| `PORT` env var required | ✅ PASS | `index.ts` — exits with clear error if missing |
| `PORT` value validity | ✅ PASS | `index.ts` — rejects NaN and non-positive values |
| **`app.listen` error handling** | ✅ **FIXED** | Previously: callback `err` param always undefined (Node.js doesn't pass it). Now: `server.on("error")` handles `EADDRINUSE` with an actionable message and exits cleanly |
| Vite `PORT` env var read | ✅ PASS | `vite.config.ts` reads `process.env.PORT` correctly |
| Launcher waits for health before opening browser | ✅ PASS | 90-second `waitForService` with `/api/healthz` poll |
| API health endpoint exists | ✅ PASS | `GET /api/healthz → { status: "ok" }` |
| Persistence directory created on startup | ✅ PASS | `runHealthChecks()` — `mkdir --recursive` on `botsDir` |
| Ollama reachability logged (non-blocking) | ✅ PASS | `runHealthChecks()` — timeout 3 s, never blocks startup |
| Production static file serving | ✅ PASS | `SERVE_STATIC_DIR` → `express.static` + SPA fallback |
| SPA fallback uses `app.use` not `app.get` | ✅ PASS | Correctly handles Express 5 route matching |
| `middlewares/` directory | ✅ PASS | Contains only `.gitkeep` — intentional placeholder, retained |

---

## Phase 2 — Dashboard Usability

| Item | Status | Notes |
|---|---|---|
| Welcome modal on first run | ✅ PASS | `localStorage` flag; 3-step guide; dismisses cleanly |
| "API offline" badge when unreachable | ✅ PASS | `setApiDown(true)` → badge + sidebar warning with start instructions |
| Sidebar hint when no bots connected | ✅ PASS | Points to `+ New Bot`; explains memory is restored on reconnect |
| **Bot username validation** | ✅ **FIXED** | Added `pattern="[A-Za-z0-9_]{1,16}"`, `maxLength={16}`, and `title` tooltip — browser-level validation before submit |
| Port validation | ✅ PASS | `validatePort()` on blur + form-submit guard, `1–65535` |
| Port defaults to 25565 | ✅ PASS | Label says "optional — defaults to 25565" |
| Version auto-select to latest tested | ✅ PASS | `versionAutoSet` ref avoids double-write |
| Auth mode labelled honestly | ✅ PASS | "Microsoft (online) — experimental, may not work" |
| Ollama model discovery with loading state | ✅ PASS | Spinner while fetching; falls back to text input if unreachable |
| Ollama offline hint in model field | ✅ PASS | `field-warn` message with `ollama serve` instruction |
| API key field — shows env var fallback hint | ✅ PASS | Placeholder explains `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` |
| Connect Bot shows spinner while connecting | ✅ PASS | `busy` state disables button and changes label to "Connecting…" |
| Error banner dismissible | ✅ PASS | `✕` button clears `err` state |
| **Reconnect button removed** | ✅ **FIXED** | Was: enabled when bot offline, clicked → showed error. Now removed. Users see only Disconnect. Sidebar already instructs to use `+ New Bot` to reconnect |
| `onReconnect` dead code removed | ✅ **FIXED** | `handleReconnect`, `QuickActionsProps.onReconnect`, and prop pass-through all removed |
| Action buttons disabled while busy | ✅ PASS | `disabled={busy !== null}` on all action buttons |
| Disconnect gives immediate UI feedback | ✅ PASS | `setBusy("Disconnect")` fires before async call |
| Runtime auto-refresh every 2 s | ✅ PASS | `setInterval(loadRuntime, 2000)` while bot is selected |
| Bot list auto-refresh every 3 s | ✅ PASS | `setInterval(loadBots, 3000)` |
| Tab visibility pause/resume | ✅ PASS | `visibilitychange` listener; `document.hidden` guard on polling |
| In-flight guard prevents overlapping fetches | ✅ PASS | `botsInFlight` / `runtimeInFlight` refs |
| Logs panel auto-refresh checkbox | ✅ PASS | User can pause log polling |

---

## Phase 3 — Minecraft Compatibility

| Item | Status | Notes |
|---|---|---|
| Version field passes through form → API → mineflayer | ✅ PASS | `typeof version === "string" ? version : undefined` → `config.version` → `mineflayer.createBot({ version })` |
| Auto-detect when version blank | ✅ PASS | Undefined → mineflayer auto-negotiates protocol |
| Version dropdown shows tested versions | ✅ PASS | Sourced from `GET /api/meta`; labels latest tested |
| Unsupported version fails gracefully | ✅ PASS | mineflayer throws; caught in `MinecraftBot.connect()`; 500 returned; `friendlyError` maps it |
| **Latest tested version** | ⚠ WARN | Currently `1.20.4`. Minecraft Java is now `1.21.x`. Auto-detect is recommended for newer servers. Do not add new versions without testing |
| `logErrors: false, hideErrors: false` in mineflayer | ✅ PASS | Errors surface via events, not silently swallowed |

---

## Phase 4 — Error Recovery

| Item | Status | Notes |
|---|---|---|
| Invalid host | ✅ PASS | mineflayer throws `ENOTFOUND`; `friendlyError` now maps it → "Connection timed out. Check…" |
| Server offline | ✅ PASS | `ECONNREFUSED` → "Bot couldn't connect to the Minecraft server." |
| **Connection timeout** | ✅ **FIXED** | Added `ETIMEDOUT` / `ENOTFOUND` / "timed out" / "Connection timeout" → actionable message |
| **Server kicked the bot** | ✅ **FIXED** | Added "kicked" match → explains online-mode and whitelist |
| Unsupported version | ✅ PASS | Protocol mismatch strings mapped in `friendlyError` |
| Auth failure (Unauthorized / 401 / 403) | ✅ PASS | Already mapped in `friendlyError` |
| Missing API key | ✅ PASS | Already mapped |
| LLM provider unreachable (Ollama) | ✅ PASS | Keyword fallback active; `friendlyError` has Ollama cases; bot stays connected |
| Dashboard cannot reach API | ✅ PASS | `setApiDown(true)` → badge + sidebar instructions |
| Bot cap exceeded | ✅ PASS | 429 → raw message "Bot limit reached (max N)…" is already user-friendly |
| LLM call during chat fails | ✅ PASS | SlowBrain error caught; keyword fallback; no crash |
| Pathfinding blocked / impossible | ✅ PASS | Mineflayer-pathfinder emits error; FastBrain task marked failed; bot returns to idle |
| Unhandled reconnect request (API) | ✅ PASS | `POST /bots/:id/reconnect` → 501 with clear message |
| Port in use at startup | ✅ **FIXED** | `server.on("error")` with `EADDRINUSE` → clean log + exit |

---

## Phase 5 — Testing Support (TESTING.md)

| Item | Status | Notes |
|---|---|---|
| TESTING.md present | ✅ PASS | 10 field tests covering full runtime behavior |
| Each test has: setup, action, expected result, pass criteria | ✅ PASS | |
| Written for non-technical user | ✅ PASS | No jargon; command examples included |
| Test 3 (chat/connection) mentions 30-second LLM timeout | ✅ PASS | Sets correct expectations for first-time users |
| Test 9 (LLM fallback) explains keyword commands still work | ✅ PASS | Covers the offline-LLM case explicitly |
| Test 10 (failure recovery) covers pathfinding failure | ✅ PASS | |

---

## Phase 6 — Cleanup

| Item | Status | Notes |
|---|---|---|
| `middlewares/` directory | ✅ PASS | Contains `.gitkeep` — intentional, retained |
| `onReconnect` prop in `QuickActionsProps` | ✅ **REMOVED** | Was always unused inside the component |
| `handleReconnect` function in `App.tsx` | ✅ **REMOVED** | Dead code — nothing called it after Reconnect button removal |
| `onReconnect` prop pass-through in JSX | ✅ **REMOVED** | |
| `api.reconnectBot` in `api.ts` | ⚠ WARN | Still exported — the 501 API route exists. Retaining for potential future use; no active caller in the UI |
| `cognitiveMode` / `playstyle` now applied at creation | ✅ PASS | Fixed in previous pass |
| `@workspace/db` removed from api-server deps | ✅ PASS | Fixed in previous pass |
| Unused imports in route files | ✅ PASS | All imports verified against usage |
| `drizzle-orm` / `cookie-parser` still declared but unused | ⚠ WARN | Deferred — remove before final release if no DB layer is added |

---

## Phase 7 — Summary

### Bugs Fixed This Pass

| Bug | Files | Fix |
|---|---|---|
| `app.listen` callback never received an error — port conflicts caused unhandled exception crashes | `index.ts` | Changed to `server.on("error", ...)` with `EADDRINUSE` detection and clean exit |
| Username field accepted any characters (spaces, special chars → invalid Minecraft username) | `App.tsx` | Added `pattern`, `maxLength={16}`, and `title` tooltip |
| Reconnect button was enabled when bot offline, then errored on click | `App.tsx` | Button removed entirely; sidebar already guides users to `+ New Bot` |
| Dead `onReconnect` prop and `handleReconnect` function | `App.tsx` | Both removed |
| "Kicked" error had no friendly message | `api.ts` | Added match for "kicked" → explains online-mode and whitelist |
| Timeout / ETIMEDOUT / ENOTFOUND had no friendly messages | `api.ts` | Added match → actionable "check address and server is running" message |

### Files Changed

- `artifacts/api-server/src/index.ts` — server error handler
- `artifacts/dashboard/src/App.tsx` — username validation, Reconnect removal, dead code removal
- `artifacts/dashboard/src/api.ts` — friendlyError additions

### Remaining Warnings

1. **`1.20.4` is the latest tested version** — current Minecraft Java is `1.21.x`. Users should use Auto-detect for newer servers.
2. **GitHub URL placeholder** — `https://github.com/your-org/mindcraft.git` in `README.md` and `INSTALL.md` — replace before public release.
3. **`cookie-parser` / `drizzle-orm`** — in `api-server/package.json` but no source imports. Remove before final release if no database layer is added.
4. **`api.reconnectBot`** — still exported in `api.ts`, no active UI caller. Remove or implement before public release.
5. **Microsoft auth** — labelled "experimental, may not work". Not tested. Verify before enabling in production.

### Must Test Manually in Minecraft

| Scenario | Why |
|---|---|
| Kick on online-mode server | New error message "Check online-mode and whitelist" — verify it surfaces correctly |
| Connection timeout (wrong host) | New error message — verify it reaches the user |
| Server offline during bot action | Verify reconnect-on-error loop doesn't spin |
| `cognitiveMode` and `playstyle` applied at creation | First connected after fix — verify bot actually uses the selected mode/style |
| Persistence restore after restart | Bot memory, habits, and trust should reload on same username+server |
| All 10 TESTING.md field tests | Full end-to-end validation against a live server |

---

**✅ Codebase is clean, typechecks pass, and the system is ready for Minecraft field testing.**
