# Mindcraft — Release Readiness Report

**Date:** 2026-05-31  
**Scope:** Full pre-testing pass — dead code, cleanup, documentation consistency, build verification, test readiness  
**Status:** ✅ Ready for Testing

Legend: ✅ PASS · ⚠ WARN · ❌ FAIL

---

## Phase 1 — Dead Code Audit

| Item | Status | File | Action |
|---|---|---|---|
| Empty `middlewares/` directory | ✅ PASS | `artifacts/api-server/src/middlewares/` | Directory removed |
| `intents.ts` — no runtime imports | ✅ PASS | `artifacts/api-server/src/bot/intents.ts` | Retained — intentional architecture contract with EXTENSION POINT annotations |
| `presets.ts` — no internal imports | ✅ PASS | `artifacts/api-server/src/bot/presets.ts` | Retained — documented developer utility, referenced in README |
| `@workspace/db` dependency declared but unused | ✅ PASS | `artifacts/api-server/package.json` | Dependency removed |
| `cookie-parser` declared but unused | ⚠ WARN | `artifacts/api-server/package.json` | Retained — likely reserved for future session work; not a security or build risk |
| `drizzle-orm` declared but unused | ⚠ WARN | `artifacts/api-server/package.json` | Retained — paired with removed `@workspace/db`; removal deferred pending db roadmap decision |

---

## Phase 2 — Repository Cleanup

| Item | Status | File | Action |
|---|---|---|---|
| Temporary / generated files in root | ✅ PASS | `/` | None found |
| `dist/` artifacts committed | ✅ PASS | `.gitignore` | `dist/` in `.gitignore`; not tracked |
| Stale migration files | ✅ PASS | — | None found |
| Abandoned experiment files | ✅ PASS | — | None found |
| Launcher scripts present and executable | ✅ PASS | `Mindcraft.sh`, `Mindcraft.bat`, `Mindcraft.command` | All present with correct permissions |
| Developer convenience scripts present | ✅ PASS | `start-dev`, `start-dev.bat`, `start-prod`, `start-prod.bat`, `spawn-bot.sh` | All present |
| Duplicate README sections | ✅ PASS | `README.md` | No duplicate content found |

---

## Phase 3 — Documentation Consistency

| Item | Status | File | Action |
|---|---|---|---|
| README — launcher as primary start | ✅ PASS | `README.md` | `node launcher.mjs` / desktop scripts are listed first |
| README — `start-dev` script exists | ✅ PASS | `README.md`, `start-dev` | Script exists and executable |
| README — `spawn-bot.sh` exists | ✅ PASS | `README.md`, `spawn-bot.sh` | Script exists |
| README — `Mindcraft.command` (macOS) exists | ✅ PASS | `README.md`, `Mindcraft.command` | Script exists |
| README — env vars match `config.ts` | ✅ PASS | `README.md`, `config.ts` | All 13 vars cross-checked; no orphans |
| README — API endpoints match route handlers | ✅ PASS | `README.md`, `routes/*.ts` | All documented endpoints verified present |
| README — `cognitiveMode` / `playstyle` at creation | ✅ PASS | `README.md`, `routes/bots.ts` | **Fixed in this pass** — route was silently dropping these fields; now extracted, validated, and applied |
| README — GitHub URL placeholder | ⚠ WARN | `README.md`, `INSTALL.md` | `https://github.com/your-org/mindcraft.git` — replace before public release |
| INSTALL.md — step sequencing correct | ✅ PASS | `INSTALL.md` | Launch first → auto-creates `.env` → stop → edit if needed |
| INSTALL.md — port troubleshooting uses `API_PORT` | ✅ PASS | `INSTALL.md` | Correct (`API_PORT=8081` / `DASH_PORT=3001`) |
| `.env.example` — all vars match `config.ts` | ✅ PASS | `.env.example`, `config.ts` | Cross-checked; every var in file is read in config |
| `.env.example` — `PORT` vs `API_PORT` explained | ✅ PASS | `.env.example` | Comment clarifies distinction |
| `spawn-bot.sh` — sends `cognitiveMode`/`playstyle` | ✅ PASS | `spawn-bot.sh` | Now handled correctly by the API (bug fixed above) |

---

## Phase 4 — Build Verification

| Item | Status | File | Action |
|---|---|---|---|
| API typecheck | ✅ PASS | `artifacts/api-server/` | `tsc --noEmit` clean |
| Dashboard typecheck | ✅ PASS | `artifacts/dashboard/` | `tsc --noEmit` clean |
| `CreateBotRequest` type missing `cognitiveMode` / `playstyle` | ✅ PASS | `bot/types.ts` | **Fixed** — added both optional fields to interface |
| Dashboard form sends `cognitiveMode` / `playstyle` | ✅ PASS | `dashboard/src/App.tsx` | Confirmed at lines 184–185; now reaches the bot correctly |
| Production build path (`SERVE_STATIC_DIR`) | ✅ PASS | `app.ts` | `express.static` + SPA fallback in place |
| Health endpoint available | ✅ PASS | `routes/health.ts` | `GET /api/healthz` → `{ status: "ok" }` |
| Launcher health-polls before opening browser | ✅ PASS | `launcher.mjs` | 90-second timeout; polls `GET /api/healthz` |

---

## Phase 5 — Security (carried forward from audit)

| Item | Status | File | Action |
|---|---|---|---|
| Bot creation cap enforced | ✅ PASS | `routes/bots.ts` | 429 when `MINDCRAFT_MAX_BOTS` reached |
| JSON body size limited | ✅ PASS | `app.ts` | `express.json({ limit: "100kb" })` |
| SSRF via Ollama `baseUrl` | ✅ PASS | `routes/meta.ts` | Only localhost / 127.0.0.1 / ::1 permitted |
| Behavior fields clamped | ✅ PASS | `routes/bots.ts` | `chatCooldown` [500–30000], `viewDistance` [4–64] |
| `windowMs` clamped | ✅ PASS | `routes/bots.ts` | [1 s, 24 h] |
| Logger redacts API key fields | ✅ PASS | `lib/logger.ts` | `*.apiKey`, `*.api_key` in pino redact |
| Log search string capped | ✅ PASS | `routes/logs.ts` | 200-char cap |
| API keys not exposed in any endpoint | ✅ PASS | All routes | Verified — no `LLMConfig` in any response |
| Path traversal in persistence | ✅ PASS | `PersistenceManager.ts` | Sanitizer replaces `/` and `\` with `_` |

---

## Summary

| Phase | PASS | WARN | FAIL |
|---|---|---|---|
| Dead Code | 4 | 2 | 0 |
| Repository Cleanup | 7 | 0 | 0 |
| Documentation Consistency | 12 | 1 | 0 |
| Build Verification | 7 | 0 | 0 |
| Security | 9 | 0 | 0 |
| **Total** | **39** | **3** | **0** |

---

## Bugs Fixed This Pass

| Bug | File | Fix |
|---|---|---|
| `cognitiveMode` silently dropped at bot creation | `routes/bots.ts`, `bot/types.ts`, `BotManager.ts`, `MinecraftBot.ts` | Extracted and validated in route handler; added to `CreateBotRequest`; passed through `BotManager`; applied after spawn in `MinecraftBot.connect()` |
| `playstyle` silently dropped at bot creation | Same as above | Same fix — `playstyle` now flows from dashboard form to bot |
| `@workspace/db` unused dependency | `artifacts/api-server/package.json` | Removed |
| Empty `middlewares/` directory | `artifacts/api-server/src/` | Removed |

---

## Warns Requiring Action Before Release

1. **GitHub URL placeholder** — Replace `https://github.com/your-org/mindcraft.git` in `README.md` and `INSTALL.md` with the real repository URL before any public announcement.
2. **`cookie-parser` / `drizzle-orm` declared but unused** — These are in `api-server/package.json` but have no source imports. Remove before final release if the database layer is not being added.

---

## Repository Status

**✅ Ready for Testing**

The codebase is stable, all typechecks pass, known bugs are fixed, documentation matches the code, and the 10-test field guide in `TESTING.md` covers the full runtime behavior against a real Minecraft server.

Next step: run through `TESTING.md` against a live server, then fix any gameplay regressions found before the public release.
