---
name: Mindcraft architecture & conventions
description: Dual-brain bot system, launcher design, API/dashboard conventions, and constraints for the usability transformation
---

## Bot architecture
- FastBrain (state machine) + SlowBrain (LLM, event-driven only)
- mineflayer + pathfinder are esbuild-external
- API server: Express, port from `PORT` env var (required, no default)
- Dashboard: React + Vite, BASE_PATH from `BASE_PATH` env var (defaults `/`)

## Launcher design
- `launcher.mjs` — Node.js ES module, zero extra deps (child_process, net, http, fs)
- Starts API (pnpm dev, PORT=8080) + Dashboard (pnpm dev, PORT=3000, VITE_API_BASE=http://localhost:API_PORT/api)
- CORS already enabled on API server — cross-origin fetches work fine without Vite proxy
- Health checks: API → `/api/healthz`, Dashboard → `/` (Vite root)
- Desktop scripts: Mindcraft.sh, Mindcraft.command (macOS double-click), Mindcraft.bat, Mindcraft.ps1

## Logger ring buffer
- `artifacts/api-server/src/lib/logger.ts` uses pino multistream: pino-pretty (dev terminal) + Writable ring buffer (500 entries)
- `logBuffer.recent(n)` exported for the logs API endpoint
- `pino.StreamEntry.level` must be `pino.Level` (not `pino.LevelWithSilent`) — use a validated string cast

## Dashboard conventions
- No CSS frameworks, no state management libraries — vanilla CSS variables, useState/useEffect only
- `VITE_API_BASE` env var sets API root; defaults to `/api` (relative)
- Both typechecks must pass before every restart: `pnpm --filter @workspace/api-server run typecheck` and `pnpm --filter @workspace/dashboard run typecheck`
- First-run welcome: `localStorage.getItem('mindcraft_welcomed')` — null = show modal
- Logs tab: polling every 3s, ring buffer endpoint `GET /api/logs?level=&search=&limit=`

## Constraints (Budget-Constrained Engineering Mode)
- No Electron, no new gameplay systems, no cloud dependencies, no auth system
- No CSS frameworks, no WebSockets, no state management libraries
- Focus: usability, launch experience, installation experience
